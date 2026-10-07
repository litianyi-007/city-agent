import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { getPopulationModel, getPopulationPack } from '../server/population/service';
import { fingerprint } from '../shared/evidence';
import { diagnoseBusinessResearchRun, evaluateBusinessResearchContent } from '../shared/research-diagnostics';
import { createBusinessDemoRun, getBusinessDemos, type BusinessDemoId } from '../shared/research-demo';
import { validateAnswers, type Answer, type SurveyRun } from '../shared/survey-engine';

const root = path.resolve(import.meta.dirname, '..');
const fixtureRuns = Promise.all((['child-snacks', 'pet-snacks'] as const).map(demoId => createBusinessDemoRun({
  demoId, population: getPopulationModel(), pack: getPopulationPack(), seed: 20261007,
})));
const demo = (id: BusinessDemoId) => getBusinessDemos().find(item => item.id === id)!;
async function fixture(id: BusinessDemoId = 'child-snacks') { return structuredClone((await fixtureRuns)[id === 'child-snacks' ? 0 : 1].run); }
const audit = (run: SurveyRun, scenarioId: BusinessDemoId = 'child-snacks') => diagnoseBusinessResearchRun(run, { scenarioId, logicRules: demo(scenarioId).logicRules });
function replaceAnswers(run: SurveyRun, overrides: Record<string, Answer['value']>, index = 0) {
  const response = run.responses[index];
  response.answers = response.answers.map(answer => ({ ...answer, value: Object.hasOwn(overrides, answer.questionId) ? overrides[answer.questionId] : answer.value }));
  response.raw = JSON.stringify({ residentId: response.residentId, answers: response.answers });
  response.status = 'valid'; response.structureValid = true;
  validateAnswers(run.task, response.residentId, response.raw);
}

test('all business unknown/null is structurally legal and passes registered gates but remains information-insufficient', async () => {
  for (const id of ['child-snacks', 'pet-snacks'] as const) {
    const run = await fixture(id);
    const overrides = Object.fromEntries(run.task.questionnaire.questions.map(question => [question.id,
      question.required ? question.type === 'multiple' ? ['unknown'] : 'unknown' : null])) as Record<string, Answer['value']>;
    if (id === 'child-snacks') Object.assign(overrides, { eligibility: 'eligible', 'child-evidence': 'not-collected' });
    else Object.assign(overrides, { 'pet-type': run.responses[0].answers.find(answer => answer.questionId === 'pet-type')!.value, 'purchase-role': ['purchaser'] });
    replaceAnswers(run, overrides);
    const before = fingerprint(run); const result = audit(run, id); const record = result.records[0];
    assert.equal(record.state, 'checked'); assert.equal(record.passed, true);
    assert.equal(record.logic.status, 'checked'); assert.equal(record.qualification.status, 'checked');
    assert.equal(record.content.status, 'information-insufficient');
    assert.ok('nonUnknownQuota' in record.content); assert.equal(record.content.nonUnknownQuota, null);
    assert.equal(record.content.knownBusinessQuestions, 0); assert.equal(record.content.realWorldSufficiency, 'not-supported');
    assert.equal(result.denominatorUnits.directlySurveyedChildren, id === 'child-snacks' ? 0 : null);
    assert.equal(result.denominatorUnits.uniqueSelectedChildren, null);
    assert.equal(result.marketResearchValidated, false); assert.equal(fingerprint(run), before);
  }
});

test('unstarted rows and absent rows retain planned denominator without invented identity conflicts', async () => {
  const run = await fixture();
  run.responses[0] = { residentId: run.profiles[0].id, status: 'not-started', answers: [], raw: '', durationMs: 0, inputTokens: 0, outputTokens: 0 };
  run.responses.splice(1, 1);
  const result = audit(run);
  assert.equal(result.planned, 12); assert.equal(result.records.length, 12);
  assert.equal(result.records[0].state, 'not-started'); assert.equal(result.records[1].state, 'unknown');
  assert.equal(result.records[0].qualification.status, 'not-evaluated');
  assert.deepEqual(result.records[0].qualification.issues, []);
  assert.deepEqual(result.records[0].logic.reasons, ['request-not-started']);
  assert.equal(result.summary.unknown, 1); assert.equal(result.summary.notStarted, 1);
  assert.equal(result.summary.acceptedAgainstPlanned, null);
  assert.ok(result.mappingIssues.some(issue => issue.code === 'missing-response'));
});

test('raw structural failure blocks logic and qualification; flags never confer success', async () => {
  const run = await fixture();
  const envelope = JSON.parse(run.responses[0].raw);
  envelope.answers.find((answer: Answer) => answer.questionId === 'purchase-role').value = 'unknown';
  run.responses[0].raw = JSON.stringify(envelope);
  const record = audit(run).records[0];
  assert.equal(record.state, 'structure-blocked'); assert.equal(record.structure.rawStructureValid, false);
  assert.equal(record.structure.sourceFlagConsistent, false);
  assert.deepEqual(record.logic.reasons, ['raw-contract-invalid']);
  assert.deepEqual(record.qualification.issues, []); assert.equal(record.qualification.status, 'not-evaluated');
  assert.equal(record.content.status, 'not-evaluated');
});

test('valid raw with invalid flags, invalid upstream status, or stored answers mismatch is separately blocked', async () => {
  for (const mutation of [
    (run: SurveyRun) => { run.responses[0].structureValid = false; },
    (run: SurveyRun) => { run.responses[0].status = 'invalid'; },
    (run: SurveyRun) => { run.responses[0].answers = []; },
    (run: SurveyRun) => { run.responses[0].status = 'not-started'; },
  ]) {
    const run = await fixture(); mutation(run); const before = fingerprint(run); const record = audit(run).records[0];
    assert.equal(record.state, 'structure-blocked'); assert.equal(record.passed, false);
    assert.equal(record.qualification.status, 'not-evaluated'); assert.equal(record.logic.status, 'not-evaluated');
    assert.equal(fingerprint(run), before);
  }
});

test('duplicate, missing and orphan mappings and recorded planned mismatch cannot manufacture denominator acceptance', async () => {
  const run = await fixture();
  run.responses.push(structuredClone(run.responses[0]), { ...structuredClone(run.responses[1]), residentId: 'orphan' });
  run.profiles[2].id = run.profiles[3].id; run.metrics.planned = 99;
  const result = audit(run);
  assert.equal(result.planned, 12); assert.equal(result.recordedPlanned, 99); assert.equal(result.completeDenominator, false);
  assert.equal(result.records[0].state, 'unknown'); assert.equal(result.records[2].state, 'unknown');
  assert.equal(result.orphans.length, 2); assert.equal(result.summary.acceptedAgainstPlanned, null);
  for (const code of ['duplicate-profile-id', 'duplicate-response-id', 'orphan-response', 'recorded-planned-mismatch']) assert.ok(result.mappingIssues.some(issue => issue.code === code));
});

test('known qualification conflict, unknown qualification and unevaluated logic have distinct causes', async () => {
  const run = await fixture(); replaceAnswers(run, { eligibility: 'unknown' });
  let record = audit(run).records[0];
  assert.equal(record.state, 'checked'); assert.equal(record.logic.status, 'checked');
  assert.equal(record.qualification.status, 'not-evaluated'); assert.deepEqual(record.qualification.reasons, ['qualification-answer-unknown:eligibility']);
  replaceAnswers(run, { eligibility: 'ineligible' }); record = audit(run).records[0];
  assert.equal(record.qualification.status, 'conflict'); assert.equal(record.logic.status, 'checked');
  replaceAnswers(run, { eligibility: 'eligible' });
  run.profiles[0].attributes = run.profiles[0].attributes.filter(attribute => attribute.key !== 'caregiver');
  record = diagnoseBusinessResearchRun(run, { scenarioId: 'child-snacks', logicRules: [] }).records[0];
  assert.equal(record.qualification.status, 'not-evaluated'); assert.deepEqual(record.logic.reasons, ['no-registered-rules']);
  const duplicate = await fixture(); duplicate.profiles[0].attributes.push({ ...duplicate.profiles[0].attributes[0] });
  assert.deepEqual(audit(duplicate).records[0].qualification.reasons, ['duplicate-profile-attribute']);
  assert.throws(() => audit(duplicate, 'pet-snacks'), /诊断场景与冻结问卷不一致/);
});

test('unreachable child original and unprovided pet history remain separate; known past purchases and zero are generated scenarios', async () => {
  const child = await fixture(); const pet = await fixture('pet-snacks');
  const childContent = evaluateBusinessResearchContent('child-snacks', child.task, child.responses[0].answers);
  assert.equal(childContent.questions.find(question => question.questionId === 'child-own-taste')!.knowledge, 'unreachable-this-protocol');
  replaceAnswers(pet, { 'past-frequency': 'unknown', 'past-snack-categories': ['unknown'] });
  let content = evaluateBusinessResearchContent('pet-snacks', pet.task, pet.responses[0].answers);
  assert.equal(content.questions.find(question => question.questionId === 'past-frequency')!.knowledge, 'reachable-input-not-provided');
  replaceAnswers(pet, { 'past-frequency': 'none', 'past-snack-categories': ['none'], 'purchase-intent': 'no', 'monthly-budget': 0 });
  content = evaluateBusinessResearchContent('pet-snacks', pet.task, pet.responses[0].answers);
  assert.equal(content.questions.find(question => question.questionId === 'past-frequency')!.source, 'scenario-generated');
  assert.equal(content.questions.find(question => question.questionId === 'monthly-budget')!.valueState, 'known');
  pet.profiles[0].persona = undefined; pet.profiles[0].description = '教育、人格或收入变化不得补偏好';
  assert.deepEqual(evaluateBusinessResearchContent('pet-snacks', pet.task, pet.responses[0].answers), content);
});

const historyDirectory = path.join(root, 'output/contract-review-appendix/f736fda5-2b12-4918-b843-1421e1c76454/submission-contract11');
const manifestPath = path.join(historyDirectory, 'manifest.json');
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
test('immutable real 1.1 history replays 1 logic conflict, 1 structure block and 15 not-started without regrading', {
  skip: !existsSync(manifestPath) && 'Local immutable 1.1 archive is absent; no fixture is substituted for historical evidence.',
}, () => {
  const manifestHash = 'bf0e32a746720265ac33e7432a783e996d8a08028f8c620d277ed419a803b1e8';
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { files: { name: string; sha256: string }[] };
  const verify = () => { assert.equal(sha256(manifestPath), manifestHash); for (const file of manifest.files) assert.equal(sha256(path.join(historyDirectory, file.name)), file.sha256, file.name); };
  verify();
  for (const id of ['child-snacks', 'pet-snacks'] as const) {
    const run = JSON.parse(readFileSync(path.join(historyDirectory, id, 'survey-run.json'), 'utf8')) as SurveyRun;
    const originalAudit = JSON.parse(readFileSync(path.join(historyDirectory, id, 'logic-audit.json'), 'utf8'));
    const before = fingerprint(run); const result = diagnoseBusinessResearchRun(run, { scenarioId: id, logicRules: originalAudit.rules });
    assert.equal(result.planned, 10); assert.equal(result.summary.notStarted, id === 'child-snacks' ? 9 : 6);
    assert.equal(result.summary.structureBlocked, id === 'child-snacks' ? 0 : 1);
    assert.equal(result.summary.logic.conflict, id === 'child-snacks' ? 1 : 0);
    assert.equal(result.summary.qualification.conflict, 0); assert.equal(result.summary.acceptedAgainstPlanned, id === 'child-snacks' ? 0 : 3);
    assert.equal(result.summary.qualification.notEvaluated, id === 'child-snacks' ? 9 : 7);
    assert.equal(fingerprint(run), before);
  }
  verify();
});
