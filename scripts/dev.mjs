import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules/typescript/bin/tsc');
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
  // Only children created by this command are eligible for escalation.
  const deadline = setTimeout(() => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    }
  }, 5000);
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

async function assertPortAvailable(port) {
  await new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', () =>
      reject(
        new Error(
          `Port ${port} already in use. Stop the existing project dev session; no process will be killed automatically.`,
        ),
      ),
    );
    server.listen(port, '127.0.0.1', () => server.close(resolvePort));
  });
}

async function waitForApi(port, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !stopping) {
    if (child.exitCode !== null) {
      throw new Error('API exited before readiness.');
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health/live`, {
        signal: AbortSignal.timeout(1000),
      });
      const body = await response.json();
      if (response.ok && body.milestone === 'M0' && body.status === 'ok') {
        return;
      }
    } catch {
      // A bounded connection refusal is expected while Nest initializes.
    }
    await delay(150);
  }
  throw new Error('API did not become ready within 15 seconds.');
}

process.once('SIGINT', () => stop());
process.once('SIGTERM', () => stop());

try {
  // Nest parameter decorators require the TypeScript compiler. Do not launch
  // a watcher that rewrites output while the HTTP process is starting.
  run(tsc, '-p', 'packages/contracts/tsconfig.json');
  run(join(root, 'node_modules/prisma/build/index.js'), 'generate');
  run(join(root, 'scripts/setup-local.mjs'));
  run(tsc, '-p', 'apps/api/tsconfig.json');
  const config = JSON.parse(
    readFileSync(join(root, '.local/config.json'), 'utf8'),
  );
  await assertPortAvailable(config.apiPort);
  await assertPortAvailable(config.webPort);
  const api = startChild(['apps/api/dist/main.js']);
  await waitForApi(config.apiPort, api);
  startChild([
    join(root, 'node_modules/vite/bin/vite.js'),
    '--config',
    'apps/web/vite.config.ts',
  ]);
  console.log(
    `M0 UI: http://127.0.0.1:${config.webPort} | Nest/Fastify API: ${config.apiPort} | no live providers`,
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
