import assert from 'node:assert/strict';
import test from 'node:test';
import { createBusinessDemoRun } from '../shared/research-demo';
import { getPopulationModel, getPopulationPack } from '../server/population/service';
import { parseBusinessProofSnapshot } from '../src/business-proof-history';

test('complete business proof preserves its own frozen rules and rejects forged diagnostics or private envelope fields', async () => {
  const result = await createBusinessDemoRun({ demoId: 'child-snacks', population: getPopulationModel(), pack: getPopulationPack(), seed: 20261007 });
  const proof = { schemaVersion: '1.0', kind: 'business-demo-proof', execution: 'fixture-only', realModelCalls: 0, run: result.run, logicAudit: result.logicAudit };
  assert.deepEqual(parseBusinessProofSnapshot(proof), proof);
  assert.throws(() => parseBusinessProofSnapshot({ ...proof, apiKey: 'synthetic-unrecognized-secret' }));
  const forged = structuredClone(proof); forged.logicAudit.passed = 99;
  assert.throws(() => parseBusinessProofSnapshot(forged), /跨题审计/);
  const altered = structuredClone(proof); altered.logicAudit.rules = [];
  assert.throws(() => parseBusinessProofSnapshot(altered), /跨题审计/);
});
