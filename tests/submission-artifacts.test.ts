import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from 'js-sha256';
import { createBusinessProof, renderBusinessProofReport } from '../scripts/create-business-proof';
import { verifySubmissionArtifacts, submissionPromptsText, SUBMISSION_BUSINESS_FILE_NAMES } from '../shared/submission-artifacts';

async function fixture(seed = 20261007) {
  const proof = await createBusinessProof({ id: '30000000-0000-4000-8000-000000000001', seed });
  const report = { ...proof.report, cases: proof.cases.map(value => value.report) };
  const files: Record<string, string> = { 'business-proof.json': JSON.stringify(report, null, 2), 'proof-report.md': renderBusinessProofReport(proof) };
  for (const value of proof.cases) {
    const { run, logicAudit } = value; const id = value.demo.id;
    for (const [name, payload] of [['questionnaire.json', run.task], ['presets.json', run.presetSnapshots], ['survey-run.json', run],
      ['logic-audit.json', logicAudit], ['raw-responses.json', run.responses],
      ['statistics.json', { summaries: run.summaries, analysis: run.analysis, sampling: run.sampling, metrics: run.metrics }]] as const) files[`${id}/${name}`] = JSON.stringify(payload, null, 2);
    files[`${id}/prompts.txt`] = submissionPromptsText(run);
  }
  const manifest = { schemaVersion: '1.0', proofVersion: report.proofVersion, id: proof.id, mode: 'fixture', policyId: 'business-consistent-synthetic-v1', modelCalls: 0, notice: report.notice,
    files: Object.entries(files).map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value).byteLength, sha256: sha256(value) })) };
  return { proofId: proof.id, proof: report, manifest, files };
}
const original = fixture();
const copy = async () => structuredClone(await original);
function rehash(input: Awaited<ReturnType<typeof fixture>>) {
  input.files['business-proof.json'] = JSON.stringify(input.proof, null, 2);
  input.manifest.files = Object.entries(input.files).map(([name, value]) => ({ name, bytes: new TextEncoder().encode(value).byteLength, sha256: sha256(value) }));
}

test('submission mirrors accept registered zero-model proof without mutating evidence', async () => {
  const input = await copy(); const before = structuredClone(input);
  const result = verifySubmissionArtifacts(input);
  assert.equal(result.cases.length, 2); assert.equal(result.verification.marketResearchValidated, false);
  assert.deepEqual(input, before); assert.equal(result.verification.registeredFiles.length, 16);
});
test('submission rejects scenario swapping and unregistered fixture policy even with recalculated byte hashes', async () => {
  const swapped = await copy();
  for (const name of ['survey-run.json', 'logic-audit.json']) swapped.files[`child-snacks/${name}`] = swapped.files[`pet-snacks/${name}`];
  rehash(swapped); assert.throws(() => verifySubmissionArtifacts(swapped), /场景/);
  const policy = await copy(); const run = JSON.parse(policy.files['child-snacks/survey-run.json']); run.parameters.fixturePolicyId = 'unregistered-fixture-policy';
  policy.files['child-snacks/survey-run.json'] = JSON.stringify(run); rehash(policy);
  assert.throws(() => verifySubmissionArtifacts(policy), /登记/);
});
test('submission rejects drift in questionnaire, presets, raw and statistics mirrors after rehash', async () => {
  for (const name of ['questionnaire.json', 'presets.json', 'raw-responses.json', 'statistics.json']) {
    const input = await copy(); input.files[`child-snacks/${name}`] = JSON.stringify({ stale: true }); rehash(input);
    assert.throws(() => verifySubmissionArtifacts(input), /附件与冻结run不一致/);
  }
});
test('submission rejects readable prompt drift after rehash', async () => {
  const input = await copy(); input.files['pet-snacks/prompts.txt'] += '\nsynthetic stale prompt'; rehash(input);
  assert.throws(() => verifySubmissionArtifacts(input), /Prompt/);
});
test('submission rejects total-ledger metrics, validity and prompt-link upgrades after rehash', async () => {
  const metrics = await copy(); metrics.proof.cases[0].metrics.valid = 99; rehash(metrics);
  assert.throws(() => verifySubmissionArtifacts(metrics), /总账/);
  const validity = await copy(); validity.proof.cases[0].personaBehaviorValidated = true as never; rehash(validity);
  assert.throws(() => verifySubmissionArtifacts(validity), /效度/);
  const links = await copy(); links.proof.cases[1].promptLinks[0].rawHash = '0'.repeat(64); rehash(links);
  assert.throws(() => verifySubmissionArtifacts(links), /promptLinks/);
});
test('submission verifies seed lineage rather than assuming default seed', async () => {
  const input = await fixture(42); assert.equal(verifySubmissionArtifacts(input).cases[0].run.seed, 42);
  input.proof.seed = 20261007; rehash(input);
  assert.throws(() => verifySubmissionArtifacts(input), /seed/);
});
test('submission manifest rejects missing, duplicate, extra and path-style payloads', async () => {
  assert.equal(new Set(SUBMISSION_BUSINESS_FILE_NAMES).size, 16);
  const missing = await copy(); delete missing.files['pet-snacks/prompts.txt']; assert.throws(() => verifySubmissionArtifacts(missing), /清单/);
  const duplicate = await copy(); duplicate.manifest.files[1] = { ...duplicate.manifest.files[0] }; assert.throws(() => verifySubmissionArtifacts(duplicate), /清单/);
  for (const name of ['private-notes.json', '../other.json', 'child-snacks/private-notes.json']) {
    const extra = await copy(); extra.files[name] = '{}'; assert.throws(() => verifySubmissionArtifacts(extra), /清单/);
  }
});
test('submission manifest rejects byte drift, total identity and metadata contradictions', async () => {
  const bytes = await copy(); bytes.files['proof-report.md'] += 'changed'; assert.throws(() => verifySubmissionArtifacts(bytes), /字节/);
  const identity = await copy(); identity.manifest.id = '30000000-0000-4000-8000-000000000002'; assert.throws(() => verifySubmissionArtifacts(identity), /身份/);
  const global = await copy(); global.proof.personaBehaviorValidated = true as never; rehash(global); assert.throws(() => verifySubmissionArtifacts(global));
  const stable = await copy(); stable.proof.stableEvidenceHash = '0'.repeat(64); rehash(stable); assert.throws(() => verifySubmissionArtifacts(stable), /总指纹/);
});
test('submission rejects explicit private fields in otherwise internally consistent case metadata', async () => {
  const input = await copy();
  Object.assign(input.proof.cases[0], { headers: { Authorization: 'Bearer synthetic-only-not-a-real-key' } }); rehash(input);
  assert.throws(() => verifySubmissionArtifacts(input), /凭据字段/);
});
test('submission requires declared model roster to match its frozen presets even without actual requests', async () => {
  const input = await copy(); const run = JSON.parse(input.files['pet-snacks/survey-run.json']); run.models = [];
  input.files['pet-snacks/survey-run.json'] = JSON.stringify(run); rehash(input);
  assert.throws(() => verifySubmissionArtifacts(input), /模型标识/);
});
