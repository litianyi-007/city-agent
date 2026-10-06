import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getCityProfile } from '../server/city.js';
import { buildExecutionEvidence } from '../server/execution-evidence.js';
import { createRunner } from '../server/orchestrator.js';
import { CityStore } from '../server/store.js';
import type { Role } from '../server/types.js';

test('completed injected live pipeline cannot advertise authentic models, Chromium or general L5', async t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'city-agent-evidence-manifest-'));
  const store = new CityStore(directory);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  for (const agent of store.getAgents()) {
    store.updateAgent(agent.id, { apiKey: 'fixture-only-secret', modelId: agent.role });
  }
  const run = store.createRun({
    task: '建立有交互的模拟报告页面', mode: 'live', agentIds: store.getAgents().map(agent => agent.id), sampleSize: 30,
  });
  const replies: Record<Role, unknown> = {
    product: {
      title: 'Evidence fixture', goal: '检查执行证据而不是外部模型', scope: 'static-web-app',
      tasks: ['product', 'researcher', 'developer', 'tester'].map(role => ({ role, objective: '完成测试职责', deliverable: 'fixture' })),
      acceptanceCriteria: ['显示标题', '点击后结果变化'], limitations: ['注入的测试替身不能证明模型能力'],
    },
    researcher: {
      summary: '这里只使用历史人口事实和规则夹具。',
      evidence: [{ claim: '历史人口资料', provenance: 'fact', sourceIds: [getCityProfile().sources[0].id] }],
      risks: ['没有执行居民模型问卷'],
    },
    tester: { checks: [
      { name: '标题', steps: [{ action: 'assertVisible', selector: 'h1' }] },
      { name: '交互', steps: [{ action: 'assertChanged', selector: '#result', after: { action: 'click', selector: '#button' } }] },
    ] },
    developer: { html: '<!doctype html><html><head><title>Injected fixture</title></head><body><h1>Test</h1><button id="button">Run</button><p id="result">A</p></body></html>' },
  };
  let attempts = 0;
  await createRunner(store, {
    runRole: async config => {
      attempts++;
      // One format retry proves that responses are counted separately from
      // accepted stage artifacts, not just inferred from four completed roles.
      return {
        text: attempts === 1 ? 'not-json' : JSON.stringify(replies[config.modelId as Role]),
        inputTokens: 1, outputTokens: 1, harness: 'injected-test-double',
      };
    },
    runGate: async () => ({ passed: true, checks: [{ name: 'injected gate', passed: true }] }),
  }).start(run.id, run.input);
  const finished = store.getRun(run.id)!;
  assert.equal(finished.status, 'completed', finished.error);
  assert.equal(attempts, 5);
  const manifest = JSON.parse(readFileSync(path.join(store.runDir(run.id), 'manifest.json'), 'utf8'));
  assert.equal(manifest.realL5Evidence, false);
  assert.equal(manifest.marketResearchValidated, false);
  assert.equal(manifest.generatedBy, 'injected-role-adapter');
  assert.equal(manifest.harness, null);
  assert.deepEqual(manifest.executionEvidence, buildExecutionEvidence({
    mode: 'live', status: 'completed', modelCalls: 5, modelResponses: 5,
    usesInjectedModel: true, usesInjectedGate: true, gatePassed: true,
    gateExecuted: true, acceptanceFrozen: true, artifactDelivered: true,
    agentSnapshot: run.agentSnapshot,
  }));
  assert.equal(JSON.stringify(manifest).includes('fixture-only-secret'), false);
});
