import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertProductionStartupPublicSafe, startupPublicGuardInputs, STARTUP_PUBLIC_GUARD_VERSION } from '../server/production/startup-public-contract.js';
import { STEP_AUDITED_ACCEPTANCE_PLAN_INSTRUCTIONS, STEP_AUDITED_ACCEPTANCE_GROUP_INSTRUCTIONS, STEP_AUDITED_CONSTRUCTION_REVIEW_INSTRUCTIONS, STEP_AUDITED_GROUPED_CONTRACT_INSTRUCTIONS } from '../server/production/contracts.js';
import { PRODUCTION_STARTUP_GUARD_POLICY_LITERALS, productionApiKeySchema } from '../shared/production-schema.js';

test('startup and free preflight share full fixed material without trimming or mutation', () => {
  const input = { capability: 'offline-single-html', acceptanceStrategy: 'planned-groups-v1' } as const;
  const expected = startupPublicGuardInputs(input); const observed: unknown[] = [];
  assertProductionStartupPublicSafe({ assertStudyPublicSafe: value => { observed.push(value); } }, input);
  assert.deepEqual(observed, expected);
  const instructions = expected.filter((v): v is { instructions: string } => Object.hasOwn(v as object, 'instructions')).map(v => v.instructions);
  assert.deepEqual(instructions, [...Object.values(STEP_AUDITED_GROUPED_CONTRACT_INSTRUCTIONS), STEP_AUDITED_ACCEPTANCE_PLAN_INSTRUCTIONS, STEP_AUDITED_ACCEPTANCE_GROUP_INSTRUCTIONS, STEP_AUDITED_CONSTRUCTION_REVIEW_INSTRUCTIONS]);
  assert.deepEqual(input, { capability: 'offline-single-html', acceptanceStrategy: 'planned-groups-v1' });
  assert.deepEqual(startupPublicGuardInputs(input), expected);
});

test('unrelated paths do not claim grouped checks; failures stop every subsequent fixed payload', () => {
  const camera = startupPublicGuardInputs({ capability: 'camera-scene-v1' });
  assert.equal(camera.length, 1); assert.deepEqual(camera[0], { startupGuardProtocolLiterals: PRODUCTION_STARTUP_GUARD_POLICY_LITERALS });
  const offline = startupPublicGuardInputs({ capability: 'offline-single-html' }); assert.equal(offline.length, 2);
  let calls = 0;
  assert.throws(() => assertProductionStartupPublicSafe({ assertStudyPublicSafe: () => { if (++calls === 3) throw new Error('synthetic guard'); } }, { capability: 'offline-single-html', acceptanceStrategy: 'planned-groups-v1' }), /synthetic guard/);
  assert.equal(calls, 3);
});

test('new guard version and public identifiers reject every credential-length substring', () => {
  assert.equal(STARTUP_PUBLIC_GUARD_VERSION, 'production-startup-public-guard-v1');
  for (const literal of PRODUCTION_STARTUP_GUARD_POLICY_LITERALS) for (let start = 0; start < literal.length; start++) for (let end = start + 16; end <= literal.length; end++) assert.equal(productionApiKeySchema.safeParse(literal.slice(start, end)).success, false);
});
