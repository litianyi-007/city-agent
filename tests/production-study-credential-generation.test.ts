import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { ProductionStore } from '../server/production/store.js';
import { productionApiKeySchema } from '../shared/production-schema.js';

test('study preparation private identity detects encrypted Key generations without reading plaintext', t => {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-study-generation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ProductionStore(directory);
  const verifier = store.agents().find(agent => agent.role === 'verifier')!;
  const secret = 'study-generation-fixture-not-a-real-key';
  const initial = store.studyConfigurationIdentity(verifier.id);
  store.patchAgent(verifier.id, { apiKey: secret });
  const configured = store.studyConfigurationIdentity(verifier.id);
  assert.notEqual(configured, initial);
  store.patchAgent(verifier.id, { apiKey: secret }); // Even a repeated value is a new stored generation.
  const rotated = store.studyConfigurationIdentity(verifier.id);
  assert.notEqual(rotated, configured);
  store.patchJevConfig({ apiKey: 'study-generation-jev-fixture-not-real' });
  const jev = store.studyConfigurationIdentity(verifier.id);
  assert.notEqual(jev, rotated);
  store.patchJevConfig({ timeoutMs: 20000 });
  assert.notEqual(store.studyConfigurationIdentity(verifier.id), jev);
  const stable = store.studyConfigurationIdentity(verifier.id);
  store.secretAgents = () => { throw new Error('Do not decrypt Keys when preparing'); };
  store.secretJevConfig = () => { throw new Error('Do not decrypt Keys when preparing'); };
  assert.equal(store.studyConfigurationIdentity(verifier.id), stable);
  assert.equal(JSON.stringify(store.agents()).includes(stable), false);
  assert.equal(JSON.stringify(store.jevConfig()).includes(stable), false);
  assert.equal(JSON.stringify(store.agents()).includes(secret), false);
  assert.throws(() => store.studyConfigurationIdentity('unknown'), /不存在/);
});

test('credential-free private identity survives restart and changes on removal and selected metadata edits', t => {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-study-generation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ProductionStore(directory);
  const verifier = store.agents().find(agent => agent.role === 'verifier')!;
  store.patchAgent(verifier.id, { apiKey: 'study-generation-fixture-not-a-real-key' });
  const frozen = store.studyConfigurationIdentity(verifier.id);
  assert.equal(new ProductionStore(directory).studyConfigurationIdentity(verifier.id), frozen);
  store.patchAgent(verifier.id, { name: 'Changed verifier' });
  assert.notEqual(store.studyConfigurationIdentity(verifier.id), frozen);
  const renamed = store.studyConfigurationIdentity(verifier.id);
  store.patchAgent(verifier.id, { apiKey: null });
  assert.notEqual(store.studyConfigurationIdentity(verifier.id), renamed);
});

test('retained study source-v3/v4 and current v5 public literals reject all credential-length substrings at schema and store writes', t => {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-study-generation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ProductionStore(directory); const verifier = store.agents().find(agent => agent.role === 'verifier')!;
  for (const literal of ['verifier-study-source-v3', 'verifier-study-source-v4', 'verifier-study-source-v5']) {
    for (let start = 0; start < literal.length; start++) for (let end = start + 16; end <= literal.length; end++) {
      const value = literal.slice(start, end);
      assert.equal(productionApiKeySchema.safeParse(value).success, false);
      assert.throws(() => store.patchAgent(verifier.id, { apiKey: value }));
      assert.throws(() => store.patchJevConfig({ apiKey: value }));
    }
  }
  assert.equal(store.agents().find(agent => agent.id === verifier.id)!.hasApiKey, false); assert.equal(store.jevConfig().hasApiKey, false);
});

test('study literals cannot be credentials; legacy collisions are detected without any plaintext decryption', t => {
  const directory = mkdtempSync(path.join(fileURLToPath(new URL('../', import.meta.url)), '.city-agent-study-generation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new ProductionStore(directory);
  const verifier = store.agents().find(agent => agent.role === 'verifier')!;
  for (const value of ['loopback-engineering', 'localFixtureHttpAttempts', 'single-new-study-no-auto-resume', 'frozenStudySha256']) {
    assert.throws(() => store.patchAgent(verifier.id, { apiKey: value }), /公开|契约/);
    assert.throws(() => store.patchJevConfig({ apiKey: value }), /公开|契约/);
  }
  // Trusted test-only legacy fixture, not a store migration or real Key read.
  const privateStore = store as unknown as { encrypt(value: string): string; decrypt(value: string): string;
    state: { agents: Array<{ public: { id: string }; secret?: string }>; snapshots: Record<string, Array<{ public: { id: string }; secret?: string }>> } };
  privateStore.state.agents.find(agent => agent.public.id === verifier.id)!.secret = privateStore.encrypt('loopback-engineering');
  privateStore.decrypt = () => { throw new Error('Free public collision checks must never decrypt stored credentials'); };
  assert.throws(() => store.assertStudyPublicSafe({ executionSource: 'loopback-engineering' }), /冲突/);
  assert.doesNotThrow(() => store.assertStudyPublicSafe({ executionSource: 'real-provider', status: 'running' }));
  privateStore.state.agents.find(agent => agent.public.id === verifier.id)!.secret = privateStore.encrypt('localFixtureHttpAttempts');
  assert.throws(() => store.assertStudyPublicSafe({ localFixtureHttpAttempts: 0 }), /冲突/);
  assert.throws(() => store.assertStudyPublicSafe({ prefixlocalFixtureHttpAttemptssuffix: 0 }), /冲突/);
  const legacy = 'legacy-fixture-key' + String.fromCharCode(92, 34) + 'escaped';
  privateStore.state.agents.find(agent => agent.public.id === verifier.id)!.secret = privateStore.encrypt(legacy);
  assert.throws(() => store.assertStudyPublicSafe({ name: legacy }), /冲突/);
  assert.throws(() => store.assertStudyPublicSafe({ [legacy]: 'public' }), /冲突/);
  const unicode = 'legacy-fixture-' + String.fromCharCode(0x4e2d, 0x6587) + '-credential';
  privateStore.state.agents.find(agent => agent.public.id === verifier.id)!.secret = privateStore.encrypt(unicode);
  assert.throws(() => store.assertStudyPublicSafe({ name: unicode }), /冲突/);
  assert.throws(() => store.assertStudyPublicSafe({ name: 'x'.repeat(200000) }), /超限/);
  privateStore.state.snapshots.historical = [{ public: { id: 'historical-only' }, secret: privateStore.encrypt('loopback-engineering') }];
  delete privateStore.state.agents.find(agent => agent.public.id === verifier.id)!.secret;
  assert.throws(() => store.assertStudyPublicSafe({ executionSource: 'loopback-engineering' }), /冲突/);
});
