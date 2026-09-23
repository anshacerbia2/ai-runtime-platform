import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadPactEnvironment, projectRoot } from '../../config/environment.mjs';

export const participants = [
  'runtime-console',
  'runtime-bff',
  'runtime-api',
] as const;

/** Publishing results for a different or dirty checkout would poison compatibility evidence. */
export function assertPactSourceVersion() {
  const config = loadPactEnvironment();
  const revision = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: config.timeoutMs,
  });
  const status = spawnSync('git', ['status', '--porcelain'], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: config.timeoutMs,
  });
  if (
    revision.status !== 0 ||
    status.status !== 0 ||
    revision.stdout.trim() !== config.version ||
    status.stdout.trim()
  ) {
    throw new Error(
      'Pact evidence requires a clean checkout of exactly PACT_VERSION.',
    );
  }
}

/** No shell interpolation, latest-version selectors, skipped TLS, or success-on-unknown. */
export function brokerCommand(args: string[], acceptedFailure = false) {
  const config = loadPactEnvironment();
  const result = spawnSync(
    process.execPath,
    [
      resolve(
        projectRoot,
        'node_modules/@pact-foundation/pact-cli/bin/pact-broker.js',
      ),
      ...args,
      '--broker-base-url',
      config.url,
      '--retries',
      '0',
    ],
    { encoding: 'utf8', timeout: config.timeoutMs, maxBuffer: 4 * 1024 * 1024 },
  );
  if (result.error || result.signal || result.status === null) {
    throw new Error('Pact Broker command failed or timed out.');
  }
  if (result.status !== 0 && !acceptedFailure) {
    throw new Error(
      'Pact Broker rejected ' + args[0] + '. No deployment is authorized.',
    );
  }
  return { status: result.status, output: result.stdout };
}

export function requireDeployable(participant: string, version?: string) {
  if (!participants.includes(participant as (typeof participants)[number])) {
    throw new Error('Unknown participant.');
  }
  const config = loadPactEnvironment();
  const result = brokerCommand(
    [
      'can-i-deploy',
      '--pacticipant',
      participant,
      '--version',
      version ?? config.version,
      '--to-environment',
      config.environment,
      '--output',
      'json',
    ],
    true,
  );
  let summary: unknown;
  try {
    summary = JSON.parse(result.output);
  } catch {
    throw new Error('Broker returned no verifiable deployment matrix.');
  }
  const deployable =
    summary &&
    typeof summary === 'object' &&
    'summary' in summary &&
    summary.summary &&
    typeof summary.summary === 'object' &&
    'deployable' in summary.summary &&
    summary.summary.deployable === true;
  if (result.status !== 0 || !deployable) {
    throw new Error(
      'Contract incompatibility or missing evidence blocks ' +
        participant +
        '.',
    );
  }
}
