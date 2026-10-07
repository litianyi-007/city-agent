import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import test from 'node:test';
import { HARNESS_NAME, runRole, type RoleModelConfig } from '../server/harness.ts';
import { getPopulationModel, getPopulationPack } from '../server/population/service.ts';
import { planResearch, ResearchPlanningError, RESEARCH_PLANNER_VERSION, RESEARCH_PLANNING_FORMAT_EXAMPLE_JSON, RESEARCH_PLANNING_SYSTEM_PROMPT } from '../server/research/planning.ts';
import { fingerprint } from '../shared/evidence.ts';
import { createLiveBusinessProtocol, liveResponseStop } from '../shared/live-business-protocol.ts';
import { researchPlanningModelOutputSchema } from '../shared/research-planning.ts';
import { buildProfiles, RESIDENT_SYSTEM_PROMPT, SURVEY_VERSION, validateAnswers, type Answer, type Profile, type SurveyRun } from '../shared/survey-engine.ts';
import { executeSurvey } from '../shared/survey-runner.ts';
import { parseSurveyEvidence } from '../src/run-history.ts';

/**
 * LOCAL PROTOCOL TEST ONLY: these canned SSE replies are not real model answers,
 * quality evidence, population observations or another paid experiment. The
 * unmodified DeepSeek Harness SDK does contact a provider, but only this test's
 * ephemeral 127.0.0.1 server, with a synthetic key. There is no injected planner
 * runner, private credential store, genuine supplier, retry or public export.
 */
const LOCAL_KEY = 'local-protocol-only-synthetic-key';
const MODEL_ID = 'local-canned-sse-not-a-real-model';
const LOCAL_EXPERIMENT = { id: 'local-protocol-not-model-quality', arm: 'canned-sse' };
const population = getPopulationModel();
const pack = getPopulationPack();
const planningInput = {
  request: '仅本机协议测试：生成可编辑的平铺问卷格式，不执行居民或发布结果。',
  population: { regionCode: 'binjiang', period: '2020-11-01', unit: 'person' as const },
  maxQuestions: 5,
};

interface ProviderRequest {
  path: string | undefined;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

async function withLocalSse(
  reply: (body: Record<string, unknown>, requestIndex: number) => string,
  check: (config: RoleModelConfig, requests: ProviderRequest[]) => Promise<void>,
) {
  const requests: ProviderRequest[] = [];
  let handlerFailure: unknown;
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    try {
      let raw = '';
      for await (const chunk of request) raw += chunk;
      const body = JSON.parse(raw || '{}') as Record<string, unknown>;
      requests.push({ path: request.url, authorization: request.headers.authorization, body });
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, `Bearer ${LOCAL_KEY}`);
      assert.equal(body.model, MODEL_ID);
      assert.equal(body.tools, undefined);
      assert.equal(body.stream, true);
      const text = reply(body, requests.length);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const event of [
        { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
        { choices: [{ delta: { content: text }, index: 0, finish_reason: null }] },
        { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 } },
      ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch (error) {
      handlerFailure = error;
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Local protocol server rejected request' } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}/v1`;
  assert.equal(new URL(baseUrl).hostname, '127.0.0.1');
  try {
    await check({ provider: 'openai-compatible', baseUrl, modelId: MODEL_ID, apiKey: LOCAL_KEY }, requests);
    if (handlerFailure) throw handlerFailure;
  } catch (error) { throw handlerFailure ?? error; }
  finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function messages(body: Record<string, unknown>): { role: string; content: string }[] {
  const result = body.messages as { role: string; content: string }[];
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(item => item.role), ['system', 'user']);
  return result;
}

/** An explicit, hand-authored unknown scenario; never represents model quality. */
function localChildEnvelope(profile: Profile) {
  const values: Record<string, Answer['value']> = {
    eligibility: 'eligible', 'purchase-role': ['purchaser'],
    'child-evidence': 'not-collected', 'child-own-taste': null,
    'past-frequency': 'unknown', 'past-categories': ['unknown'],
    'permission-factors': ['unknown'], 'purchase-intent': 'unknown',
    'monthly-budget': null, 'package-size': 'unknown',
    'planned-channels': ['unknown'], 'reachable-streets': ['unknown'],
    'travel-minutes': null, 'traceability-importance': null,
    'price-per20g': 'unknown', 'purchase-barriers': ['unknown'], 'needed-evidence': null,
  };
  return { residentId: profile.id, answers: Object.entries(values).map(([questionId, value]) => ({ questionId, value })) };
}

function surveyContext(config: RoleModelConfig, count: number, allPresets = false) {
  const protocol = createLiveBusinessProtocol('child-snacks', { provider: 'openai-compatible', baseUrl: config.baseUrl, modelId: config.modelId });
  const presets = allPresets ? protocol.presets : [protocol.presets[0]];
  const profiles = buildProfiles(protocol.task, population, presets, count, 20261007);
  return { protocol, presets, profiles };
}

function assertResidentWire(run: SurveyRun, request: ProviderRequest, profile: Profile) {
  const wire = messages(request.body);
  const recorded = run.prompt.users.find(item => item.residentId === profile.id)!;
  assert.equal(request.body.max_tokens, 3000);
  assert.equal(wire[0].content, RESIDENT_SYSTEM_PROMPT);
  assert.equal(wire[0].content, run.prompt.system);
  assert.equal(fingerprint(wire[0].content), run.prompt.systemHash);
  assert.equal(wire[1].content, recorded.text);
  assert.equal(fingerprint(wire[1].content), recorded.hash);
  assert.equal(JSON.parse(wire[1].content).resident.id, profile.id);
  assert.ok(wire[0].content.includes('["unknown"]'), 'actual SDK system message must teach a multiple-choice unknown array');
  assert.ok(wire[0].content.includes('null'), 'actual SDK system message must teach optional unknown null');
  assert.equal(run.version, SURVEY_VERSION);
  assert.equal(run.parameters?.retries, 0);
  assert.equal(run.parameters?.fixturePolicyId, undefined);
  assert.equal(run.marketResearchValidated, false);
  assert.deepEqual(run.experiment, LOCAL_EXPERIMENT);
}

test('LOCAL ONLY: real Harness transport sends flat planner contract, preserves its prompt hash and returns an unapplied candidate with one request', { timeout: 45_000 }, async () => {
  const raw = RESEARCH_PLANNING_FORMAT_EXAMPLE_JSON;
  await withLocalSse(() => raw, async (config, requests) => {
    // Default runner is the real SDK; there is deliberately no injected runner.
    const result = await planResearch(planningInput, config, new AbortController().signal);
    assert.equal(requests.length, 1);
    assert.equal(result.evidence.execution, 'harness');
    assert.equal(result.evidence.harness, HARNESS_NAME);
    assert.equal(result.evidence.plannerVersion, RESEARCH_PLANNER_VERSION);
    assert.equal(result.evidence.modelCalls, 1);
    assert.equal(result.evidence.rawResponse, raw);
    assert.equal(result.evidence.responseHash, fingerprint(raw));
    assert.equal(result.evidence.usageStatus, 'reported');
    assert.equal(result.evidence.inputTokens, 13);
    assert.equal(result.evidence.outputTokens, 7);
    assert.equal(result.evidence.cost, null);
    assert.equal(result.status, 'candidate');
    assert.equal(result.candidate, true);
    assert.equal(result.semanticValidation, 'not-performed');
    assert.equal(result.marketResearchValidated, false);
    assert.equal(result.residentCalls, 0);
    assert.equal(result.task.questionnaire.questions.length, 5);
    researchPlanningModelOutputSchema.parse(JSON.parse(raw));
    const wire = messages(requests[0].body);
    assert.equal(requests[0].body.max_tokens, 6000);
    assert.equal(wire[0].content, RESEARCH_PLANNING_SYSTEM_PROMPT);
    assert.equal(wire[0].content, result.evidence.systemPrompt);
    assert.ok(wire[0].content.includes('<format-example-json>'));
    assert.ok(wire[0].content.includes(RESEARCH_PLANNING_FORMAT_EXAMPLE_JSON));
    assert.ok(wire[0].content.includes('平铺 JSON'));
    assert.equal(wire[1].content, result.evidence.userPrompt);
    assert.equal(JSON.parse(wire[1].content).plannerVersion, RESEARCH_PLANNER_VERSION);
    assert.equal(result.evidence.promptHash, fingerprint({ system: wire[0].content, user: wire[1].content }));
    assert.ok(result.limitations.some(item => item.includes('没有保存草稿或调用居民')));
    // A candidate response did not apply itself or trigger any follow-up request.
    assert.equal(requests.length, 1);
  });
});

test('LOCAL ONLY: real Harness planner rejects nested question wrappers without repair or retry and retains exact original evidence', { timeout: 45_000 }, async () => {
  const nested = JSON.parse(RESEARCH_PLANNING_FORMAT_EXAMPLE_JSON);
  const question = nested.task.questionnaire.questions[0];
  question.single = { options: question.options };
  delete question.options;
  const raw = JSON.stringify(nested);
  await withLocalSse(() => raw, async (config, requests) => {
    await assert.rejects(planResearch(planningInput, config, new AbortController().signal), (error: unknown) => {
      assert.ok(error instanceof ResearchPlanningError);
      assert.equal(error.evidence.execution, 'harness');
      assert.equal(error.evidence.state, 'failed');
      assert.equal(error.evidence.modelCalls, 1);
      assert.equal(error.evidence.rawResponse, raw);
      assert.equal(error.evidence.responseHash, fingerprint(raw));
      assert.equal(JSON.parse(error.evidence.rawResponse).task.questionnaire.questions[0].options, undefined);
      assert.deepEqual(JSON.parse(error.evidence.rawResponse).task.questionnaire.questions[0].single.options, question.single.options);
      assert.equal(error.evidence.inputTokens, 13);
      assert.equal(error.evidence.outputTokens, 7);
      assert.equal(requests.length, 1);
      const wire = messages(requests[0].body);
      assert.equal(wire[0].content, RESEARCH_PLANNING_SYSTEM_PROMPT);
      assert.equal(error.evidence.promptHash, fingerprint({ system: wire[0].content, user: wire[1].content }));
      return true;
    });
    assert.equal(requests.length, 1);
  });
});

test('LOCAL ONLY: real Harness resident transport sends recorded new contract, accepts unknown arrays and explicit optional null, with one request', { timeout: 45_000 }, async () => {
  let raw = '';
  await withLocalSse(body => {
    const profile = JSON.parse(messages(body)[1].content).resident as Profile;
    raw = JSON.stringify(localChildEnvelope(profile));
    return raw;
  }, async (config, requests) => {
    const { protocol, presets, profiles } = surveyContext(config, 1);
    const checkpoints: SurveyRun[] = [];
    const run = await executeSurvey({
      task: protocol.task, population, pack, presets, count: 1, seed: 20261007, mode: 'live', frozenProfiles: profiles,
      signal: new AbortController().signal,
      experiment: LOCAL_EXPERIMENT,
      pricing: { currency: 'CNY', inputPerMillion: null, outputPerMillion: null, suppliedAt: '2026-10-07T00:00:00.000Z', source: 'local protocol server only; not a paid provider or quality experiment' },
      call: (_profile, system, user, signal) => runRole(config, system, user, signal, undefined, { maxOutputTokens: 3000, timeoutMs: 90000, reportUsage: true }),
      checkpoint: async current => { checkpoints.push(structuredClone(current)); },
      stopAfterResponse: (response, profile) => liveResponseStop(protocol, response, profile),
    });
    assert.equal(requests.length, 1);
    assert.equal(run.state, 'completed');
    assert.equal(run.metrics.modelCalls, 1);
    assert.equal(run.metrics.valid, 1);
    assert.equal(run.metrics.notStarted, 0);
    assert.equal(run.metrics.apiCostCny, null);
    assert.equal(run.responses[0].raw, raw);
    assert.equal(run.responses[0].status, 'valid');
    assert.deepEqual(run.responses[0].answers.find(answer => answer.questionId === 'past-categories')?.value, ['unknown']);
    assert.equal(run.responses[0].answers.find(answer => answer.questionId === 'child-own-taste')?.value, null);
    assert.equal(run.responses[0].answers.find(answer => answer.questionId === 'monthly-budget')?.value, null);
    assert.deepEqual(validateAnswers(protocol.task, profiles[0].id, raw), run.responses[0].answers);
    assertResidentWire(run, requests[0], profiles[0]);
    for (const checkpoint of checkpoints) {
      assert.equal(checkpoint.prompt.system, RESIDENT_SYSTEM_PROMPT);
      if (checkpoint.responses.length) assert.equal(checkpoint.responses[0].raw, raw);
    }
    assert.equal(parseSurveyEvidence(run).metrics.valid, 1);
    assert.equal(requests.length, 1);
  });
});

test('LOCAL ONLY: real Harness scalar unknown remains rejected and raw checkpoint stays scalar; quality stop freezes nine residents without repair or retry', { timeout: 45_000 }, async () => {
  let raw = '';
  await withLocalSse(body => {
    const profile = JSON.parse(messages(body)[1].content).resident as Profile;
    const envelope = localChildEnvelope(profile);
    envelope.answers.find(answer => answer.questionId === 'past-categories')!.value = 'unknown';
    raw = JSON.stringify(envelope);
    return raw;
  }, async (config, requests) => {
    const { protocol, presets, profiles } = surveyContext(config, 10, true);
    const checkpoints: SurveyRun[] = [];
    let stopChecks = 0;
    const run = await executeSurvey({
      task: protocol.task, population, pack, presets, count: 10, seed: 20261007, mode: 'live', frozenProfiles: profiles,
      signal: new AbortController().signal,
      experiment: LOCAL_EXPERIMENT,
      pricing: { currency: 'CNY', inputPerMillion: null, outputPerMillion: null, suppliedAt: '2026-10-07T00:00:00.000Z', source: 'local protocol server only; not a paid provider or quality experiment' },
      call: (_profile, system, user, signal) => runRole(config, system, user, signal, undefined, { maxOutputTokens: 3000, timeoutMs: 90000, reportUsage: true }),
      checkpoint: async current => { checkpoints.push(structuredClone(current)); },
      stopAfterResponse: (response, profile) => { stopChecks++; return liveResponseStop(protocol, response, profile); },
    });
    assert.equal(requests.length, 1);
    assert.equal(stopChecks, 1);
    assert.equal(run.state, 'stopped');
    assert.equal(run.metrics.planned, 10);
    assert.equal(run.metrics.modelCalls, 1);
    assert.equal(run.metrics.valid, 0);
    assert.equal(run.metrics.failed, 1);
    assert.equal(run.metrics.notStarted, 9);
    assert.equal(run.responses[0].status, 'invalid');
    assert.equal(run.responses[0].structureValid, false);
    assert.deepEqual(run.responses[0].answers, []);
    assert.equal(run.responses[0].raw, raw);
    assert.match(run.responses[0].error!, /past-categories/);
    assert.equal(JSON.parse(run.responses[0].raw).answers.find((answer: Answer) => answer.questionId === 'past-categories').value, 'unknown');
    assert.throws(() => validateAnswers(protocol.task, profiles[0].id, raw), /past-categories/);
    assert.ok(run.responses.slice(1).every(response => response.status === 'not-started' && response.raw === '' && response.answers.length === 0 && response.inputTokens === 0 && response.outputTokens === 0));
    assert.ok(run.responses.slice(1).every(response => response.error?.includes('不重试')));
    assertResidentWire(run, requests[0], profiles[0]);
    assert.deepEqual(run.profiles, profiles);
    for (const checkpoint of checkpoints) {
      assert.ok(checkpoint.metrics.modelCalls <= 1);
      if (checkpoint.responses.length) {
        assert.equal(checkpoint.responses[0].raw, raw);
        assert.equal(JSON.parse(checkpoint.responses[0].raw).answers.find((answer: Answer) => answer.questionId === 'past-categories').value, 'unknown');
        assert.deepEqual(checkpoint.responses[0].answers, []);
      }
    }
    assert.equal(parseSurveyEvidence(run).state, 'stopped');
    assert.equal(requests.length, 1);
  });
});
