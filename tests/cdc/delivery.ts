import { assertPactSourceVersion } from './broker.js';
import { loadPactEnvironment } from '../../config/environment.mjs';
import { brokerCommand, participants, requireDeployable } from './broker.js';

const config = loadPactEnvironment();
const [operation, participant] = process.argv.slice(2);
if (operation === 'publish') {
  assertPactSourceVersion();
  brokerCommand([
    'publish',
    '.local/pacts/current',
    '--consumer-app-version',
    config.version,
    '--branch',
    config.branch,
  ]);
} else if (operation === 'can-i-deploy') {
  const selected = participant ? [participant] : participants;
  for (const item of selected) {
    requireDeployable(item);
  }
} else if (operation === 'record-deployment') {
  if (
    !participant ||
    !participants.includes(participant as (typeof participants)[number])
  ) {
    throw new Error(
      'Select the participant whose rollout has actually completed.',
    );
  }
  // Recheck immediately before recording; the caller must invoke this only after successful rollout.
  requireDeployable(participant);
  brokerCommand([
    'record-deployment',
    '--pacticipant',
    participant,
    '--version',
    config.version,
    '--environment',
    config.environment,
  ]);
} else {
  throw new Error(
    'Use publish, can-i-deploy [participant], or record-deployment <participant>.',
  );
}
console.log('Pact operation completed: ' + operation);
