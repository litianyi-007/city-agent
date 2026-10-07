import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildJevCandidateRequest, JEV_REQUEST_LAYOUT_VERSION } from '../server/production/jev.js';
import { productionCoverageContract } from '../shared/production-coverage.js';
import { productionPhaseRubric } from '../shared/production-verifier-rubric.js';
import { productionApiKeySchema, productionRunInputSchema, type ProductionRun } from '../shared/production-schema.js';

test('Jev lossless layout keeps complete state/criteria once, preserves old evidence and fits replayed CAMERA04 per-question limits', () => {
  const file = new URL('../docs/production/experiments/CAMERA-04/run.json', import.meta.url);
  const bytes = readFileSync(file, 'utf8'); const run: ProductionRun = JSON.parse(bytes);
  for (const entry of run.jevCalls!) {
    const old = entry.evaluation.requestSnapshot!;
    const context = { ...old.state, reviewContext: { ...(old.state.reviewContext as object), coverageContract: productionCoverageContract('camera-scene-v1'), cameraBusinessConstraints: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } } };
    const request = buildJevCandidateRequest(old.model, context);
    assert.equal(request.state.requestLayoutVersion, JEV_REQUEST_LAYOUT_VERSION);
    assert.deepEqual(request.state.phaseReview, productionPhaseRubric(context.phase, context.capability));
    assert.deepEqual(request.state.reviewContext, context.reviewContext);
    assert.deepEqual(request.state.candidates, old.state.candidates);
    const perQuestion = Buffer.byteLength(JSON.stringify(request.state)) + Math.max(...Object.values(request.questions).map(question => Buffer.byteLength(JSON.stringify(question))));
    assert.ok(perQuestion <= 32000, `${context.phase}: ${perQuestion}`);
    assert.ok(Buffer.byteLength(JSON.stringify(request)) <= 64000);
  }
  assert.equal(readFileSync(file, 'utf8'), bytes);
});

test('new protocol fields cannot be mistaken for credentials and known-impossible camera constraints are refused before requests', () => {
  for (const field of ['platformMandatoryGate', 'platformEngineering', 'physicalAcceptance', 'cameraBusinessConstraints', 'invariantUnderCssInteraction', JEV_REQUEST_LAYOUT_VERSION, 'requestLayoutVersion', 'jevRequestLayoutVersion', 'harnessPromptTransportVersion', 'harness-literal-prompt-v1']) assert.equal(productionApiKeySchema.safeParse(field).success, false, field);
  const input = { mode: 'live', capability: 'camera-scene-v1', brief: 'A generic declarative scene, not a task keyword branch', agentIds: Array(6).fill('00000000-0000-4000-8000-000000000001'), requirement: { id: 'generic-constraint', source: 'Free engineering fixture', acceptance: 'Explicit mappings, no device claim' }, cameraBusinessConstraints: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } };
  assert.equal(productionRunInputSchema.safeParse(input).success, true);
  assert.equal(productionRunInputSchema.safeParse({ ...input, cameraBusinessConstraints: {} }).success, false);
  assert.equal(productionRunInputSchema.safeParse({ ...input, cameraBusinessConstraints: { openPalm: 'scatter', closedFist: 'scatter' } }).success, false);
  assert.equal(productionRunInputSchema.safeParse({ ...input, capability: 'offline-single-html' }).success, false);
});
