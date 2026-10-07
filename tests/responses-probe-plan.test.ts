import assert from 'node:assert/strict';
import test from 'node:test';
import { compileAnswerContract, encodeAnswerContract } from '../shared/answer-contract';
import { fingerprint } from '../shared/evidence';
import { getBusinessDemos } from '../shared/research-demo';
import { createResponsesProbeCases, evaluateResponsesProbeAnswer, RESPONSES_PROBE_MODEL, RESPONSES_PROBE_SCOPE, RESPONSES_PROBE_VERSION,
  type ResponsesProbeCase } from '../shared/responses-probe-plan';
import { validateProfileEligibility } from '../shared/survey-engine';
import { getPopulationModel } from '../server/population/service';

function unknownRaw(probe: ResponsesProbeCase) {
  const known = new Map(probe.knowledgeBoundary.knownAnswers.map(answer => [answer.questionId, answer.value]));
  return encodeAnswerContract(probe.profile.id, probe.task.questionnaire.questions.map(question => ({ questionId: question.id,
    value: known.has(question.id) ? known.get(question.id)! : !question.required ? null : question.type === 'multiple' ? ['unknown'] : 'unknown' })));
}

test('independent handwritten input-to-answer gold distinguishes a supplied definition from observed understanding and residence from mobility', () => {
  const [child, pet] = createResponsesProbeCases();
  const childInput = JSON.parse(child.user), petInput = JSON.parse(pet.user);
  // Do not construct this gold from knowledgeBoundary.knownAnswers or the compiler.
  assert.equal(childInput.availableInputs.childOriginalCollected, false);
  assert.equal(childInput.availableInputs.selectedRoleAttribute, 'childPurchaseRole');
  assert.equal(petInput.availableInputs.selectedRoleAttribute, 'petPurchaseRole');
  assert.equal(petInput.resident.attributes.find((a: { key: string }) => a.key === 'ownsDog').value, true);
  assert.equal(petInput.resident.attributes.find((a: { key: string }) => a.key === 'ownsCat').value, false);
  assert.equal(petInput.resident.attributes.find((a: { key: string }) => a.key === 'petPurchaseRole').value, 'purchaser');
  assert.equal(petInput.availableInputs.petSnackDefinitionProvided, true);
  assert.equal(petInput.availableInputs.petSnackUnderstandingObserved, false);
  for (const input of [childInput, petInput]) {
    assert.equal(input.availableInputs.mobilityObservationsProvided, false);
    assert.ok(input.availableInputs.unobservedQuestionIds.includes('reachable-streets'));
    assert.equal(Object.hasOwn(input.availableInputs, 'knownAnswers'), false);
    assert.equal(Object.hasOwn(input.availableInputs, 'expectedAnswers'), false);
  }
  assert.ok(petInput.availableInputs.unobservedQuestionIds.includes('snack-boundary'));
  const gold = JSON.stringify({ residentId: 'probe-pet-snacks-001', answers: {
    'pet-type': 'dog', 'purchase-role': ['purchaser'], 'snack-boundary': 'unknown',
    'past-frequency': 'unknown', 'past-snack-categories': ['unknown'], 'purchase-intent': 'unknown',
    'monthly-budget': null, 'package-size': 'unknown', 'price-per50g': 'unknown', 'planned-channels': ['unknown'],
    'online-handoff': 'unknown', 'travel-minutes': null, 'reachable-streets': ['unknown'], 'purchase-barriers': ['unknown'],
    'price10-intent': 'unknown', 'price20-intent': 'unknown', 'traceability-importance': null, 'needed-evidence': null,
  } });
  assert.equal(evaluateResponsesProbeAnswer(pet, gold).passed, true);
  for (const [questionId, value] of [['snack-boundary', 'understood'], ['reachable-streets', [petInput.resident.street]]] as const) {
    const invented = JSON.parse(gold); invented.answers[questionId] = value;
    const result = evaluateResponsesProbeAnswer(pet, JSON.stringify(invented));
    assert.equal(result.structure.status, 'checked');
    assert.equal(result.passed, false);
    assert.ok(result.knowledgeBoundary.issues.some(issue => issue.questionId === questionId && issue.code === 'unprovided-observation-filled'));
  }
});

test('pure probe cases deterministically freeze complete 17/18 questions, roles, unknown persona, keyed schema and whole-wire hashes', () => {
  const before = fingerprint(getBusinessDemos()), cases = createResponsesProbeCases(), withVerifiedFrame = createResponsesProbeCases(getPopulationModel());
  assert.deepEqual(cases, createResponsesProbeCases()); assert.deepEqual(cases, withVerifiedFrame);
  assert.deepEqual(cases.map(item => item.id), ['child-snacks', 'pet-snacks']); assert.equal(new Set(cases.map(item => item.requestId)).size, 2);
  assert.equal(RESPONSES_PROBE_SCOPE.budgetCny, 1); assert.equal(RESPONSES_PROBE_SCOPE.maxProviderRequests, 2);
  assert.equal(RESPONSES_PROBE_SCOPE.plannedResidents, 2); assert.equal(RESPONSES_PROBE_SCOPE.residentsPerScenario, 1);
  assert.equal(RESPONSES_PROBE_SCOPE.residentMaxOutputTokens, 3000); assert.equal(RESPONSES_PROBE_SCOPE.retries, 0);
  assert.equal(RESPONSES_PROBE_SCOPE.planningRequests, 0); assert.equal(RESPONSES_PROBE_SCOPE.corsRequests, 0);
  assert.equal(RESPONSES_PROBE_SCOPE.allowLedgerResume, false); assert.equal(RESPONSES_PROBE_SCOPE.allowModelFallback, false);
  cases.forEach((probe, index) => {
    const original = getBusinessDemos()[index];
    assert.equal(probe.version, RESPONSES_PROBE_VERSION); assert.equal(probe.task.questionnaire.questions.length, index === 0 ? 17 : 18);
    assert.deepEqual(probe.task.questionnaire, original.task.questionnaire); assert.deepEqual(probe.logicRules, original.logicRules);
    assert.equal(probe.sourceQuestionnaireHash, fingerprint(original.task.questionnaire)); assert.equal(probe.sourceRulesHash, fingerprint(original.logicRules));
    assert.equal(probe.promptHash, fingerprint({ system: probe.system, user: probe.user })); assert.equal(probe.profileHash, fingerprint(probe.profile));
    assert.equal(probe.knowledgeBoundaryHash, fingerprint(probe.knowledgeBoundary));
    assert.deepEqual(probe.contract, compileAnswerContract(probe.task, probe.profile.id, probe.logicRules));
    const wire = JSON.parse(probe.frozenRequest.body);
    assert.deepEqual(wire.text.format.schema, JSON.parse(JSON.stringify(probe.contract.schema)));
    assert.equal(wire.max_output_tokens, 3000); assert.equal(wire.model, RESPONSES_PROBE_MODEL.modelId);
    assert.equal(wire.input[0].content[0].text, probe.system); assert.equal(wire.input[1].content[0].text, probe.user);
    assert.equal(probe.frozenRequest.body.includes('synthetic-capability-preflight-not-a-provider-key'), false);
    assert.equal(Object.hasOwn(probe, 'apiKey'), false); assert.equal(Object.hasOwn(probe.preset, 'apiKey'), false);
    assert.equal(probe.profile.persona!.education.level, 'unknown'); assert.equal(probe.profile.persona!.work.income.lower, null);
    assert.ok(Object.values(probe.profile.persona!.personality).filter(value => !Array.isArray(value)).every(value => value === null));
    validateProfileEligibility(probe.task, probe.profile, getPopulationModel(), probe.preset);
    const attrs = new Map(probe.profile.attributes.map(attribute => [attribute.key, attribute]));
    for (const key of index === 0 ? ['caregiver', 'childSchoolStage', 'childPurchaseRole'] : ['petOwner', 'petPurchaseParticipant', 'ownsCat', 'ownsDog', 'petPurchaseRole']) {
      assert.equal(attrs.get(key)!.provenance, 'assumption'); assert.deepEqual(attrs.get(key)!.evidenceIds, []);
    }
  });
  assert.equal(fingerprint(getBusinessDemos()), before);
});

test('native object answers are independently audited with explicit array projection, preserving every null and no market claim', () => {
  for (const probe of createResponsesProbeCases()) {
    const nativeRaw = unknownRaw(probe), before = fingerprint(probe), result = evaluateResponsesProbeAnswer(probe, nativeRaw);
    assert.equal(result.nativeRaw, nativeRaw); assert.equal(result.structure.status, 'checked'); assert.equal(result.structure.decoderAccepted, true);
    assert.equal(result.structure.independentSchemaOracleAccepted, true); assert.equal(result.passed, true);
    assert.equal(result.logic!.status, 'checked'); assert.equal(result.qualification!.status, 'checked'); assert.equal(result.knowledgeBoundary.status, 'checked');
    assert.equal(result.content!.status, 'information-insufficient'); assert.equal(result.content!.knownBusinessQuestions, 0);
    assert.equal(result.requestAcceptance, 'requires-transport-evidence'); assert.equal(result.keywordExecution, 'unknown');
    assert.equal(result.marketResearchValidated, false); assert.equal(result.personaContributionValidated, false);
    assert.ok(result.arrayProjection); assert.equal(result.arrayProjection.version, 'explicit-native-object-to-array-projection-1.0');
    assert.ok(Array.isArray(JSON.parse(result.arrayProjection.record.raw).answers)); assert.equal(Array.isArray(JSON.parse(result.nativeRaw).answers), false);
    assert.equal(result.arrayProjection.record.inputTokens, null); assert.equal(result.arrayProjection.record.outputTokens, null);
    assert.ok(result.answers!.some(answer => answer.value === null)); assert.equal(fingerprint(probe), before);
  }
});

test('strict decoder and separate schema oracle reject structural output mutations without repair or secret parser errors', () => {
  const probe = createResponsesProbeCases()[0], original = JSON.parse(unknownRaw(probe));
  const mutations = [(v: any) => { delete v.answers['child-own-taste']; }, (v: any) => { v.answers.extra = null; },
    (v: any) => { v.residentId = 'wrong'; }, (v: any) => { v.answers.eligibility = ['eligible']; },
    (v: any) => { v.answers['planned-channels'] = 'unknown'; }, (v: any) => { v.answers['planned-channels'] = ['online', 'unknown']; },
    (v: any) => { v.answers['planned-channels'] = ['online', 'online']; }, (v: any) => { v.answers['monthly-budget'] = -1; },
    (v: any) => { v.answers['traceability-importance'] = 1.5; }, (v: any) => { v.answers['needed-evidence'] = '  '; }];
  for (const mutate of mutations) {
    const value = structuredClone(original); mutate(value); const nativeRaw = JSON.stringify(value), result = evaluateResponsesProbeAnswer(probe, nativeRaw);
    assert.equal(result.nativeRaw, nativeRaw); assert.equal(result.passed, false); assert.equal(result.structure.decoderAccepted, false);
    assert.equal(result.structure.independentSchemaOracleAccepted, false); assert.equal(result.arrayProjection, null);
    assert.equal(result.knowledgeBoundary.status, 'not-evaluated');
  }
  for (const raw of ['```json\n' + JSON.stringify(original) + '\n```', JSON.stringify(original).replace('"residentId":', '"residentId":"synthetic-private-key","residentId":')]) {
    const result = evaluateResponsesProbeAnswer(probe, raw); assert.equal(result.passed, false); assert.equal(result.arrayProjection, null);
    const { nativeRaw: _native, ...audit } = result; assert.equal(JSON.stringify(audit).includes('synthetic-private-key'), false);
  }
});

test('legally typed hallucinated intent, budget zero, history, location and open text fail the preregistered knowledge boundary', () => {
  for (const probe of createResponsesProbeCases()) {
    const original = JSON.parse(unknownRaw(probe));
    for (const [id, value] of [['purchase-intent', 'maybe'], ['monthly-budget', 0], ['past-frequency', probe.id === 'child-snacks' ? 'one-three' : 'one-two'],
      ['reachable-streets', [probe.profile.street]], ['needed-evidence', '我偏好高端品牌']] as const) {
      const changed = structuredClone(original); changed.answers[id] = value;
      const result = evaluateResponsesProbeAnswer(probe, JSON.stringify(changed));
      assert.equal(result.structure.status, 'checked'); assert.equal(result.passed, false); assert.equal(result.knowledgeBoundary.status, 'conflict');
      assert.ok(result.knowledgeBoundary.issues.some(issue => issue.questionId === id && issue.code === 'unprovided-observation-filled'));
    }
  }
});

test('child original and explicit synthetic participation/species mismatches never pass qualification or known-input audit', () => {
  for (const probe of createResponsesProbeCases()) {
    const original = JSON.parse(unknownRaw(probe));
    const mutations = probe.id === 'child-snacks' ? [(v: any) => { v.answers.eligibility = 'ineligible'; },
      (v: any) => { v.answers['child-own-taste'] = '孩子喜欢甜口'; }, (v: any) => { v.answers['purchase-role'] = ['unknown']; }]
      : [(v: any) => { v.answers['pet-type'] = 'cat'; }, (v: any) => { v.answers['purchase-role'] = ['unknown']; },
        (v: any) => { v.answers['purchase-role'] = ['decision']; }];
    for (const mutate of mutations) {
      const changed = structuredClone(original); mutate(changed); const result = evaluateResponsesProbeAnswer(probe, JSON.stringify(changed));
      assert.equal(result.structure.status, 'checked'); assert.equal(result.passed, false);
      assert.ok(result.qualification!.status === 'conflict' || result.knowledgeBoundary.status === 'conflict');
    }
  }
});

test('case, profile, prompt, rules, schema or population tampering is rejected before evaluation', () => {
  const probe = createResponsesProbeCases()[0];
  for (const mutate of [(v: any) => { v.profile.age = 10; }, (v: any) => { v.user += 'drift'; },
    (v: any) => { v.logicRules = []; }, (v: any) => { v.contract.schema = {}; }, (v: any) => { v.knowledgeBoundary.unknownQuestionIds = []; },
    (v: any) => { v.frozenRequest.body += ' '; }]) {
    const changed = structuredClone(probe); mutate(changed); assert.throws(() => evaluateResponsesProbeAnswer(changed, unknownRaw(probe)), /drifted/);
  }
  const population = getPopulationModel(); population.cells[0].population += 1;
  assert.throws(() => createResponsesProbeCases(population), /exact registered/);
});
