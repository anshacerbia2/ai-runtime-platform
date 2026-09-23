import { assertPactSourceVersion } from './broker.js';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { loadPactEnvironment } from '../../config/environment.mjs';
import { brokerCommand, participants, requireDeployable } from './broker.js';
import { verifyProviders } from './provider.js';

const config = loadPactEnvironment();
assertPactSourceVersion();
if (!config.loopback || config.environment !== 'contract-ci') {
  throw new Error(
    'This proof records simulated deployments only in an isolated loopback contract-ci Broker.',
  );
}
const deadline = Date.now() + config.timeoutMs;
let ready = false;
while (Date.now() < deadline) {
  try {
    const response = await fetch(config.url, {
      signal: AbortSignal.timeout(1000),
    });
    ready = response.ok;
    await response.body?.cancel();
    if (ready) {
      break;
    }
  } catch {
    // The disposable CI Broker may still be running database migrations.
  }
  await delay(250);
}
assert.ok(ready, 'The disposable Pact Broker did not become ready.');
brokerCommand([
  'create-environment',
  '--name',
  config.environment,
  '--display-name',
  'Isolated contract gate proof',
]);
brokerCommand([
  'publish',
  'tests/cdc/baselines/v1',
  '--consumer-app-version',
  'baseline-v1',
  '--branch',
  'contract-baseline',
]);
brokerCommand([
  'publish',
  '.local/pacts/current',
  '--consumer-app-version',
  config.version,
  '--branch',
  config.branch,
]);
await verifyProviders('proof');

// These records are deliberately synthetic in the disposable Broker, never real production deployments.
for (const participant of participants) {
  const version =
    participant === 'runtime-console' ? 'baseline-v1' : config.version;
  brokerCommand([
    'record-deployment',
    '--pacticipant',
    participant,
    '--version',
    version,
    '--environment',
    config.environment,
  ]);
}
for (const participant of participants) {
  requireDeployable(participant);
}
const badVersion = config.version + '-incompatible-probe';
assert.throws(() => requireDeployable('runtime-bff', badVersion), /blocks/);
const rejected = brokerCommand(
  [
    'can-i-deploy',
    '--pacticipant',
    'runtime-bff',
    '--version',
    badVersion,
    '--to-environment',
    config.environment,
    '--output',
    'json',
  ],
  true,
);
// JSON output can exit successfully while the compatibility matrix rejects deployment.
// The actual gate above rejects anything except an explicitly deployable matrix.
const evidence = JSON.parse(rejected.output) as {
  summary?: { deployable?: boolean | null };
  matrix?: Array<{ verificationResult?: { success?: boolean } }>;
};
assert.equal(evidence.summary?.deployable, false);
assert.ok(
  evidence.matrix?.some((row) => row.verificationResult?.success === false),
  'Gate must reject a recorded incompatible consumer/provider pair, not merely an unavailable Broker.',
);
assert.throws(
  () => requireDeployable('runtime-api', 'never-verified-version'),
  /blocks/,
);
console.log(
  'Broker deployment gate proof PASS: compatible versions allowed; incompatible and unknown versions blocked against the deployed consumer.',
);
