import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import { loadEnvironment } from '../config/environment.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules/typescript/bin/tsc');
const config = loadEnvironment();
const children = [];
let stopping = false;

function run(script, ...args) {
  execFileSync(process.execPath, [script, ...args], {
    cwd: root,
    stdio: 'inherit',
  });
}

function stop(exitCode = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  process.exitCode = exitCode;
  for (const child of children) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
    }
  }
  const deadline = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  }, config.dev.childStopTimeoutMs);
  deadline.unref();
}

function startChild(args) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
  children.push(child);
  child.on('error', (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      stop(code ?? 1);
    }
  });
  return child;
}

async function assertPortAvailable(host, port) {
  await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(
        new Error(
          `Port ${host}:${port} already in use. Stop the existing project dev session; no process will be killed automatically.`,
        ),
      ),
    );
    server.listen(port, host, () => server.close(resolvePort));
  });
}
async function waitForApi(host, port, child) {
  const deadline = Date.now() + config.dev.apiReadyTimeoutMs;
  while (Date.now() < deadline && !stopping) {
    if (child.exitCode !== null) {
      throw new Error('API exited before readiness.');
    }
    try {
      const response = await fetch(`http://${host}:${port}/health/live`, {
        signal: AbortSignal.timeout(config.dev.apiProbeTimeoutMs),
      });
      const body = await response.json();
      if (response.ok && body.milestone === 'M0' && body.status === 'ok') {
        return;
      }
    } catch {
      // A bounded connection refusal is expected while Nest initializes.
    }
    await delay(config.dev.apiPollIntervalMs);
  }
  throw new Error(
    `API did not become ready within ${config.dev.apiReadyTimeoutMs}ms.`,
  );
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());

try {
  run(tsc, '-p', 'packages/contracts/tsconfig.json');
  run(join(root, 'node_modules/prisma/build/index.js'), 'generate');
  run(join(root, 'scripts/setup-local.mjs'));
  run(tsc, '-p', 'apps/api/tsconfig.json');
  await assertPortAvailable(config.apiHost, config.apiPort);
  await assertPortAvailable(config.webHost, config.webPort);
  const api = startChild(['apps/api/dist/main.js']);
  await waitForApi(config.apiHost, config.apiPort, api);
  startChild([
    join(root, 'node_modules/vite/bin/vite.js'),
    '--config',
    'apps/web/vite.config.ts',
  ]);
  console.log(
    `M0 UI: http://${config.webHost}:${config.webPort} | Nest/Fastify API: ${config.apiHost}:${config.apiPort} | no live providers`,
  );
  console.log(
    'Frontend: Vite HMR. Backend/shared-contract changes: restart npm run dev.',
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Development startup failed.',
  );
  stop(1);
}
