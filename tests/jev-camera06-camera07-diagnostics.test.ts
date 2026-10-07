import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluateJevCandidates } from '../server/production/jev.js';
import type { JevCandidateContext, JevEvaluation } from '../shared/jev-schema.js';
import type { ProductionRun } from '../shared/production-schema.js';

// Free, injected transport replay of six preserved evaluations, not new model
// HTTP requests, a new quality experiment, autonomous delivery or supplier fault
// attribution. ±.005 is our versioned nearest-two-decimal assumption, not an
// official TypeSafe precision/serialization guarantee.
const LOCAL_DISPLAY_HALF_QUANTUM = 0.005;
const EPSILON = 1e-12;
const DIMENSIONS = ['coverage', 'consistency', 'scope'] as const;
const PHASES = ['product', 'research', 'think-design'] as const;
const ARCHIVES = {
  'CAMERA-06': {
    commit: 'e91a029f6f6053ef1afe260ff6f4557075ada776',
    hashes: {
      'run.json': '3c231fc1f30932899d93488948ed6d381d9bf10d4d02fbdd95d7b2b680960394',
      'evidence.json': 'd3218b84568d16e72176f14fd7376d43605daa4038eb44a7df5b6ca2ac11db4f',
      'delivery-manifest.json': '3171c89b86b5df6428261e77ae1bb155684f4203f8829e27b9d4094c5f071f07',
      'platform-metadata.json': '0e01b38a50c869d91c7d0c1645c3a15fe619c0e6aff9a2b0bdd361984d00d1f2',
    },
  },
  'CAMERA-07': {
    commit: 'f30336381ed219b7738a5891e911da565aa1aaab',
    hashes: {
      'run.json': 'bb2cb22cad787d1fedc332b690983730733317c09d30bef93d931f7fb3609f55',
      'evidence.json': '954f411217e0050f07eba66ba908570121c257b300f75949a43856bd234a8139',
      'delivery-manifest.json': '0a570c6aaebc4f71af97358401098d13a75cc369f23a272444a6ad6cace46018',
      'platform-metadata.json': '4bf9cf11bd189c664c4325fb70a9139e702eb20b0e7d2f496c6c36a3548ec139',
    },
  },
} as const;
type ArchiveName = keyof typeof ARCHIVES;
const archiveNames = Object.keys(ARCHIVES) as ArchiveName[];
const fileUrl = (name: ArchiveName, file: string) => new URL(`../docs/production/experiments/${name}/${file}`, import.meta.url);
const load = (name: ArchiveName): ProductionRun => JSON.parse(readFileSync(fileUrl(name, 'run.json'), 'utf8'));
const near = (actual: number, expected: number, label: string) => assert.ok(Math.abs(actual - expected) < EPSILON, `${label}: ${actual} != ${expected}`);
function assertUnchangedFiles() {
  for (const name of archiveNames) for (const [file, hash] of Object.entries(ARCHIVES[name].hashes)) {
    assert.equal(createHash('sha256').update(readFileSync(fileUrl(name, file))).digest('hex'), hash, `${name}/${file}: preserved historical bytes`);
  }
}
interface RawScore { type: 'score'; score: number; confidence: number; probabilities: Record<string, number>; legend: Record<string, string>; }
interface RawResponse { model: string; answers: Record<string, RawScore | { type: 'choice' | 'noul' }>; usage: { input_tokens: number; output_tokens: number }; }
function raw(evaluation: JevEvaluation): RawResponse {
  assert.ok(evaluation.rawResponse && typeof evaluation.rawResponse === 'object');
  return evaluation.rawResponse as RawResponse;
}
function score(evaluation: JevEvaluation, dimension: typeof DIMENSIONS[number]): RawScore {
  const answer = raw(evaluation).answers[`c0_${dimension}`];
  assert.equal(answer.type, 'score');
  return answer as RawScore;
}

// Independent expected values from the original numeric fields. Fractions keep
// the concentration reference exact rather than importing production helpers.
const EXPECTED = {
  'CAMERA-06': [
    { means: [2.69, 2.62, 2.51], concentrations: [0, 0, 0], scores: [2.67, 2.65, 2.53], confidences: [0, 0, 0] },
    { means: [3.27, 3.41, 3.24], concentrations: [47 / 120, 61 / 120, 11 / 30], scores: [3.27, 3.42, 3.26], confidences: [.39, .51, .37] },
    { means: [3.27, 3.44, 3.38], concentrations: [47 / 120, 8 / 15, 29 / 60], scores: [3.30, 3.43, 3.37], confidences: [.39, .53, .48] },
  ],
  'CAMERA-07': [
    { means: [2.77, 2.82, 2.74], concentrations: [0, 1 / 60, 0], scores: [2.78, 2.82, 2.74], confidences: [0, .02, 0] },
    { means: [3.56, 3.57, 3.57], concentrations: [19 / 30, 77 / 120, 77 / 120], scores: [3.56, 3.58, 3.58], confidences: [.63, .64, .64] },
    { means: [3.34, 3.48, 3.44], concentrations: [9 / 20, 17 / 30, 8 / 15], scores: [3.35, 3.47, 3.42], confidences: [.45, .57, .53] },
  ],
} as const;

test('CAMERA-06/07 diagnostics preserve all eight evidence files, failed states and original source configurations', () => {
  assertUnchangedFiles();
  for (const name of archiveNames) {
    const run = load(name);
    assert.equal(run.platformCommit, ARCHIVES[name].commit);
    assert.equal(run.status, 'failed');
    assert.equal(run.frozenContract, undefined); assert.deepEqual(run.gateHistory, []);
    assert.deepEqual(run.jevCalls!.slice(0, 3).map(call => call.phase), PHASES);
    assert.equal(run.jevSnapshot!.minScore, 3); assert.equal(run.jevSnapshot!.minConfidence, .5);
    assert.deepEqual(JSON.parse(readFileSync(fileUrl(name, 'evidence.json'), 'utf8')), run);
  }
});

test('independently recomputes all eighteen raw Score means, unique modes and modal MAD concentrations without normalization', () => {
  let observed = 0;
  for (const name of archiveNames) {
    const run = load(name); const before = JSON.stringify(run);
    for (const [phaseIndex, call] of run.jevCalls!.slice(0, 3).entries()) {
      assert.equal(raw(call.evaluation).model, 'jev-1.13.0');
      assert.equal(call.evaluation.requestSnapshot!.state.candidates.length, 1);
      for (const [dimensionIndex, dimension] of DIMENSIONS.entries()) {
        const answer = score(call.evaluation, dimension); const expected = EXPECTED[name][phaseIndex];
        assert.deepEqual(Object.keys(answer.probabilities), ['0', '1', '2', '3', '4']);
        assert.deepEqual(Object.keys(answer.legend), ['0', '1', '2', '3', '4']);
        const entries = Object.entries(answer.probabilities).map(([level, p]) => ({ level: Number(level), p }));
        const sum = entries.reduce((value, item) => value + item.p, 0);
        const mean = entries.reduce((value, item) => value + item.level * item.p, 0);
        const maximum = Math.max(...entries.map(item => item.p));
        const modes = entries.filter(item => item.p === maximum).map(item => item.level);
        assert.deepEqual(modes, [4]); near(sum, 1, `${name}/${call.phase}/${dimension} probability sum`);
        const mad = entries.reduce((value, item) => value + item.p * Math.abs(item.level - modes[0]), 0);
        const uniformMad = entries.reduce((value, item) => value + Math.abs(item.level - 2), 0) / entries.length;
        near(uniformMad, 1.2, 'five-level uniform MAD');
        near(mean, expected.means[dimensionIndex], `${name}/${call.phase}/${dimension} mean`);
        near(Math.max(0, 1 - mad / uniformMad), expected.concentrations[dimensionIndex], `${name}/${call.phase}/${dimension} concentration`);
        assert.equal(answer.score, expected.scores[dimensionIndex]);
        assert.equal(answer.confidence, expected.confidences[dimensionIndex]);
        observed++;
      }
    }
    assert.equal(JSON.stringify(run), before, 'independent diagnostic never rewrites/normalizes raw probability fields');
  }
  assert.equal(observed, 18); assertUnchangedFiles();
});

test('six documented gaps follow from the local ±.005 assumption and the mode-four identity, independently of the LP solver', () => {
  const expectedGaps: Record<string, number> = {
    'CAMERA-06/research/scope': .005,
    'CAMERA-06/think-design/coverage': .021,
    'CAMERA-07/research/consistency': .001,
    'CAMERA-07/research/scope': .001,
    'CAMERA-07/think-design/consistency': .003,
    'CAMERA-07/think-design/scope': .005,
  };
  const observedGaps: Record<string, number> = {};
  for (const name of archiveNames) for (const call of load(name).jevCalls!.slice(0, 3)) for (const dimension of DIMENSIONS) {
    const answer = score(call.evaluation, dimension);
    if (answer.confidence <= LOCAL_DISPLAY_HALF_QUANTUM) continue; // C=0 is floored, so do not assume the positive-C equality.
    const scoreInterval = [answer.score - LOCAL_DISPLAY_HALF_QUANTUM, answer.score + LOCAL_DISPLAY_HALF_QUANTUM];
    // m=4, sum(p)=1 implies MAD=4-μ and positive C implies μ=2.8+1.2C.
    const impliedMeanInterval = [2.8 + 1.2 * (answer.confidence - LOCAL_DISPLAY_HALF_QUANTUM), 2.8 + 1.2 * (answer.confidence + LOCAL_DISPLAY_HALF_QUANTUM)];
    const gap = Math.max(0, scoreInterval[0] - impliedMeanInterval[1], impliedMeanInterval[0] - scoreInterval[1]);
    const key = `${name}/${call.phase}/${dimension}`;
    if (gap > EPSILON) observedGaps[key] = gap;
    near(gap, expectedGaps[key] ?? 0, `${key} conditional display interval gap`);
  }
  assert.deepEqual(Object.keys(observedGaps).sort(), Object.keys(expectedGaps).sort());
  assertUnchangedFiles();
});

for (const name of archiveNames) for (const [index, phase] of PHASES.entries()) {
  test(`${name} ${phase}: injected replay retains ${index === 0 ? 'uncertain' : 'arithmetic-drift'}, never selection or historical rewrite`, async () => {
    const run = load(name); const before = JSON.stringify(run);
    const original = run.jevCalls![index].evaluation; const state = original.requestSnapshot!.state;
    const originalRaw = JSON.stringify(original.rawResponse);
    const context: JevCandidateContext = { phase: state.phase, goal: state.goal, acceptance: state.acceptance, frozenHash: state.frozenHash, candidates: state.candidates, capability: state.capability, reviewContext: state.reviewContext };
    let injectedDispatches = 0;
    const result = await evaluateJevCandidates({ ...run.jevSnapshot!, apiKey: 'camera06-camera07-injected-diagnostics-not-a-real-key' }, context, new AbortController().signal, {
      fetch: (async (_url, init) => {
        injectedDispatches++;
        const request = JSON.parse(String(init?.body));
        assert.deepEqual(request.state.candidates, state.candidates);
        assert.equal(request.state.phase, state.phase); assert.equal(request.state.goal, state.goal);
        assert.deepEqual(request.state.acceptance, state.acceptance); assert.equal(request.state.frozenHash, state.frozenHash);
        assert.deepEqual(request.state.reviewContext, state.reviewContext);
        for (const dimension of DIMENSIONS) assert.deepEqual(request.questions[`c0_${dimension}`].criteria, original.requestSnapshot!.questions[`c0_${dimension}`].criteria);
        return new Response(originalRaw, { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as typeof fetch,
    });
    assert.equal(injectedDispatches, 1, 'pure in-memory dispatch; not an actual provider HTTP attempt');
    assert.equal(result.providerRequests, 1, 'the evaluator counter is simulated here and is not live HTTP evidence');
    assert.equal(result.policyVersion, 'jev-candidate-v3'); assert.equal(original.policyVersion, 'jev-candidate-v3');
    assert.equal(result.status, index === 0 ? 'uncertain' : 'error');
    assert.equal(result.errorKind, index === 0 ? undefined : 'arithmetic-drift');
    assert.equal(result.selectedCandidateId, null); assert.equal(original.selectedCandidateId, null);
    assert.deepEqual(result.diagnostics, original.diagnostics);
    if (index > 0) { assert.deepEqual(result.scores, []); assert.equal(result.choice, null); }
    else { assert.equal(result.scores.length, 1); assert.equal(result.scores[0].qualified, false); }
    assert.equal(result.usage.complete, true); assert.deepEqual(result.usage, original.usage);
    assert.deepEqual(result.rawResponse, original.rawResponse);
    assert.equal(JSON.stringify(result.rawResponse), originalRaw);
    assert.equal(JSON.stringify(run), before, 'no selection, normalization or retrospective new-policy rewrite in the historical run');
    assertUnchangedFiles();
  });
}
