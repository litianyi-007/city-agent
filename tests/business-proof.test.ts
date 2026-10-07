import assert from 'node:assert/strict';
import test from 'node:test';
import { createBusinessProof, renderBusinessProofReport } from '../scripts/create-business-proof.ts';
import { getBusinessDemos, createBusinessDemoRun, businessFixtureResponse, BUSINESS_FIXTURE_POLICY_ID, auditBusinessDemoRun } from '../shared/research-demo.ts';
import { checkQuestionnaireLogic, validateQuestionnaireLogicRules } from '../shared/questionnaire-logic.ts';
import { assertSurveyInputsSafe, executeSurvey, type SurveyExecution } from '../shared/survey-runner.ts';
import { validateAnswers, type Profile } from '../shared/survey-engine.ts';
import { fingerprint } from '../shared/evidence.ts';
import { createDefaultPersona } from '../shared/resident-persona.ts';
import { researchTaskSchema } from '../shared/research-schema.ts';
import { getPopulationPack, getPopulationModel } from '../server/population/service.ts';
import { parseSurveyEvidence } from '../src/run-history.ts';

test('two full synthetic business scenarios retain questionnaires, qualification assumptions, raw prompts, audit and importable evidence', async () => {
  const proof = await createBusinessProof({ id: '77777777-7777-4777-8777-777777777777' });
  assert.equal(proof.cases.length, 2);
  assert.equal(proof.report.modelCalls, 0); assert.equal(proof.report.realModelQuality, 'not-tested');
  assert.equal(proof.report.businessRecommendation, 'not-supported');
  assert.equal(proof.report.qualificationAndBusinessData, 'needs-data');
  for (const { run, report, logicAudit } of proof.cases) {
    assert.equal(run.mode, 'fixture'); assert.equal(run.state, 'completed');
    assert.equal(run.metrics.valid, 12); assert.equal(run.metrics.planned, 12);
    assert.equal(run.metrics.modelCalls, 0); assert.equal(run.metrics.inputTokens, 0); assert.equal(run.metrics.outputTokens, 0); assert.equal(run.metrics.apiCostCny, 0);
    assert.ok(run.task.questionnaire.questions.length >= 12 && run.task.questionnaire.questions.length <= 18);
    assert.equal(researchTaskSchema.safeParse(run.task).success, true);
    assert.deepEqual(new Set(run.task.questionnaire.questions.map(question => question.type)), new Set(['single', 'multiple', 'text', 'number', 'scale']));
    assert.equal(run.parameters?.fixturePolicyId, BUSINESS_FIXTURE_POLICY_ID);
    assert.equal(run.marketResearchValidated, false); assert.equal(run.sampling?.populationWeighted, false);
    assert.equal(logicAudit.status, 'checked'); assert.equal(logicAudit.passed, 12); assert.equal(logicAudit.failed, 0);
    assert.equal(report.targetPopulationDenominator, null);
    assert.ok(report.qualificationPreflight.missingEvidence.length > 0);
    assert.equal(run.presetSnapshots?.length, 4);
    assert.ok(run.sampling?.presets.every(preset => preset.planned === 3));
    assert.equal(run.profileHash, fingerprint(run.profiles)); assert.equal(run.taskHash, fingerprint(run.task));
    assert.ok(report.promptLinks.every(link => link.frozenPersonaMatches));
    for (const profile of run.profiles) {
      assert.equal(profile.persona?.provenance, 'assumption');
      assert.equal(profile.persona?.work.income.lower, null);
      assert.deepEqual(JSON.parse(run.prompt.users.find(user => user.residentId === profile.id)!.text).resident.persona, profile.persona);
      const response = run.responses.find(value => value.residentId === profile.id)!;
      assert.deepEqual(validateAnswers(run.task, profile.id, response.raw), response.answers);
      assert.equal(response.answers.length, run.task.questionnaire.questions.length);
    }
    assert.doesNotThrow(() => parseSurveyEvidence(run));
  }
  const markdown = renderBusinessProofReport(proof);
  assert.match(markdown, /mode=fixture/); assert.match(markdown, /模型调用0/); assert.match(markdown, /17题/); assert.match(markdown, /18题/);
  assert.match(markdown, /child-own-taste全部null/); assert.match(markdown, /主粮/); assert.match(markdown, /不计算真实购买率/);
  assert.equal(JSON.stringify(proof).includes('"apiKey"'), false);
});

test('no-purchase zero, unknown null, child taste unknown and species-specific categories remain distinct', async () => {
  const proof = await createBusinessProof({ seed: 42 });
  for (const { run } of proof.cases) {
    const byIntent = new Map<string, number>();
    for (const response of run.responses) {
      const value = (id: string) => response.answers.find(answer => answer.questionId === id)!.value;
      byIntent.set(String(value('purchase-intent')), (byIntent.get(String(value('purchase-intent'))) ?? 0) + 1);
      if (value('purchase-intent') === 'no') { assert.equal(value('monthly-budget'), 0); assert.equal(value('package-size'), 'none'); assert.deepEqual(value('planned-channels'), ['none']); }
      if (value('purchase-intent') === 'unknown') assert.equal(value('monthly-budget'), null);
      if (run.task.id === 'business-child-snacks') assert.equal(value('child-own-taste'), null);
      else {
        const profile = run.profiles.find(item => item.id === response.residentId)!;
        const cat = profile.attributes.find(item => item.key === 'ownsCat')!.value;
        const dog = profile.attributes.find(item => item.key === 'ownsDog')!.value;
        assert.equal(value('pet-type'), cat && dog ? 'both' : cat ? 'cat' : 'dog');
        if (!cat) assert.ok(!(value('past-snack-categories') as string[]).includes('cat-creamy'));
        if (!dog) assert.ok(!(value('past-snack-categories') as string[]).includes('dog-chew'));
      }
    }
    assert.deepEqual([...byIntent.values()].sort(), [3, 3, 3, 3]);
    const budgetSummary = run.summaries.find(summary => summary.questionId === 'monthly-budget')!;
    assert.equal(budgetSummary.denominator, 6); assert.equal(budgetSummary.missing, 6);
    if (run.task.id === 'business-child-snacks') assert.equal(run.summaries.find(summary => summary.questionId === 'child-own-taste')!.denominator, 0);
  }
});

test('stable evidence repeats across IDs and fixture does not derive purchases from five-layer persona', async () => {
  const first = await createBusinessProof({ seed: 7 }); const second = await createBusinessProof({ seed: 7 });
  assert.notEqual(first.id, second.id);
  assert.equal(first.report.stableEvidenceHash, second.report.stableEvidenceHash);
  for (let index = 0; index < first.cases.length; index++) {
    const run = first.cases[index].run;
    assert.deepEqual(run.responses.map(response => response.raw), second.cases[index].run.responses.map(response => response.raw));
    const profile = run.profiles[0];
    assert.equal(businessFixtureResponse(profile, run.task, 7), businessFixtureResponse({ ...profile, persona: createDefaultPersona() }, run.task, 7));
    // Rotated synthetic cases prevent one preset from always echoing the same fixed purchase answer.
    for (const preset of run.presetSnapshots!) assert.ok(new Set(run.profiles.filter(profile => profile.presetId === preset.id).map(profile => run.responses.find(response => response.residentId === profile.id)!.answers.find(answer => answer.questionId === 'purchase-intent')!.value)).size > 1);
  }
});

test('independent audit catches positive no-purchase budget, exclusive unknown and wrong-species products without rewriting raw', async () => {
  const proof = await createBusinessProof({ seed: 42 });
  for (const { run, logicAudit } of proof.cases) {
    const original = run.responses.find(response => response.answers.find(answer => answer.questionId === 'purchase-intent')!.value === 'no')!;
    const forged = structuredClone(original.answers);
    forged.find(answer => answer.questionId === 'monthly-budget')!.value = 100;
    const raw = JSON.stringify({ residentId: original.residentId, answers: forged });
    assert.doesNotThrow(() => validateAnswers(run.task, original.residentId, raw));
    const audit = checkQuestionnaireLogic(run.task, forged, logicAudit.rules);
    assert.equal(audit.status, 'conflict'); assert.ok(audit.issues.some(issue => issue.ruleId === 'no-purchase-zero-budget'));
    assert.equal(original.answers.find(answer => answer.questionId === 'monthly-budget')!.value, 0);
    const mutuallyExclusive = structuredClone(original.answers);
    mutuallyExclusive.find(answer => answer.questionId === 'planned-channels')!.value = ['online', 'unknown'];
    assert.equal(checkQuestionnaireLogic(run.task, mutuallyExclusive, logicAudit.rules).status, 'conflict');
    if (run.task.id === 'business-pet-snacks') {
      const cat = run.responses.find(response => response.answers.find(answer => answer.questionId === 'pet-type')!.value === 'cat')!;
      const wrongSpecies = structuredClone(cat.answers);
      wrongSpecies.find(answer => answer.questionId === 'past-snack-categories')!.value = ['dog-chew'];
      assert.ok(checkQuestionnaireLogic(run.task, wrongSpecies, logicAudit.rules).issues.some(issue => issue.ruleId === 'cat-only-no-dog-product'));
    }
  }
});

test('independent audit cannot pass empty rules/answers, forged structure flags or missing/duplicate/orphan resident evidence', async () => {
  const { run, logicAudit } = await createBusinessDemoRun({ demoId: 'pet-snacks', population: getPopulationModel(), pack: getPopulationPack() });
  const emptyAnswers = checkQuestionnaireLogic(run.task, [], logicAudit.rules);
  assert.equal(emptyAnswers.status, 'conflict'); assert.equal(emptyAnswers.checked, 0); assert.equal(emptyAnswers.answerStructureValid, false);
  const noRules = checkQuestionnaireLogic(run.task, run.responses[0].answers, []);
  assert.equal(noRules.status, 'not-evaluated'); assert.equal(noRules.checked, 0);
  const noRuleAudit = auditBusinessDemoRun(run, []);
  assert.equal(noRuleAudit.status, 'not-evaluated'); assert.equal(noRuleAudit.passed, 0);
  const forgedAnswers = structuredClone(run);
  for (const response of forgedAnswers.responses) { response.answers = []; response.structureValid = true; }
  const forged = auditBusinessDemoRun(forgedAnswers, logicAudit.rules);
  assert.equal(forged.status, 'conflict'); assert.equal(forged.passed, 0);
  assert.ok(forged.records.every(record => !record.answersMatchRaw && record.rawStructureValid));
  const emptyRaw = structuredClone(run);
  for (const response of emptyRaw.responses) response.raw = JSON.stringify({ residentId: response.residentId, answers: [] });
  assert.equal(auditBusinessDemoRun(emptyRaw, logicAudit.rules).passed, 0);
  const mutations = [
    (value: typeof run) => { value.responses = []; },
    (value: typeof run) => { value.responses.pop(); },
    (value: typeof run) => { value.responses[11] = structuredClone(value.responses[0]); },
    (value: typeof run) => {
      value.responses[0].residentId = 'resident-orphan';
      const raw = JSON.parse(value.responses[0].raw); raw.residentId = 'resident-orphan'; value.responses[0].raw = JSON.stringify(raw);
    },
    (value: typeof run) => { value.profiles[11] = structuredClone(value.profiles[0]); },
    (value: typeof run) => { value.metrics.planned = 0; },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(run); mutate(forged);
    const audit = auditBusinessDemoRun(forged, logicAudit.rules);
    assert.equal(audit.status, 'conflict'); assert.equal(audit.passed, 0); assert.equal(audit.completeDenominator, false);
    assert.ok(audit.mappingIssues.length > 0);
  }
  const empty = structuredClone(run); empty.responses = [];
  assert.equal(auditBusinessDemoRun(empty, logicAudit.rules).evaluated, 0);
  const upstreamFailed = structuredClone(run); upstreamFailed.responses[0].status = 'failed';
  const failed = auditBusinessDemoRun(upstreamFailed, logicAudit.rules);
  assert.equal(failed.status, 'conflict'); assert.equal(failed.passed, 11);
  assert.equal(auditBusinessDemoRun(run, logicAudit.rules).passed, 12);
});

test('logic registry and business entry reject malformed references, bounded inputs and silent new-question completion', async () => {
  const demo = getBusinessDemos()[0];
  assert.throws(() => validateQuestionnaireLogicRules(demo.task, [{ id: 'missing', kind: 'exclusive-options', questionId: 'not-a-question', exclusiveOptionIds: ['none'] }]));
  assert.throws(() => validateQuestionnaireLogicRules(demo.task, [...demo.logicRules, demo.logicRules[0]]));
  assert.throws(() => validateQuestionnaireLogicRules(demo.task, [{ id: 'wrong-value', kind: 'conditional-equals', whenQuestionId: 'purchase-intent', whenValue: 'not-an-option', thenQuestionId: 'monthly-budget', thenValue: 0 }]));
  assert.throws(() => validateQuestionnaireLogicRules(demo.task, [{ id: 'blank-text', kind: 'conditional-equals', whenQuestionId: 'needed-evidence', whenValue: '   ', thenQuestionId: 'monthly-budget', thenValue: 0 }]));
  const literal = validateQuestionnaireLogicRules(demo.task, [{ id: 'literal-text', kind: 'conditional-equals', whenQuestionId: 'needed-evidence', whenValue: '  原文  ', thenQuestionId: 'monthly-budget', thenValue: 0 }]);
  assert.equal(literal[0].kind === 'conditional-equals' && literal[0].whenValue, '  原文  ');
  for (const input of [{ seed: -1 }, { seed: Number.NaN }, { id: '../../old' }, { scenario: 'other' }, { mode: 'live' }, { apiKey: 'synthetic-no-key' }]) await assert.rejects(createBusinessProof(input as Parameters<typeof createBusinessProof>[0]));
  await assert.rejects(createBusinessDemoRun({ demoId: 'other', population: getPopulationModel(), pack: getPopulationPack() } as unknown as Parameters<typeof createBusinessDemoRun>[0]));
  const execution = await createBusinessDemoRun({ demoId: 'child-snacks', population: getPopulationModel(), pack: getPopulationPack() });
  const changed = structuredClone(execution.run.task); changed.questionnaire.questions[0].id = 'new-question';
  assert.throws(() => businessFixtureResponse(execution.run.profiles[0], changed, 42), /须更新/);
  assert.equal(auditBusinessDemoRun(execution.run, demo.logicRules).status, 'checked');
});

function inputFor(run: Awaited<ReturnType<typeof createBusinessDemoRun>>['run']): SurveyExecution {
  return { mode: 'fixture', task: run.task, presets: getBusinessDemos().find(demo => demo.task.id === run.task.id)!.presets,
    count: 12, seed: run.seed, pack: getPopulationPack(), population: getPopulationModel(), pricing: run.pricing!, signal: new AbortController().signal,
    call: async () => { throw new Error('test禁止模型请求'); } };
}

test('trusted fixture injection is paired, fixture-only, validated and redacted on the normal evidence path', async () => {
  const { run } = await createBusinessDemoRun({ demoId: 'child-snacks', population: getPopulationModel(), pack: getPopulationPack() });
  const base = inputFor(run); let called = 0; let saved = 0;
  const fixture = (profile: Profile) => { called++; return businessFixtureResponse(profile, base.task, base.seed); };
  for (const patch of [{ fixtureResponse: fixture }, { fixturePolicyId: BUSINESS_FIXTURE_POLICY_ID }, { fixtureResponse: fixture, fixturePolicyId: '../../invalid' }, { mode: 'live', fixtureResponse: fixture, fixturePolicyId: BUSINESS_FIXTURE_POLICY_ID }]) {
    await assert.rejects(executeSurvey({ ...base, ...patch, checkpoint: async () => { saved++; } } as SurveyExecution));
  }
  assert.equal(called, 0); assert.equal(saved, 0);
  const bad = await executeSurvey({ ...base, fixturePolicyId: 'synthetic-invalid-test', fixtureResponse: () => '{malformed' });
  assert.equal(bad.metrics.valid, 0); assert.equal(bad.metrics.failed, 12); assert.equal(bad.metrics.modelCalls, 0);
  const secret = 'synthetic-control-plane-secret-not-a-key';
  const redacted = await executeSurvey({ ...base, knownSecrets: [secret], fixturePolicyId: 'synthetic-redaction-test', fixtureResponse: (profile, task, seed) => {
    const answer = JSON.parse(businessFixtureResponse(profile, task, seed));
    answer.answers.find((item: { questionId: string }) => item.questionId === 'needed-evidence').value = secret;
    return JSON.stringify(answer);
  } });
  assert.equal(redacted.metrics.modelCalls, 0); assert.equal(JSON.stringify(redacted).includes(secret), false);
  assert.equal(redacted.metrics.valid, 12);
});

test('input guard detects only configured secrets, not ordinary Bearer tutorial examples', () => {
  const secret = 'synthetic-known-control-plane-key';
  assert.doesNotThrow(() => assertSurveyInputsSafe({ title: 'Bearer 场景术语，认证教材示例', description: 'Bearer tutorial-example sk-unrelated-token1234' }, [secret]));
  const unicode = [...secret].map(character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  const mixed = [...secret].map((character, index) => index % 2 ? `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}` : character).join('');
  for (const value of [secret, unicode, mixed]) assert.throws(() => assertSurveyInputsSafe({ description: value }, [secret]), /凭据/);
});

test('frozen qualification, preset/persona and population/count mappings cannot bypass preflight or create checkpoints', async () => {
  const { run } = await createBusinessDemoRun({ demoId: 'child-snacks', population: getPopulationModel(), pack: getPopulationPack() });
  const base = inputFor(run); let requests = 0; let checkpoints = 0;
  const changes: ((profiles: Profile[]) => void)[] = [
    profiles => profiles.pop(), profiles => { profiles[1].id = profiles[0].id; },
    profiles => { profiles[0].presetId = '20000000-0000-4000-8000-000000000000'; },
    profiles => { profiles[0].attributes.find(attribute => attribute.key === 'caregiver')!.value = false; },
    profiles => { profiles[0].attributes.find(attribute => attribute.key === 'childSchoolStage')!.value = 'secondary'; },
    profiles => { profiles[0].attributes.find(attribute => attribute.key === 'caregiver')!.provenance = 'infer'; },
    profiles => { profiles[0].streetName = '伪造街道'; },
    profiles => { profiles[0].persona = createDefaultPersona(); },
  ];
  for (const change of changes) {
    const profiles = structuredClone(run.profiles); change(profiles);
    await assert.rejects(executeSurvey({ ...base, frozenProfiles: profiles, fixtureResponse: businessFixtureResponse, fixturePolicyId: BUSINESS_FIXTURE_POLICY_ID,
      checkpoint: async () => { checkpoints++; }, call: async () => { requests++; throw new Error('不应调用'); } }));
  }
  assert.equal(requests, 0); assert.equal(checkpoints, 0);
  const accepted = await executeSurvey({ ...base, frozenProfiles: run.profiles, fixtureResponse: businessFixtureResponse, fixturePolicyId: BUSINESS_FIXTURE_POLICY_ID });
  assert.equal(accepted.metrics.valid, 12); assert.equal(accepted.metrics.modelCalls, 0);
});
