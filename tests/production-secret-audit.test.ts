import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { ProductionStore } from '../server/production/store.js';
import { productionAgentInputSchema, productionAgentPatchSchema, PRODUCTION_CREDENTIAL_POLICY_VERSION } from '../shared/production-schema.js';
import { JEV_ENDPOINT, jevConfigPatchSchema } from '../shared/jev-schema.js';

const SAFE_KEY = 'unit-valid-token-A0_-+/=.value:tail';
const LEGACY_KEY = 'legacy-unit-"fixture\\key-not-real';
function fixture(t: TestContext) {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-secret-audit-unit-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new ProductionStore(directory) };
}

test('new production and Jev keys reject structural words, controls and JSON-significant credentials without provider-prefix assumptions', () => {
  assert.equal(PRODUCTION_CREDENTIAL_POLICY_VERSION, 'visible-token-v2');
  for (const apiKey of ['e', 'completed', 'short-unit-key', 'too-long-'.repeat(70), 'unit-invalid-token with-space', 'unit-invalid-token\nwith-newline', 'unit-invalid-token\twith-tab', 'unit-invalid-token-"quoted', "unit-invalid-token-'quoted", 'unit-invalid-token-\\slash', 'unit-invalid-token-中文', ' unit-valid-token-long-enough']) {
    assert.equal(productionAgentInputSchema.safeParse({ name: 'Unit', role: 'tester', apiKey }).success, false);
    assert.equal(productionAgentPatchSchema.safeParse({ apiKey }).success, false);
    assert.equal(jevConfigPatchSchema.safeParse({ apiKey }).success, false);
  }
  assert.equal(productionAgentInputSchema.parse({ name: 'Unit', role: 'tester', apiKey: SAFE_KEY }).apiKey, SAFE_KEY);
  assert.equal(jevConfigPatchSchema.parse({ apiKey: SAFE_KEY }).apiKey, SAFE_KEY);
  assert.equal(productionAgentPatchSchema.parse({ apiKey: null }).apiKey, null);
  assert.equal(jevConfigPatchSchema.parse({ apiKey: null }).apiKey, null);
});

test('invalid new Key is rejected before it can corrupt completion status or mutate encrypted configuration', t => {
  const { store, directory } = fixture(t); const id = store.agents()[0].id;
  store.patchAgent(id, { apiKey: SAFE_KEY }); const before = readFileSync(path.join(directory, 'production/state.json'), 'utf8');
  assert.throws(() => store.patchAgent(id, { apiKey: 'completed' }), /16–500/);
  assert.throws(() => store.patchJevConfig({ apiKey: 'e' }), /16–500/);
  assert.equal(readFileSync(path.join(directory, 'production/state.json'), 'utf8'), before);
  assert.deepEqual(store.sanitize({ status: 'completed', rawOutput: SAFE_KEY, [SAFE_KEY]: { message: SAFE_KEY } }), { status: 'completed', rawOutput: '[REDACTED]', '[REDACTED]': { message: '[REDACTED]' } });
});

test('legacy encrypted credentials with quotes and slashes survive restart but cannot leak through literal or nested raw JSON', t => {
  const { store, directory } = fixture(t); const id = store.agents()[0].id; store.patchAgent(id, { apiKey: SAFE_KEY });
  const statePath = path.join(directory, 'production/state.json'); const state = JSON.parse(readFileSync(statePath, 'utf8'));
  // Seed ONLY a synthetic legacy ciphertext, never read/migrate user keys. The
  // new public policy does not rewrite historical encrypted configurations.
  state.agents[0].secret = (store as unknown as { encrypt(value: string): string }).encrypt(LEGACY_KEY);
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 }); const restored = new ProductionStore(directory);
  assert.equal(restored.secretAgents([id])[0].apiKey, LEGACY_KEY);
  const raw = JSON.stringify({ goal: LEGACY_KEY, [LEGACY_KEY]: LEGACY_KEY }); const nested = JSON.stringify({ raw });
  const safe = restored.sanitize({ rawOutput: raw, nestedRaw: nested, [LEGACY_KEY]: { value: LEGACY_KEY }, status: 'completed' });
  assert.equal(JSON.parse(safe.rawOutput).goal, '[REDACTED]'); assert.equal(JSON.parse(JSON.parse(safe.nestedRaw).raw).goal, '[REDACTED]'); assert.deepEqual((safe as Record<string, unknown>)['[REDACTED]'], { value: '[REDACTED]' }); assert.equal(safe.status, 'completed');
  assert.equal(JSON.stringify(safe).includes(LEGACY_KEY), false);
  restored.saveJevBenchmark({ id: 'unit-benchmark', rawOutput: raw, nestedRaw: nested, [LEGACY_KEY]: LEGACY_KEY });
  const publicEntry = restored.jevBenchmarks()[0] as { rawOutput: string; nestedRaw: string };
  assert.equal(JSON.parse(publicEntry.rawOutput).goal, '[REDACTED]'); assert.equal(JSON.parse(JSON.parse(publicEntry.nestedRaw).raw).goal, '[REDACTED]');
});

test('protocol/version and public-configuration collisions cannot become masking credentials', t => {
  const { store, directory } = fixture(t); const agent = store.agents()[0]; const before = readFileSync(path.join(directory, 'production/state.json'), 'utf8');
  for (const apiKey of ['fixture-with-real-jev', 'production-html-v2', 'production-html-v3', 'production-acceptance-v2', 'production-camera-scene-v2', 'production-camera-acceptance-v1', 'production-camera-delivery-v1', 'verifier-phase-ordinal-v2', 'camera-scene-runtime-v1', 'camera-hand-worker-v1', 'camera-scene-behavior-v1', 'hand-geometry-v1', 'mediapipe-hand-v1', 'visible-token-v2', 'raw-wire-usage-v1', 'budgetAuthorized', 'selectedCandidateId', JEV_ENDPOINT, agent.id, agent.baseUrl]) {
    assert.throws(() => store.patchAgent(agent.id, { apiKey }), /API Key/); assert.throws(() => store.patchJevConfig({ apiKey }), /API Key/);
  }
  for (const apiKey of ['long-unit-public-name', 'long-unit-public-model']) assert.throws(() => store.addAgent({ name: 'long-unit-public-name', role: 'tester', modelId: 'long-unit-public-model', apiKey }), /API Key/);
  store.patchAgent(agent.id, { apiKey: SAFE_KEY }); assert.throws(() => store.patchAgent(agent.id, { name: SAFE_KEY }), /API Key/); assert.throws(() => store.patchAgent(agent.id, { modelId: SAFE_KEY }), /API Key/);
  assert.throws(() => store.patchAgent(store.agents()[1].id, { name: `Other agent ${SAFE_KEY}` }), /API Key/);
  assert.throws(() => store.addAgent({ name: `New agent ${SAFE_KEY}`, role: 'researcher' }), /API Key/);
  assert.throws(() => store.addAgent({ name: `New key ${SAFE_KEY}`, role: 'researcher', apiKey: SAFE_KEY }), /API Key/);
  store.patchAgent(agent.id, { apiKey: null });
  assert.equal(store.sanitize({ status: 'completed', evidenceKind: 'fixture-with-real-jev', promptVersion: 'production-html-v2' }).status, 'completed');
  assert.equal(JSON.parse(before).runs.length, 0); assert.equal(store.agents()[0].name, agent.name);
});
