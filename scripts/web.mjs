import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadWebEnvironment, projectRoot } from '../config/environment.mjs';

const config = loadWebEnvironment();
const mode = process.argv[2];
if (!['dev', 'start'].includes(mode)) {
  throw new Error('Use web.mjs dev or start.');
}
const args = [
  resolve(projectRoot, 'node_modules/next/dist/bin/next'),
  mode,
  '--hostname',
  config.webHost,
  '--port',
  String(config.webPort),
];
if (mode === 'dev') {
  args.push('--webpack');
}
const child = spawn(process.execPath, args, {
  cwd: resolve(projectRoot, 'apps/web'),
  stdio: 'inherit',
});
process.once('SIGTERM', () => child.kill('SIGTERM'));
process.once('SIGINT', () => child.kill('SIGINT'));
child.once('error', () => {
  console.error('Next.js failed to start.');
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
