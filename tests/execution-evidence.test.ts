import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionEvidence, type ExecutionEvidenceInput } from '../server/execution-evidence.ts';
import type { Agent, AgentPublic, RunStatus } from '../server/types.ts';

const agent: AgentPublic = {
  id: 'dev-1', name: 'Developer', role: 'developer', provider: 'deepseek',
  modelId: 'configured-model', baseUrl: 'https://api.example.invalid/v1', hasApiKey: true, enabled: true,
};
const completed: ExecutionEvidenceInput = {
  mode: 'live', status: 'completed', modelCalls: 4, modelResponses: 4,
  usesInjectedModel: false, usesInjectedGate: false, gatePassed: true,
  gateExecuted: true, acceptanceFrozen: true, artifactDelivered: true, agentSnapshot: [agent],
};

test('demo can verify template engineering but never claims model-generated code, market validity or L5', () => {
  const evidence = buildExecutionEvidence({ ...completed, mode: 'demo', modelCalls: 0, modelResponses: 0 });
  assert.equal(evidence.engineering.status, 'verified-engineering-with-frozen-checks');
  assert.equal(evidence.engineering.artifact.origin, 'demo-template');
  assert.equal(evidence.modelExecution.transport, 'not-used');
  assert.equal(evidence.modelExecution.identityStatus, 'not-applicable');
  assert.equal(evidence.marketResearchValidated, false);
  assert.equal(evidence.realL5Evidence, false);
});

test('real SDK transport with replies does not authenticate configured vendor or observed model identity', () => {
  const evidence = buildExecutionEvidence(completed);
  assert.equal(evidence.engineering.status, 'verified-engineering-with-frozen-checks');
  assert.equal(evidence.modelExecution.transport, 'deepseek-harness');
  assert.equal(evidence.modelExecution.calls, 4);
  assert.equal(evidence.modelExecution.responses, 4);
  assert.equal(evidence.modelExecution.responseStatus, 'responses-received');
  assert.equal(evidence.modelExecution.identityStatus, 'unverified');
  assert.equal(evidence.modelExecution.observedModels, null);
  assert.equal(evidence.modelExecution.configuredModels[0].endpointClass, 'non-loopback');
  assert.equal(evidence.modelExecution.configuredModels[0].modelId, 'configured-model');
  assert.equal(evidence.realL5Evidence, false);
});

test('a live loopback SSE server remains unverified even when using the real SDK and Chromium', () => {
  for (const baseUrl of ['http://127.0.0.1:8000/v1', 'http://127.1.2.3/v1', 'http://localhost:8000/v1', 'http://[::1]:8000/v1']) {
    const evidence = buildExecutionEvidence({ ...completed, agentSnapshot: [{ ...agent, baseUrl }] });
    assert.equal(evidence.modelExecution.transport, 'deepseek-harness');
    assert.equal(evidence.modelExecution.configuredModels[0].endpointClass, 'loopback');
    assert.equal(evidence.modelExecution.identityStatus, 'unverified');
    assert.equal(evidence.realL5Evidence, false);
  }
});

test('injected model and injected Gate are identified separately and test-double pass is not browser verification', () => {
  const modelOnly = buildExecutionEvidence({ ...completed, usesInjectedModel: true });
  assert.equal(modelOnly.modelExecution.transport, 'injected-adapter');
  assert.equal(modelOnly.engineering.gate.kind, 'chromium-gate');
  assert.equal(modelOnly.engineering.status, 'verified-engineering-with-frozen-checks');
  assert.equal(modelOnly.realL5Evidence, false);
  const both = buildExecutionEvidence({ ...completed, usesInjectedModel: true, usesInjectedGate: true });
  assert.equal(both.engineering.gate.kind, 'injected-test-double');
  assert.equal(both.engineering.gate.passed, true);
  assert.equal(both.engineering.gate.verifiesDelivery, false);
  assert.equal(both.engineering.status, 'unverified-delivery');
});

test('failed, cancelled and nonterminal runs never inherit delivered status from a prior gate pass', () => {
  const statuses: RunStatus[] = ['queued', 'running', 'failed', 'cancelled', 'interrupted'];
  for (const status of statuses) {
    const evidence = buildExecutionEvidence({ ...completed, status });
    assert.equal(evidence.engineering.status, 'not-delivered');
    assert.equal(evidence.engineering.artifact.deliveryStatus, 'partial');
    assert.equal(evidence.engineering.gate.verifiesDelivery, false);
    assert.equal(evidence.realL5Evidence, false);
  }
});

test('missing explicit delivery, Gate execution or frozen checks conservatively prevents verification', () => {
  for (const field of ['artifactDelivered', 'gateExecuted', 'acceptanceFrozen'] as const) {
    const evidence = buildExecutionEvidence({ ...completed, [field]: undefined });
    assert.notEqual(evidence.engineering.status, 'verified-engineering-with-frozen-checks');
    assert.equal(evidence.engineering.gate.verifiesDelivery, false);
  }
  const notRun = buildExecutionEvidence({ ...completed, gateExecuted: false });
  assert.equal(notRun.engineering.gate.kind, 'not-executed');
  assert.equal(notRun.engineering.gate.passed, null);
  const failed = buildExecutionEvidence({ ...completed, gatePassed: false });
  assert.equal(failed.engineering.status, 'unverified-delivery');
  assert.equal(failed.engineering.gate.passed, false);
});

test('attempt counts, zero replies and partial replies are distinct from successful model execution', () => {
  const noReply = buildExecutionEvidence({ ...completed, status: 'failed', modelCalls: 1, modelResponses: 0 });
  assert.equal(noReply.modelExecution.transport, 'deepseek-harness');
  assert.equal(noReply.modelExecution.responseStatus, 'no-responses');
  assert.equal(noReply.modelExecution.identityStatus, 'unverified');
  assert.equal(noReply.realL5Evidence, false);
  const partial = buildExecutionEvidence({ ...completed, modelCalls: 5, modelResponses: 4 });
  assert.equal(partial.modelExecution.responseStatus, 'partial-responses');
  const noCalls = buildExecutionEvidence({ ...completed, modelCalls: 0, modelResponses: 0, usesInjectedModel: true });
  assert.equal(noCalls.modelExecution.transport, 'not-used');
  assert.equal(noCalls.modelExecution.responseStatus, 'not-called');
});

test('configuration is allowlisted, credentials and raw endpoint never escape, and input/output do not alias', () => {
  const privateAgent: Agent = { ...agent, apiKey: 'secret-key-never-emit', baseUrl: 'https://user:password@api.example.invalid/v1?token=secret-query' };
  const input = { ...completed, agentSnapshot: [privateAgent] };
  const before = structuredClone(input);
  const evidence = buildExecutionEvidence(input);
  assert.deepEqual(input, before);
  assert.deepEqual(Object.keys(evidence.modelExecution.configuredModels[0]).sort(), ['agentId', 'endpointClass', 'modelId', 'provider', 'role']);
  const serialized = JSON.stringify(evidence);
  for (const secret of ['apiKey', 'hasApiKey', 'baseUrl', 'secret-key-never-emit', 'password', 'secret-query']) assert.ok(!serialized.includes(secret));
  evidence.modelExecution.configuredModels[0].modelId = 'consumer mutation';
  assert.equal(input.agentSnapshot[0].modelId, 'configured-model');
  assert.equal(buildExecutionEvidence(input).modelExecution.configuredModels[0].modelId, 'configured-model');
});

test('unknown endpoints and unexpected demo calls cannot be promoted to model provenance', () => {
  const evidence = buildExecutionEvidence({ ...completed, mode: 'demo', agentSnapshot: [{ ...agent, baseUrl: 'not a URL' }] });
  assert.equal(evidence.modelExecution.configuredModels[0].endpointClass, 'unknown');
  assert.equal(evidence.engineering.artifact.origin, 'demo-template');
  assert.equal(evidence.modelExecution.identityStatus, 'unverified');
  assert.ok(evidence.limitations.some((text) => text.includes('与正常零调用模板流程不一致')));
  assert.equal(evidence.realL5Evidence, false);
});

test('invalid or impossible counters are rejected rather than silently rounded or coerced', () => {
  for (const override of [
    { modelCalls: -1 }, { modelCalls: 1.5 }, { modelCalls: NaN }, { modelCalls: Infinity },
    { modelResponses: -1 }, { modelResponses: 0.1 }, { modelResponses: 5 },
    { modelCalls: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.throws(() => buildExecutionEvidence({ ...completed, ...override }), RangeError);
});
