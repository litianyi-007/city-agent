import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPersonaProof } from '../scripts/create-persona-proof.ts';
import { checkCoherence, fingerprint, residentPrompt, summarize, validateAnswers, type SurveyRun } from '../shared/survey-engine.ts';
import { buildAnalysis, samplingReport } from '../shared/survey-analysis.ts';
import { createCompletenessPlan, evaluateCompleteness, COMPLETENESS_EVALUATION_VERSION } from '../shared/research-evaluation.ts';
import { parseSurveyEvidence, parseSurveyEvidenceWithVerification, EVIDENCE_VERIFIER_VERSION } from '../src/run-history.ts';

const fixture = createPersonaProof({ count: 4 }).then(proof => proof.run);
const thirty = createPersonaProof({ count: 30 }).then(proof => proof.run);
const legacy = readFile(new URL('../public/submission/live-run.json', import.meta.url), 'utf8').then(bytes => JSON.parse(bytes) as SurveyRun);
const copy = async () => structuredClone(await fixture);
function recomputeProfileDerived(run: SurveyRun) {
  run.profileHash = fingerprint(run.profiles);
  for (const user of run.prompt.users) {
    user.text = residentPrompt(run.task, run.profiles.find(profile => profile.id === user.residentId)!, run.exposure ?? 'full');
    user.hash = fingerprint(user.text);
  }
  run.summaries = summarize(run.task, run.responses);
  run.analysis = buildAnalysis(run.task, run.profiles, run.responses);
  run.sampling = samplingReport(run.profiles);
}

test('R4 sampling fields and structural/coherence counters are recomputed, not trusted display metadata', async () => {
  for (const modify of [
    (run: SurveyRun) => { run.sampling!.uniqueProfiles = 999; },
    (run: SurveyRun) => { run.sampling!.duplicateProfiles = -995; },
    (run: SurveyRun) => { run.sampling!.streets = [{ value: '虚构街道', planned: 999 }]; },
    (run: SurveyRun) => { run.metrics.structurallyValid = 999; },
    (run: SurveyRun) => { run.metrics.contradictions = -99; },
    (run: SurveyRun) => { run.populationAudit!.status = 'blocked'; },
  ]) {
    const run = await copy(); modify(run);
    assert.throws(() => parseSurveyEvidence(run), /复算/);
  }
});

test('R4 raw structure cannot be hidden with a false structureValid flag', async () => {
  const run = await copy();
  run.responses[0].structureValid = false;
  delete run.metrics.structurallyValid;
  assert.throws(() => parseSurveyEvidence(run), /结构诊断/);
});

test('R4 failed or unstarted records cannot forge completed diagnostics', async () => {
  const run = await copy(); const response = run.responses[0];
  response.status = 'failed';
  assert.throws(() => parseSurveyEvidence(run), /未启动答卷/);
});

test('R5 age must be an integer inside the registered band even after downstream rehashing', async () => {
  for (const age of [5, -1, 18.5]) {
    const run = await copy();
    run.profiles[0].age = age;
    run.profiles[0].attributes.find(attribute => attribute.key === 'age')!.value = age;
    recomputeProfileDerived(run);
    assert.throws(() => parseSurveyEvidence(run));
  }
});

test('R5 population street, label, age band and sex must resolve to a positive eligible frozen cell', async () => {
  for (const modify of [
    (run: SurveyRun) => { run.profiles[0].street = 'not-a-street'; run.profiles[0].attributes.find(attribute => attribute.key === 'street')!.value = 'not-a-street'; },
    (run: SurveyRun) => { run.profiles[0].streetName = '伪造街道名称'; },
    (run: SurveyRun) => { run.profiles[0].sex = 'not-a-category'; run.profiles[0].attributes.find(attribute => attribute.key === 'sex')!.value = 'not-a-category'; },
    (run: SurveyRun) => { run.profiles[0].ageBand = '0-14'; run.profiles[0].age = 5; run.profiles[0].attributes.find(attribute => attribute.key === 'ageBand')!.value = '0-14'; run.profiles[0].attributes.find(attribute => attribute.key === 'age')!.value = 5; },
  ]) {
    const run = await copy(); modify(run); recomputeProfileDerived(run);
    assert.throws(() => parseSurveyEvidence(run), /人口快照/);
  }
});

test('R5 all four basic attribute mirrors are required and duplicate attributes are rejected', async () => {
  for (const field of ['age', 'street', 'ageBand', 'sex']) {
    const missing = await copy(); missing.profiles[0].attributes = missing.profiles[0].attributes.filter(attribute => attribute.key !== field);
    recomputeProfileDerived(missing); assert.throws(() => parseSurveyEvidence(missing), /镜像/);
    const mismatch = await copy(); mismatch.profiles[0].attributes.find(attribute => attribute.key === field)!.value = field === 'age' ? 0 : 'inconsistent';
    recomputeProfileDerived(mismatch); assert.throws(() => parseSurveyEvidence(mismatch), /镜像/);
  }
  const duplicate = await copy(); duplicate.profiles[0].attributes.push(structuredClone(duplicate.profiles[0].attributes[0]));
  recomputeProfileDerived(duplicate); assert.throws(() => parseSurveyEvidence(duplicate), /重复/);
});

test('R5 task and frozen preset qualification filters are both enforced, including unknown attributes', async () => {
  for (const value of [false, 'unknown']) {
    const run = await copy(); run.profiles[0].attributes.find(attribute => attribute.key === 'petOwner')!.value = value;
    recomputeProfileDerived(run); assert.throws(() => parseSurveyEvidence(run), /资格筛选/);
  }
  const task = await copy(); task.task.population.filters.push({ field: 'undeclaredQualification', op: 'eq', value: true });
  task.taskHash = fingerprint(task.task); recomputeProfileDerived(task);
  assert.throws(() => parseSurveyEvidence(task), /资格筛选/);
});

test('R5 unknown qualifications remain assumptions and cannot acquire inferred evidence', async () => {
  const run = await copy(); const attribute = run.profiles[0].attributes.find(item => item.key === 'petOwner')!;
  attribute.provenance = 'infer'; attribute.evidenceIds = ['xixing:total'];
  recomputeProfileDerived(run); assert.throws(() => parseSurveyEvidence(run), /情景假设/);
  const wrongLink = await copy(); wrongLink.profiles[0].attributes.find(item => item.key === 'sex')!.evidenceIds = ['different-cell'];
  recomputeProfileDerived(wrongLink); assert.throws(() => parseSurveyEvidence(wrongLink), /证据链/);
});

test('R6 required text rejects whitespace-only strings but preserves explicit unknown and original raw', async () => {
  const run = await copy(); const response = run.responses[0];
  const id = run.task.questionnaire.questions.find(question => question.type === 'text' && question.required)!.id;
  for (const value of [' ', '\t', '\n', '\u00a0', ' \t\n']) {
    const answers = structuredClone(response.answers); answers.find(answer => answer.questionId === id)!.value = value;
    const raw = JSON.stringify({ residentId: response.residentId, answers });
    assert.throws(() => validateAnswers(run.task, response.residentId, raw), /题目契约/);
    assert.equal(JSON.parse(raw).answers.find((answer: { questionId: string }) => answer.questionId === id).value, value);
  }
  for (const value of ['未知', '不确定', '不适用', '  未知  ']) {
    const answers = structuredClone(response.answers); answers.find(answer => answer.questionId === id)!.value = value;
    const raw = JSON.stringify({ residentId: response.residentId, answers });
    assert.equal(validateAnswers(run.task, response.residentId, raw).find(answer => answer.questionId === id)!.value, value);
  }
});

test('R6 imported whitespace responses cannot retain valid completion counts', async () => {
  const run = await copy(); const response = run.responses[0];
  const id = run.task.questionnaire.questions.find(question => question.type === 'text')!.id;
  response.answers.find(answer => answer.questionId === id)!.value = ' \n';
  response.raw = JSON.stringify({ residentId: response.residentId, answers: response.answers });
  recomputeProfileDerived(run);
  assert.throws(() => parseSurveyEvidence(run), /结构诊断/);
});

test('R7 real30 candidate gate must also meet a stricter declared completion target', async () => {
  // All fields below remain synthetic declarations; no actual provider request is made.
  const run = structuredClone(await thirty); run.mode = 'live'; run.metrics.modelCalls = 30; run.metrics.apiCostCny = null;
  const last = run.responses.at(-1)!; last.status = 'invalid'; last.structureValid = false; last.answers = []; last.raw = 'invalid-json'; delete last.coherence;
  run.metrics.valid = 29; run.metrics.failed = 1; run.metrics.structurallyValid = 29;
  recomputeProfileDerived(run);
  const strict = createCompletenessPlan(run, { id: 'strict-synthetic', registeredAt: run.startedAt, minimumCompletionRate: 1 });
  const fail = evaluateCompleteness(strict, run);
  assert.equal(fail.counts.valid, 29); assert.equal(fail.counts.minimumValid, 30);
  assert.equal(fail.status, 'threshold-not-met'); assert.equal(fail.realThirtyResidentGate, 'not-met');
  const defaultPlan = createCompletenessPlan(run, { id: '95-synthetic', registeredAt: run.startedAt });
  const passesDeclaredThreshold = evaluateCompleteness(defaultPlan, run);
  assert.equal(passesDeclaredThreshold.status, 'threshold-met');
  assert.equal(passesDeclaredThreshold.realThirtyResidentGate, 'threshold-met-requires-provider-evidence');
  assert.equal(passesDeclaredThreshold.executionIdentity, 'declared-mode-not-independently-attested');
  assert.equal(passesDeclaredThreshold.externalValidity, 'not-validated');
});

test('published v2.0 real-run evidence remains readable without changing raw, version or hashes', async () => {
  const run = structuredClone(await legacy); const before = fingerprint(run);
  const result = parseSurveyEvidenceWithVerification(run);
  assert.equal(result.run, run); assert.equal(result.run.version, 'coverage-survey-2.0');
  assert.equal(fingerprint(run), before); assert.equal(result.verification.rawResponsesModified, false);
  assert.equal(result.verification.verifierVersion, EVIDENCE_VERIFIER_VERSION);
  const plan = createCompletenessPlan(run, { id: 'legacy-current-verifier', registeredAt: run.startedAt });
  const report = evaluateCompleteness(plan, run);
  assert.equal(report.status, 'threshold-met'); assert.equal(report.evaluationVersion, COMPLETENESS_EVALUATION_VERSION);
});

test('legacy absent optional derived fields stay absent, but existing false values are rejected', async () => {
  const run = structuredClone(await legacy);
  delete run.sampling; delete run.metrics.structurallyValid; delete run.metrics.contradictions; delete run.populationAudit;
  const before = fingerprint(run); assert.equal(parseSurveyEvidence(run), run); assert.equal(fingerprint(run), before);
  run.metrics.structurallyValid = 0; assert.throws(() => parseSurveyEvidence(run), /复算/);
});

test('legacy omitted structure flag does not hide an otherwise complete invalid hard-constraint response', async () => {
  const run = structuredClone(await legacy); const response = run.responses[0]; const profile = run.profiles[0];
  const rule = run.task.validationRules!.find(item => item.field === 'street')!;
  const wrong = rule.choices.find(choice => choice.equals !== undefined && choice.equals !== profile.street)!;
  response.answers.find(answer => answer.questionId === rule.questionId)!.value = wrong.optionId;
  response.raw = JSON.stringify({ residentId: response.residentId, answers: response.answers });
  response.status = 'invalid'; delete response.structureValid;
  response.coherence = checkCoherence(run.task, profile, response.answers);
  run.metrics.valid--; run.metrics.failed++; run.metrics.contradictions = 1;
  recomputeProfileDerived(run);
  assert.equal(parseSurveyEvidence(run), run);
  const plan = createCompletenessPlan(run, { id: 'legacy-implicit-structure', registeredAt: run.startedAt });
  const report = evaluateCompleteness(plan, run);
  assert.equal(report.counts.structurallyComplete, 12); assert.equal(report.counts.valid, 11);
});

test('v2.0 without frozen presets is readable but visibly ineligible for qualification scoring', async () => {
  const run = structuredClone(await legacy); delete run.presetSnapshots;
  const parsed = parseSurveyEvidenceWithVerification(run);
  assert.equal(parsed.verification.frozenPresetScope, 'not-available-legacy');
  assert.match(parsed.verification.limitations.join('\n'), /不能声称.*预设资格/);
  const plan = createCompletenessPlan(run, { id: 'legacy-no-preset', registeredAt: run.startedAt });
  const report = evaluateCompleteness(plan, run);
  assert.equal(report.status, 'not-qualified');
  assert.equal(report.checks.find(check => check.id === 'frozen-preset-scope')!.passed, false);
});

test('v2.1 cannot omit its frozen preset scope or map a profile to another preset', async () => {
  const missing = await copy(); delete missing.presetSnapshots;
  assert.throws(() => parseSurveyEvidence(missing), /冻结预设/);
  const mislinked = await copy(); mislinked.profiles[0].presetId = 'unknown-preset'; recomputeProfileDerived(mislinked);
  assert.throws(() => parseSurveyEvidence(mislinked), /冻结人群预设/);
});
