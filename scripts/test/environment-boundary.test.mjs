import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import {
  loadApiEnvironment,
  loadDevEnvironment,
  loadE2EEnvironment,
} from '../../config/environment.mjs';

const root = resolve(import.meta.dirname, '../..');

test('required environment values fail closed instead of falling back', () => {
  loadApiEnvironment();
  const prior = process.env.M0_API_PORT;
  process.env.M0_API_PORT = '';
  try {
    assert.throws(
      () => loadApiEnvironment(),
      /Missing required environment variable: M0_API_PORT/,
    );
  } finally {
    process.env.M0_API_PORT = prior;
  }
});

test('boolean environment values require explicit true or false', () => {
  const prior = process.env.M0_MANAGE_POSTGRES;
  process.env.M0_MANAGE_POSTGRES = 'yes';
  try {
    assert.throws(() => loadDevEnvironment(), /must be exactly true or false/);
  } finally {
    process.env.M0_MANAGE_POSTGRES = prior;
  }
});

test('nonlocal API requires an explicit deployment role', () => {
  const priorMode = process.env.M0_RUNTIME_MODE;
  const priorRole = process.env.DEPLOYMENT_ROLE;
  try {
    process.env.M0_RUNTIME_MODE = 'm1-oidc';
    delete process.env.DEPLOYMENT_ROLE;
    assert.throws(
      () => loadApiEnvironment(),
      /DEPLOYMENT_ROLE must be explicit outside m0-local mode/,
    );
  } finally {
    if (priorMode === undefined) {
      delete process.env.M0_RUNTIME_MODE;
    } else {
      process.env.M0_RUNTIME_MODE = priorMode;
    }
    if (priorRole === undefined) {
      delete process.env.DEPLOYMENT_ROLE;
    } else {
      process.env.DEPLOYMENT_ROLE = priorRole;
    }
  }
});

test('gateway replay Redis endpoint uses a Redis URL and stays in the API projection', () => {
  const prior = process.env.M2_REPLAY_REDIS_URL;
  try {
    process.env.M2_REPLAY_REDIS_URL = 'https://example.invalid/replay';
    assert.throws(
      () => loadApiEnvironment(),
      /M2_REPLAY_REDIS_URL must use the Redis protocol/,
    );
    process.env.M2_REPLAY_REDIS_URL = 'redis://127.0.0.1:6379';
    assert.equal(
      loadApiEnvironment().gateway.replayRedisUrl,
      'redis://127.0.0.1:6379',
    );
  } finally {
    if (prior === undefined) {
      delete process.env.M2_REPLAY_REDIS_URL;
    } else {
      process.env.M2_REPLAY_REDIS_URL = prior;
    }
  }
});

test('runner coordination Redis has a distinct validated API projection', () => {
  const prior = process.env.M3_COORDINATION_REDIS_URL;
  try {
    process.env.M3_COORDINATION_REDIS_URL =
      'https://example.invalid/coordination';
    assert.throws(
      () => loadApiEnvironment(),
      /M3_COORDINATION_REDIS_URL must use the Redis protocol/,
    );
    process.env.M3_COORDINATION_REDIS_URL = 'redis://127.0.0.1:6379/13';
    assert.equal(
      loadApiEnvironment().runner.coordinationRedisUrl,
      'redis://127.0.0.1:6379/13',
    );
  } finally {
    if (prior === undefined) {
      delete process.env.M3_COORDINATION_REDIS_URL;
    } else {
      process.env.M3_COORDINATION_REDIS_URL = prior;
    }
  }
});

test('nonlocal API cannot silently use process-local replay', () => {
  const prior = {
    mode: process.env.M0_RUNTIME_MODE,
    role: process.env.DEPLOYMENT_ROLE,
    replay: process.env.M2_REPLAY_REDIS_URL,
  };
  try {
    process.env.M0_RUNTIME_MODE = 'm1-oidc';
    process.env.DEPLOYMENT_ROLE = 'api-production';
    delete process.env.M2_REPLAY_REDIS_URL;
    assert.throws(
      () => loadApiEnvironment(),
      /M2_REPLAY_REDIS_URL is required outside m0-local mode/,
    );
  } finally {
    for (const [key, value] of [
      ['M0_RUNTIME_MODE', prior.mode],
      ['DEPLOYMENT_ROLE', prior.role],
      ['M2_REPLAY_REDIS_URL', prior.replay],
    ]) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('API and dev startup do not depend on Playwright configuration', () => {
  const keys = [
    'PLAYWRIGHT_BROWSER_NAME',
    'PLAYWRIGHT_CHANNEL',
    'PLAYWRIGHT_TEST_TIMEOUT_MS',
    'PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS',
    'PLAYWRIGHT_VIEWPORT_WIDTH',
    'PLAYWRIGHT_VIEWPORT_HEIGHT',
    'PLAYWRIGHT_REUSE_EXISTING_SERVER',
  ];
  const prior = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) {
      delete process.env[key];
    }
    const api = loadApiEnvironment();
    const dev = loadDevEnvironment();
    assert.equal('playwright' in api, false);
    assert.equal('playwright' in dev, false);
    assert.throws(
      () => loadE2EEnvironment(),
      /Missing required environment variable: PLAYWRIGHT_BROWSER_NAME/,
    );
  } finally {
    for (const [key, value] of prior) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test('source code has one environment read boundary and no legacy local config', () => {
  const violations = [];
  const roots = ['apps', 'scripts'];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'generated', '.next'].includes(entry.name)) {
        continue;
      }
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (/\.(?:ts|tsx|mjs)$/.test(entry.name)) {
        if (
          path ===
            resolve(root, 'scripts/test/environment-boundary.test.mjs') ||
          path === resolve(root, 'scripts/test/pact-environment.test.mjs')
        ) {
          continue;
        }
        const text = readFileSync(path, 'utf8');
        if (text.includes('.local/config.json')) {
          violations.push(`${relative(root, path)} reads legacy local config`);
        }
        if (/process\.env\.[A-Z_]/.test(text)) {
          violations.push(`${relative(root, path)} reads process.env directly`);
        }
        if (/\bloadEnvironment\s*\(/.test(text)) {
          violations.push(
            `${relative(root, path)} uses retired monolithic environment loader`,
          );
        }
      }
    }
  }
  for (const directory of roots) {
    walk(resolve(root, directory));
  }
  assert.deepEqual(violations, []);
});
