import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import { getCityProfile } from '../server/city.js';
import type { ExecutionEvidence } from '../server/execution-evidence.js';
import type { AcceptanceCheck } from '../server/gate.js';
import { createRunner } from '../server/orchestrator.js';
import { CityStore } from '../server/store.js';
import type { Role, Run, RunInput } from '../server/types.js';

interface Manifest {
  status: string;
  realL5Evidence: boolean;
  modelCalls: number;
  repairCount: number;
  acceptanceHash: string | null;
  artifactHashes: Record<string, string>;
  generatedBy: string;
  executionEvidence: ExecutionEvidence;
  marketResearchValidated: boolean;
}
interface ProviderBody { model: string; messages: Array<{ role: string; content: string }>; tools?: unknown }

function fixture(t: TestContext) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-runner-test-'));
  const store = new CityStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const input = (mode: 'demo' | 'live'): RunInput => ({ task: '建立商品调研页面，说明模拟限制，修改价格后更新模拟意愿。', mode,
    agentIds: store.getAgents().map(agent => agent.id), product: 'AI 生活服务会员', price: 29, sampleSize: 60, seed: 17 });
  const read = <T = Manifest>(runId: string, name: string): T => JSON.parse(readFileSync(path.join(store.runDir(runId), name), 'utf8')) as T;
  return { store, input, read };
}

async function withProvider(
  handler: (request: IncomingMessage, response: ServerResponse, body: ProviderBody) => void,
  check: (baseUrl: string) => Promise<void>,
) {
  const handlerErrors: unknown[] = [];
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      handler(request, response, JSON.parse(body || '{}') as ProviderBody);
    } catch (error) {
      handlerErrors.push(error);
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Local test provider assertion failed' } }));
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    await check(`http://127.0.0.1:${address.port}/v1`);
    assert.deepEqual(handlerErrors, []);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

function complete(response: ServerResponse, value: unknown) {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  for (const event of [
    { choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }] },
    { choices: [{ delta: { content: JSON.stringify(value) }, index: 0, finish_reason: null }] },
    { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }], usage: { prompt_tokens: 13, completion_tokens: 7, total_tokens: 20 } },
  ]) response.write(`data: ${JSON.stringify(event)}\n\n`);
  response.end('data: [DONE]\n\n');
}

function configure(store: CityStore, baseUrl: string) {
  for (const agent of store.getAgents()) store.updateAgent(agent.id, {
    provider: 'openai-compatible', baseUrl, modelId: `${agent.role}-frozen`, apiKey: `${agent.role}-fixture-key`,
  });
}

function verifyHashes(store: CityStore, run: Run, manifest: Manifest) {
  assert.ok(Object.keys(manifest.artifactHashes).length >= 1);
  for (const [name, expected] of Object.entries(manifest.artifactHashes)) {
    assert.ok(run.artifacts.some(artifact => artifact.name === name), name);
    const actual = createHash('sha256').update(readFileSync(path.join(store.runDir(run.id), name))).digest('hex');
    assert.equal(actual, expected, `artifact hash: ${name}`);
  }
}

const checks: AcceptanceCheck[] = [
  { name: '明确模拟限制', steps: [{ action: 'assertText', selector: '#disclaimer', text: '规则模拟' }] },
  { name: '价格修改会改变意愿', steps: [
    { action: 'fill', selector: '#price', value: '49' },
    { action: 'assertChanged', selector: '#acceptance', after: { action: 'click', selector: '#simulate' } },
  ] },
];
const html = (repaired: boolean) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>本地模型测试页面</title></head>
<body><h1>商品调研</h1><p id="disclaimer">规则模拟，不是真实居民调研</p><label>价格<input id="price" type="number" value="29"></label>
<button id="simulate">更新</button><p id="acceptance">50%</p>
${repaired ? '<script>document.querySelector("#simulate").addEventListener("click",()=>{document.querySelector("#acceptance").textContent=Math.max(0,100-Number(document.querySelector("#price").value))+"%"})</script>' : ''}
</body></html>`;

test('demo runner executes real Chromium and publishes verifiable template artifacts without L5 claims', { timeout: 45_000 }, async t => {
  const { store, input, read } = fixture(t);
  const run = store.createRun(input('demo'));
  await createRunner(store, { demoDelayMs: 0 }).start(run.id, run.input);
  const finished = store.getRun(run.id)!;
  assert.equal(finished.status, 'completed', finished.error);
  assert.equal(finished.gate?.passed, true);
  assert.ok(finished.gate?.checks.every(check => check.passed));
  assert.ok(finished.stages.every(stage => stage.status === 'completed'));
  const manifest = read(run.id, 'manifest.json');
  assert.equal(manifest.realL5Evidence, false);
  assert.equal(manifest.generatedBy, 'versioned-demo-template');
  assert.equal(manifest.modelCalls, 0);
  assert.deepEqual(finished.usage, { inputTokens: 0, outputTokens: 0, estimatedCost: null });
  for (const name of ['request.json', 'spec.json', 'research.json', 'survey.json', 'acceptance.json', 'index.html', 'gate.json', 'manifest.json']) {
    assert.ok(finished.artifacts.some(artifact => artifact.name === name), name);
  }
  verifyHashes(store, finished, manifest);
});

test('live runner uses real Harness with local model fixtures, frozen snapshots and real browser-driven repair', { timeout: 90_000 }, async t => {
  const { store, input, read } = fixture(t);
  let runId = '';
  let developerCalls = 0;
  const requestedModels: string[] = [];
  const frozenDocuments: string[] = [];
  await withProvider((request, response, body) => {
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(body.tools, undefined);
    requestedModels.push(body.model);
    const role = body.model.replace(/-frozen$/, '') as Role;
    assert.equal(request.headers.authorization, `Bearer ${role}-fixture-key`);
    if (role === 'product') {
      complete(response, { title: '本地测试规格', goal: '交付交互调研页面', scope: 'static-web-app',
        tasks: ['product', 'researcher', 'developer', 'tester'].map(taskRole => ({ role: taskRole, objective: `完成${taskRole}职责`, deliverable: `${taskRole}.json` })),
        acceptanceCriteria: ['显示模拟限制', '价格更新改变结果'], limitations: ['预设规则不能证明真实市场需求'] });
    } else if (role === 'researcher') {
      complete(response, { summary: '人口统计有来源，意愿是规则模拟。', evidence: [{ claim: '已登记历史人口资料', provenance: 'fact', sourceIds: [getCityProfile().sources[0].id] }], risks: ['模拟结果不等于真人调研'] });
    } else if (role === 'tester') {
      complete(response, { checks });
    } else {
      assert.equal(role, 'developer');
      developerCalls++;
      const context = JSON.parse(body.messages.find(message => message.role === 'user')!.content) as { checks: AcceptanceCheck[]; gate?: { passed: boolean } };
      assert.deepEqual(context.checks, checks);
      const frozen = readFileSync(path.join(store.runDir(runId), 'acceptance.json'), 'utf8');
      frozenDocuments.push(frozen);
      assert.deepEqual(JSON.parse(frozen).checks, checks);
      if (developerCalls === 2) assert.equal(context.gate?.passed, false);
      complete(response, { html: html(developerCalls > 1), notes: 'Local deterministic provider fixture; not an external model.' });
    }
  }, async baseUrl => {
    configure(store, baseUrl);
    const run = store.createRun(input('live'));
    runId = run.id;
    // Subsequent edits must not change the already queued run's models or keys.
    for (const agent of store.getAgents()) store.updateAgent(agent.id, { modelId: `${agent.role}-edited`, apiKey: `${agent.role}-edited-key` });
    await createRunner(store).start(run.id, run.input);
    const finished = store.getRun(run.id)!;
    assert.equal(finished.status, 'completed', finished.error);
    assert.equal(finished.gate?.passed, true);
    assert.equal(read<{ passed: boolean }>(run.id, 'gate-attempt-1.json').passed, false);
    assert.equal(read<{ passed: boolean }>(run.id, 'gate-attempt-2.json').passed, true);
    assert.equal(developerCalls, 2);
    assert.equal(frozenDocuments.length, 2);
    assert.equal(frozenDocuments[0], frozenDocuments[1]);
    assert.deepEqual(new Set(requestedModels), new Set(['product-frozen', 'researcher-frozen', 'tester-frozen', 'developer-frozen']));
    assert.equal(finished.stages.find(stage => stage.role === 'developer')?.attempt, 2);
    assert.equal(finished.usage.inputTokens, 65);
    assert.equal(finished.usage.outputTokens, 35);
    const manifest = read(run.id, 'manifest.json');
    assert.equal(manifest.modelCalls, 5);
    assert.equal(manifest.realL5Evidence, false);
    assert.equal(manifest.marketResearchValidated, false);
    assert.equal(manifest.executionEvidence.modelExecution.transport, 'deepseek-harness');
    assert.equal(manifest.executionEvidence.modelExecution.responses, 5);
    assert.equal(manifest.executionEvidence.modelExecution.identityStatus, 'unverified');
    assert.ok(manifest.executionEvidence.modelExecution.configuredModels.every(model => model.endpointClass === 'loopback'));
    assert.equal(manifest.executionEvidence.engineering.gate.kind, 'chromium-gate');
    assert.equal(manifest.executionEvidence.engineering.status, 'verified-engineering-with-frozen-checks');
    assert.equal(manifest.repairCount, 1);
    assert.equal(manifest.acceptanceHash, createHash('sha256').update(JSON.stringify(checks)).digest('hex'));
    verifyHashes(store, finished, manifest);
    assert.equal(JSON.stringify(finished).includes('fixture-key'), false);
  });
});

test('a real Harness provider failure produces a failed run and redacted terminal manifest', { timeout: 45_000 }, async t => {
  const { store, input, read } = fixture(t);
  await withProvider((_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: 'Rejected product-fixture-key', type: 'authentication_error' } }));
  }, async baseUrl => {
    configure(store, baseUrl);
    const run = store.createRun(input('live'));
    await createRunner(store).start(run.id, run.input);
    const finished = store.getRun(run.id)!;
    assert.equal(finished.status, 'failed');
    assert.equal(finished.gate, undefined);
    assert.ok(finished.error);
    const manifest = read(run.id, 'manifest.json');
    assert.equal(manifest.status, 'failed');
    assert.equal(manifest.realL5Evidence, false);
    assert.equal(manifest.modelCalls, 1);
    assert.equal(JSON.stringify(finished).includes('product-fixture-key'), false);
    for (const artifact of finished.artifacts) {
      assert.equal(readFileSync(path.join(store.runDir(run.id), artifact.path), 'utf8').includes('product-fixture-key'), false);
    }
    verifyHashes(store, finished, manifest);
  });
});

test('cancelling the actual runner closes its Harness request and records a terminal manifest', { timeout: 45_000 }, async t => {
  const { store, input, read } = fixture(t);
  let reached!: () => void;
  const providerReached = new Promise<void>(resolve => { reached = resolve; });
  let connectionClosed = false;
  await withProvider((_request, response) => {
    response.on('close', () => { connectionClosed = true; });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.write(': waiting for cancellation\n\n');
    reached();
  }, async baseUrl => {
    configure(store, baseUrl);
    const run = store.createRun(input('live'));
    const runner = createRunner(store);
    const work = runner.start(run.id, run.input);
    await providerReached;
    await runner.cancel(run.id);
    await work;
    const finished = store.getRun(run.id)!;
    assert.equal(connectionClosed, true);
    assert.equal(finished.status, 'cancelled');
    assert.ok(finished.finishedAt);
    assert.ok(finished.stages.every(stage => !['pending', 'running'].includes(stage.status)));
    const manifest = read(run.id, 'manifest.json');
    assert.equal(manifest.status, 'cancelled');
    assert.equal(manifest.realL5Evidence, false);
    assert.equal(manifest.modelCalls, 1);
    verifyHashes(store, finished, manifest);
  });
});
