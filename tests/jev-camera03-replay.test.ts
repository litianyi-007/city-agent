import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluateJevCandidates } from '../server/production/jev.js';
import type { JevCandidateContext } from '../shared/jev-schema.js';
import type { ProductionRun } from '../shared/production-schema.js';

test('CAMERA-03 raw response remains rejected but is counterfactually classified as arithmetic drift by v3, with old evidence unchanged', async () => {
  const originalBytes = readFileSync(new URL('../docs/production/experiments/CAMERA-03/run.json', import.meta.url));
  const run: ProductionRun = JSON.parse(originalBytes.toString('utf8'));
  const original = run.jevCalls![0].evaluation;
  assert.equal(run.status, 'failed'); assert.equal(original.policyVersion, 'jev-candidate-v2'); assert.equal(original.requestSnapshot!.state.phaseReview!.version, 'verifier-phase-ordinal-v2');
  const state = original.requestSnapshot!.state;
  const context: JevCandidateContext = { phase: state.phase, goal: state.goal, acceptance: state.acceptance, frozenHash: state.frozenHash, candidates: state.candidates, capability: state.capability, reviewContext: state.reviewContext };
  const body = original.rawResponse as { answers: Record<string, { score: number; probabilities: Record<string, number> }>; usage: { input_tokens: number; output_tokens: number } };
  const unchanged = JSON.stringify(body);
  const scope = body.answers.c0_scope;
  const displayed = Object.entries(scope.probabilities).reduce((sum, [level, probability]) => sum + Number(level) * probability, 0);
  assert.ok(Math.abs(displayed - 2.76) < 1e-10);
  // Independently enumerate simplex vertices: four bounds and one residual.
  // This checks the production greedy extremum without importing its algorithm.
  const probabilities = [0, 1, 2, 3, 4].map(level => scope.probabilities[String(level)]);
  const means: number[] = [];
  for (let residual = 0; residual < 5; residual++) for (let mask = 0; mask < 16; mask++) {
    let bit = 0;
    const values = probabilities.map((probability, index) => index === residual ? 0 : probability + ((mask >> bit++) & 1 ? 0.005 : -0.005));
    values[residual] = 1 - values.reduce((sum, probability) => sum + probability, 0);
    if (values[residual] < probabilities[residual] - 0.005 - 1e-10 || values[residual] > probabilities[residual] + 0.005 + 1e-10) continue;
    means.push(values.reduce((sum, probability, level) => sum + probability * level, 0));
  }
  assert.ok(Math.abs(Math.min(...means) - 2.73) < 1e-10);
  assert.ok(Math.abs(Math.max(...means) - 2.79) < 1e-10);
  assert.ok(scope.score + 0.005 < Math.min(...means) - 1e-10);
  let injectedCalls = 0;
  const result = await evaluateJevCandidates({ ...run.jevSnapshot!, apiKey: 'camera03-replay-fixture-not-a-real-key' }, context, new AbortController().signal, {
    fetch: (async (_url, init) => {
      injectedCalls++;
      const currentRequest = JSON.parse(String(init?.body));
      assert.deepEqual(currentRequest.state.candidates, original.requestSnapshot!.state.candidates);
      assert.equal(currentRequest.state.goal, state.goal); assert.deepEqual(currentRequest.state.acceptance, state.acceptance); assert.deepEqual(currentRequest.state.reviewContext, state.reviewContext);
      assert.equal(currentRequest.state.phaseReview.version, 'verifier-phase-ordinal-v4', 'new request criteria, not a retrospective rewrite of v2');
      return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch,
  });
  assert.equal(injectedCalls, 1, 'injected transport only; no actual HTTP request');
  assert.equal(result.status, 'error');
  assert.equal(result.policyVersion, 'jev-candidate-v3'); assert.equal(result.errorKind, 'arithmetic-drift');
  assert.deepEqual(result.diagnostics, [{ code: 'score-mean-drift', answerId: 'c0_scope' }]); assert.deepEqual(result.scores, []); assert.equal(result.choice, null);
  assert.equal(result.selectedCandidateId, null);
  assert.match(result.reason, /c0_scope: score does not match any probability-weighted value within display rounding/);
  assert.equal(result.usage.complete, true);
  assert.equal(result.usage.inputTokens, 7024);
  assert.equal(result.usage.outputTokens, 162);
  assert.deepEqual(result.rawResponse, original.rawResponse);
  assert.equal(JSON.stringify(body), unchanged, 'do not normalize or rewrite the provider response');
  assert.deepEqual(readFileSync(new URL('../docs/production/experiments/CAMERA-03/run.json', import.meta.url)), originalBytes, 'historical failed run bytes remain unchanged');
});
