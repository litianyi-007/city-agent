import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { fingerprint } from '../shared/evidence.ts';
import { researchPlanningInputSchema, researchPlanningModelOutputSchema } from '../shared/research-planning.ts';
import { getResearchTemplates } from '../server/research/templates.ts';
import { planResearch, ResearchPlanningError, RESEARCH_PLANNING_SYSTEM_PROMPT } from '../server/research/planning.ts';
import { HarnessCallError, type RoleModelConfig, type RoleResult, type runRole } from '../server/harness.ts';

const input = { request: '希望了解儿童照护者对零食的顾虑，不能当儿童本人调查。', population: { regionCode: 'binjiang', period: '2020-11-01', unit: 'person' as const }, maxQuestions: 12 };
const agent: RoleModelConfig = { provider: 'openai-compatible', baseUrl: 'https://example.invalid/v1', modelId: 'fixture-model', apiKey: 'private-planner-fixture-key' };
const output = () => ({ task: getResearchTemplates()[0], assumptions: ['照护者身份是假设'], clarifications: ['规格和价格待确认'], dataGaps: ['照护资格分母缺失'] });
const result = (text: string, usageReported?: boolean): RoleResult => ({ text, inputTokens: 0, outputTokens: 0, harness: 'fixture only', ...(usageReported !== undefined ? { usageReported } : {}) });
const fixture = (value = output()): typeof runRole => async () => result(JSON.stringify(value));

test('planning inputs and outputs are strict and bounded with the shared ResearchTask contract', () => {
  assert.equal(researchPlanningInputSchema.parse({ ...input, maxQuestions: undefined }).maxQuestions, 12);
  for (const candidate of [{ ...input, request: '' }, { ...input, request: 'x'.repeat(8001) }, { ...input, maxQuestions: 21 }, { ...input, population: { ...input.population, hidden: true } }, { ...input, apiKey: 'forbidden' }]) assert.equal(researchPlanningInputSchema.safeParse(candidate).success, false);
  const candidate = output();
  assert.equal(researchPlanningModelOutputSchema.safeParse(candidate).success, true);
  assert.equal(researchPlanningModelOutputSchema.safeParse({ ...candidate, validated: true }).success, false);
  const malformed = structuredClone(candidate);
  malformed.task.questionnaire.questions[0].id = malformed.task.questionnaire.questions[1].id;
  assert.equal(researchPlanningModelOutputSchema.safeParse(malformed).success, false);
});

test('one explicit call yields only an editable unverified candidate with unknown usage and cost', async () => {
  let calls = 0;
  const runner: typeof runRole = async (_agent, system, user, signal, _event, limits) => {
    calls++;
    assert.equal(system, RESEARCH_PLANNING_SYSTEM_PROMPT);
    assert.equal(JSON.parse(user).request, input.request);
    assert.equal(signal.aborted, false);
    assert.deepEqual(limits, { timeoutMs: 90_000, maxOutputTokens: 6000, reportUsage: true });
    return result(JSON.stringify(output()));
  };
  const before = structuredClone(input);
  const planned = await planResearch(input, agent, new AbortController().signal, runner);
  assert.equal(calls, 1);
  assert.deepEqual(input, before);
  assert.equal(planned.status, 'candidate');
  assert.equal(planned.marketResearchValidated, false);
  assert.equal(planned.semanticValidation, 'not-performed');
  assert.equal(planned.residentCalls, 0);
  assert.match(planned.dataGaps.join('\n'), /分母/);
  assert.match(planned.limitations.join('\n'), /未验证候选/);
  assert.equal(planned.evidence.execution, 'injected-runner');
  assert.equal(planned.evidence.modelCalls, 1);
  assert.equal(planned.evidence.inputTokens, null);
  assert.equal(planned.evidence.outputTokens, null);
  assert.equal(planned.evidence.usageStatus, 'unknown');
  assert.equal(planned.evidence.cost, null);
  assert.equal(planned.evidence.responseHash, fingerprint(planned.evidence.rawResponse));
  assert.equal(planned.evidence.promptHash, fingerprint({ system: planned.evidence.systemPrompt, user: planned.evidence.userPrompt }));
  assert.ok(planned.evidence.durationMs >= 0);
});

test('facts, inferred qualifications, invented references and unsupported promises are rejected, not downgraded silently', async () => {
  const candidates = [output(), output(), output(), output(), output(), output()];
  candidates[0].task.declarations[0].provenance = 'fact';
  candidates[1].task.declarations[0].provenance = 'infer';
  candidates[2].task.declarations[0].sourceIds = ['invented'];
  candidates[3].task.declarations[0].observationIds = ['invented-observation'];
  candidates[4].task.requestedOutputs = ['site-recommendation'];
  candidates[5].task.declarations = [];
  for (const candidate of candidates) {
    await assert.rejects(planResearch(input, agent, new AbortController().signal, fixture(candidate)), (error: unknown) => {
      assert.ok(error instanceof ResearchPlanningError);
      assert.equal(error.evidence.state, 'failed');
      assert.equal(error.evidence.modelCalls, 1);
      assert.equal(error.evidence.rawResponse, JSON.stringify(candidate));
      return true;
    });
  }
});

test('region, period, unit, question count, malformed and markdown outputs cannot bypass validation', async () => {
  for (const population of [{ regionCode: 'other' }, { period: '2026' }, { unit: 'household' as const }]) {
    const candidate = output(); Object.assign(candidate.task.population, population);
    await assert.rejects(planResearch(input, agent, new AbortController().signal, fixture(candidate)), /冻结人口/);
  }
  await assert.rejects(planResearch({ ...input, maxQuestions: 2 }, agent, new AbortController().signal, fixture()), /问题数/);
  for (const raw of ['{"task":', '```json\n' + JSON.stringify(output()) + '\n```', JSON.stringify({ ...output(), secret: 'extra' })]) {
    await assert.rejects(planResearch(input, agent, new AbortController().signal, async () => result(raw)), ResearchPlanningError);
  }
});

test('credentials are redacted before a request and in successful task, evidence and failed partial output', async () => {
  const candidate = output();
  candidate.task.title = `候选 ${agent.apiKey}`;
  candidate.clarifications = ['Bearer another-secret-value', 'sk-abcdefghijklmnopqrstuv'];
  const planned = await planResearch({ ...input, request: `${input.request} ${agent.apiKey}`, context: `Key=${agent.apiKey}` }, agent, new AbortController().signal, async (_agent, _system, user) => {
    assert.equal(user.includes(agent.apiKey), false);
    return result(JSON.stringify(candidate), true);
  });
  assert.equal(JSON.stringify(planned).includes(agent.apiKey), false);
  assert.equal(JSON.stringify(planned).includes('another-secret-value'), false);
  assert.equal(JSON.stringify(planned).includes('sk-abcdefghijklmnopqrstuv'), false);
  assert.equal(planned.evidence.usageStatus, 'reported');
  assert.equal(planned.evidence.inputTokens, 0);
  await assert.rejects(planResearch(input, agent, new AbortController().signal, async () => {
    throw new HarnessCallError(`truncated ${agent.apiKey}`, { text: `partial ${agent.apiKey}`, inputTokens: 11, outputTokens: 6000 });
  }), (error: unknown) => {
    assert.ok(error instanceof ResearchPlanningError);
    assert.equal(JSON.stringify(error.evidence).includes(agent.apiKey), false);
    assert.equal(error.evidence.inputTokens, 11);
    assert.equal(error.evidence.outputTokens, 6000);
    assert.equal(error.evidence.usageStatus, 'reported');
    assert.match(error.evidence.rawResponse, /partial \[REDACTED\]/);
    return true;
  });
});

test('invalid usage stays unknown, and oversized output remains a failed bounded artifact', async () => {
  const planned = await planResearch(input, agent, new AbortController().signal, async () => ({ ...result(JSON.stringify(output()), true), inputTokens: -1, outputTokens: Number.NaN }));
  assert.equal(planned.evidence.inputTokens, null); assert.equal(planned.evidence.outputTokens, null);
  assert.equal(planned.evidence.usageStatus, 'unknown');
  await assert.rejects(planResearch(input, agent, new AbortController().signal, async () => result('x'.repeat(512_001))), (error: unknown) => {
    assert.ok(error instanceof ResearchPlanningError);
    assert.ok(error.evidence.rawResponse.length < 130_000);
    assert.match(error.evidence.rawResponse, /TRUNCATED/);
    return true;
  });
});

test('escaped credentials cannot survive JSON decoding and invalid model routes never call a runner', async () => {
  const quotedAgent = { ...agent, apiKey: 'private-"quoted-key' };
  const candidate = output(); candidate.task.title = quotedAgent.apiKey;
  const planned = await planResearch(input, quotedAgent, new AbortController().signal, async () => result(JSON.stringify(candidate)));
  assert.equal(JSON.stringify(planned).includes(JSON.stringify(quotedAgent.apiKey).slice(1, -1)), false);
  const encoded = JSON.stringify(output()).replace('儿童照护者零食概念研究', [...agent.apiKey].map(char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''));
  const unicode = await planResearch(input, agent, new AbortController().signal, async () => result(encoded));
  assert.equal(unicode.task.title, '[REDACTED]');
  assert.equal(unicode.evidence.rawResponse.includes('\\u0070'), false);
  let calls = 0;
  for (const invalid of [{ provider: 'unknown' }, { baseUrl: 'https://user:secret@example.com' }, { baseUrl: 'https://example.com?key=secret' }, { apiKey: '' }, { temperature: 0.5 }]) {
    await assert.rejects(planResearch(input, { ...agent, ...invalid }, new AbortController().signal, async () => { calls++; return result(''); }));
  }
  assert.equal(calls, 0);
});

test('pre-cancel makes zero calls, in-flight cancel reaches runner, and timeout never retries', async () => {
  let calls = 0;
  const pre = new AbortController(); pre.abort();
  await assert.rejects(planResearch(input, agent, pre.signal, async () => { calls++; return result(''); }), (error: unknown) => {
    assert.ok(error instanceof ResearchPlanningError);
    assert.equal(error.evidence.state, 'cancelled'); assert.equal(error.evidence.modelCalls, 0);
    return true;
  });
  assert.equal(calls, 0);
  const cancel = new AbortController();
  let reachedAbort = false;
  await assert.rejects(planResearch(input, agent, cancel.signal, async (_agent, _system, _user, signal) => {
    calls++;
    return await new Promise<RoleResult>((_resolve, reject) => {
      signal.addEventListener('abort', () => { reachedAbort = true; reject(new DOMException('stopped', 'AbortError')); }, { once: true });
      cancel.abort();
    });
  }), (error: unknown) => {
    assert.ok(error instanceof ResearchPlanningError);
    assert.equal(error.evidence.state, 'cancelled');
    return true;
  });
  assert.equal(reachedAbort, true);
  let timeoutAbort = false;
  await assert.rejects(planResearch(input, agent, new AbortController().signal, async (_agent, _system, _user, signal) => {
    calls++;
    return await new Promise<RoleResult>((_resolve, reject) => signal.addEventListener('abort', () => { timeoutAbort = true; reject(new DOMException('stopped', 'AbortError')); }, { once: true }));
  }, { timeoutMs: 1000 }), (error: unknown) => {
    assert.ok(error instanceof ResearchPlanningError);
    assert.equal(error.evidence.state, 'timed-out');
    assert.equal(error.evidence.modelCalls, 1);
    return true;
  });
  assert.equal(timeoutAbort, true); assert.equal(calls, 2);
});

test('real Harness transport against local HTTP fixture is engineering verification, not real model quality', { timeout: 45_000 }, async () => {
  let requests = 0; let providerFailure: unknown;
  const server = createServer(async (request, response) => {
    try {
      requests++;
      assert.equal(request.url, '/v1/chat/completions');
      assert.equal(request.headers.authorization, `Bearer ${agent.apiKey}`);
      let body = ''; for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      assert.equal(parsed.model, agent.modelId);
      assert.equal(parsed.max_tokens, 6000);
      assert.equal(parsed.tools, undefined);
      assert.equal(parsed.messages[0].content, RESEARCH_PLANNING_SYSTEM_PROMPT);
      assert.equal(JSON.parse(parsed.messages[1].content).request, input.request);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { role: 'assistant', content: JSON.stringify(output()) }, index: 0, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 22, completion_tokens: 33, total_tokens: 55 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch (error) { providerFailure = error; response.writeHead(500); response.end('fixture failed'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    const planned = await planResearch(input, { ...agent, baseUrl: `http://127.0.0.1:${address.port}/v1` }, new AbortController().signal);
    if (providerFailure) throw providerFailure;
    assert.equal(planned.evidence.execution, 'harness');
    assert.equal(planned.evidence.inputTokens, 22); assert.equal(planned.evidence.outputTokens, 33);
    assert.equal(planned.marketResearchValidated, false);
    assert.equal(requests, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('cancelling a real Harness planning transport waits for adapter cleanup', { timeout: 45_000 }, async () => {
  const controller = new AbortController();
  let closed = false;
  let connected!: () => void;
  let disconnected!: () => void;
  const connection = new Promise<void>(resolve => { connected = resolve; });
  const disconnection = new Promise<void>(resolve => { disconnected = resolve; });
  const server = createServer((_request, response) => {
    response.on('close', () => { closed = true; disconnected(); });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': waiting\n\n');
    connected();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const inFlight = planResearch(input, { ...agent, baseUrl: `http://127.0.0.1:${address.port}/v1` }, controller.signal);
    const failure = assert.rejects(inFlight, (error: unknown) => {
      assert.ok(error instanceof ResearchPlanningError);
      assert.equal(error.evidence.state, 'cancelled');
      assert.equal(error.evidence.usageStatus, 'unknown');
      return true;
    });
    await connection; controller.abort(); await failure;
    await Promise.race([disconnection, new Promise<never>((_resolve, reject) => { closeTimer = setTimeout(() => reject(new Error('local fixture connection remained open')), 3000); })]);
    assert.equal(closed, true);
  } finally {
    if (closeTimer) clearTimeout(closeTimer);
    controller.abort(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
