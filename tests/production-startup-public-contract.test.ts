import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicCollisionSafe } from '../server/production/public-collision-guard.js';
import { ProductionStore } from '../server/production/store.js';
import { OUTPUT_ENVELOPE_VERSION, OUTPUT_ENVELOPE_INSTRUCTIONS } from '../server/production/output-envelope.js';
import { assertProductionStartupPublicSafe, startupPublicGuardInputs, STARTUP_PUBLIC_GUARD_VERSION } from '../server/production/startup-public-contract.js';
import { OUTPUT_ENVELOPE_ACCEPTANCE_PLAN_INSTRUCTIONS, OUTPUT_ENVELOPE_ACCEPTANCE_GROUP_INSTRUCTIONS, OUTPUT_ENVELOPE_CONSTRUCTION_REVIEW_INSTRUCTIONS, OUTPUT_ENVELOPE_GROUPED_CONTRACT_INSTRUCTIONS, outputContractSnapshot, researchSchema, planSchema } from '../server/production/contracts.js';
import { acceptancePlanSchema } from '../server/production/acceptance-plan.js';
import { outputEnvelopePolicy } from '../server/production/output-envelope.js';
import { PRODUCTION_OUTPUT_ENVELOPE_POLICY_LITERALS, PRODUCTION_STARTUP_GUARD_POLICY_LITERALS, productionApiKeySchema } from '../shared/production-schema.js';

test('startup and free preflight share full fixed material without trimming or mutation', () => {
  const input = { capability: 'offline-single-html', acceptanceStrategy: 'planned-groups-v1' } as const;
  const expected = startupPublicGuardInputs(input); const observed: unknown[] = [];
  assertProductionStartupPublicSafe({ assertStudyPublicSafe: value => { observed.push(value); } }, input);
  assert.deepEqual(observed, expected);
  const instructions = expected.filter((v): v is { instructions: string } => Object.hasOwn(v as object, 'instructions')).map(v => v.instructions);
  assert.deepEqual(instructions, [...Object.values(OUTPUT_ENVELOPE_GROUPED_CONTRACT_INSTRUCTIONS), OUTPUT_ENVELOPE_ACCEPTANCE_PLAN_INSTRUCTIONS, OUTPUT_ENVELOPE_ACCEPTANCE_GROUP_INSTRUCTIONS, OUTPUT_ENVELOPE_CONSTRUCTION_REVIEW_INSTRUCTIONS]);
  assert.deepEqual(expected.filter((v): v is { outputEnvelopes: unknown[] } => Object.hasOwn(v as object, 'outputEnvelopes')).map(v => v.outputEnvelopes), [[outputEnvelopePolicy('researcher', 'research', outputContractSnapshot(researchSchema)), ...['think-design', 'feedback-0', 'feedback-1', 'feedback-2'].map(phase => outputEnvelopePolicy('project-manager', phase, outputContractSnapshot(planSchema))), outputEnvelopePolicy('project-manager', 'acceptance-plan', outputContractSnapshot(acceptancePlanSchema))]]);
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
  for (const literal of [...PRODUCTION_STARTUP_GUARD_POLICY_LITERALS, ...PRODUCTION_OUTPUT_ENVELOPE_POLICY_LITERALS]) for (let start = 0; start < literal.length; start++) for (let end = start + 16; end <= literal.length; end++) assert.equal(productionApiKeySchema.safeParse(literal.slice(start, end)).success, false);
});

test('every complete startup payload stays inside original work limits with six distinct synthetic credential lengths', () => {
  const key = randomBytes(32);
  const credentials = ['product', 'project-manager', 'researcher', 'developer', 'tester', 'verifier'].map(role => {
    const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(`group-fixture-${role}-never-a-real-key`), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
  });
  for (const value of startupPublicGuardInputs({ capability: 'offline-single-html', acceptanceStrategy: 'planned-groups-v1' })) assert.doesNotThrow(() => assertPublicCollisionSafe(value, key, credentials));
  // Test-owned normal credential generations, not a production profile read.
  // This must scan complete material, not silently truncate to fit a budget.
});

test('new complete navigation and instruction tails reject retained Agent/Jev generations without credential decryption', t => {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-envelope-history-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ProductionStore(directory);
  const legacy = store as unknown as { encrypt(secret: string): string; decrypt(secret: string): string; state: { snapshots: Record<string, Array<{ public: unknown; secret?: string }>>; jevSnapshots?: Record<string, { public: unknown; secret?: string }> } };
  legacy.decrypt = () => { throw new Error('Never decrypt test-owned historical credentials for public checks'); };
  for (const source of ['agent-history', 'jev-history']) for (const collision of [OUTPUT_ENVELOPE_VERSION.slice(-16), OUTPUT_ENVELOPE_INSTRUCTIONS.slice(-16), 'groups[].checks[].obligationIds'.slice(-16)]) {
    legacy.state.snapshots = {}; legacy.state.jevSnapshots = {};
    if (source === 'agent-history') legacy.state.snapshots.retained = [{ public: store.agents()[0], secret: legacy.encrypt(collision) }];
    else legacy.state.jevSnapshots.retained = { public: store.jevConfig(), secret: legacy.encrypt(collision) };
    assert.throws(() => assertProductionStartupPublicSafe(store, { capability: 'offline-single-html', acceptanceStrategy: 'planned-groups-v1' }), /凭据.*冲突/);
  }
});
