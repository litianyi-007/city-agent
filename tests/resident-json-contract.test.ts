import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getPopulationModel, getPopulationPack } from '../server/population/service';
import { createBusinessDemoRun } from '../shared/research-demo';
import { createLiveBusinessProtocol, createLiveBusinessContractProtocol } from '../shared/live-business-protocol';
import { fingerprint, RESIDENT_PROMPT_VERSION, RESIDENT_SYSTEM_PROMPT, validateAnswers, type SurveyRun } from '../shared/survey-engine';
import { parseSurveyEvidence } from '../src/run-history';

const model = { provider: 'deepseek' as const, baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash' };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test('historical 2.0 and real 2.1 evidence remain byte-identical and are not upgraded by the new verifier', async () => {
  for (const filename of ['public/submission/live-run.json',
    'public/submission-next/live-proof/child-snacks/survey-run.json',
    'public/submission-next/live-proof/pet-snacks/survey-run.json']) {
    const url = new URL('../' + filename, import.meta.url);
    const bytes = await readFile(url); const input = JSON.parse(bytes.toString()) as SurveyRun;
    const original = structuredClone(input);
    assert.deepEqual(parseSurveyEvidence(input), original);
    assert.deepEqual(input, original);
    assert.notEqual(input.version, 'coverage-survey-2.2-json-contract');
    assert.equal(sha(await readFile(url)), sha(bytes));
    if (filename.includes('submission-next')) {
      assert.equal(input.version, 'coverage-survey-2.1-persona-layers');
      for (const response of input.responses.filter(item => item.status === 'invalid')) {
        assert.throws(() => validateAnswers(input.task, response.residentId, response.raw));
        assert.equal(response.raw, original.responses.find(item => item.residentId === response.residentId)!.raw);
      }
    }
  }
});

test('new evidence registers the exact 1.1 system contract and rejects silent old-prompt relabeling', async () => {
  const { run } = await createBusinessDemoRun({ demoId: 'child-snacks', population: getPopulationModel(), pack: getPopulationPack(), seed: 20261007 });
  assert.equal(run.version, 'coverage-survey-2.2-json-contract');
  assert.equal(run.parameters?.residentPromptVersion, RESIDENT_PROMPT_VERSION);
  assert.equal(run.prompt.system, RESIDENT_SYSTEM_PROMPT);
  assert.deepEqual(parseSurveyEvidence(JSON.parse(JSON.stringify(run))), run);
  const missing = structuredClone(run); delete missing.parameters!.residentPromptVersion;
  assert.throws(() => parseSurveyEvidence(missing), /Prompt版本/);
  const mislabeled = structuredClone(run); mislabeled.prompt.system = 'historical system, not registered contract';
  mislabeled.prompt.systemHash = fingerprint(mislabeled.prompt.system);
  assert.throws(() => parseSurveyEvidence(mislabeled), /Prompt版本/);
});

test('1.1 trial is a distinct registration, with unchanged questions, qualification and quality gates', () => {
  for (const id of ['child-snacks', 'pet-snacks'] as const) {
    const old = createLiveBusinessProtocol(id, model); const current = createLiveBusinessContractProtocol(id, model);
    assert.equal(old.protocolVersion, 'live-business-smoke-1.0');
    assert.equal(old.task.questionnaire.version, 'live-business-smoke-1.0');
    assert.equal(current.protocolVersion, 'live-business-smoke-1.1');
    assert.equal(current.task.questionnaire.version, 'live-business-smoke-1.1');
    assert.notEqual(current.task.id, old.task.id);
    assert.deepEqual(current.task.questionnaire.questions, old.task.questionnaire.questions);
    assert.deepEqual(current.logicRules, old.logicRules);
    assert.deepEqual(current.qualificationProtocol, old.qualificationProtocol);
    assert.deepEqual(current.presets, old.presets);
  }
});
