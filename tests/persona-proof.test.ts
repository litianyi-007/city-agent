import assert from 'node:assert/strict';
import test from 'node:test';
import { ZodError } from 'zod';
import { fingerprint } from '../shared/evidence.ts';
import { fixtureAnswers, residentPrompt, validateAnswers } from '../shared/survey-engine.ts';
import { createDefaultPersona } from '../shared/resident-persona.ts';
import { researchTaskSchema } from '../shared/research-schema.ts';
import { createPersonaProof, renderPersonaProofReport } from '../scripts/create-persona-proof.ts';
import { parseSurveyEvidence } from '../src/run-history.ts';

test('five-layer proof retains a full questionnaire, independent prompts, raw answers and traceable unweighted statistics', async () => {
  const proof = await createPersonaProof({ id: '11111111-1111-4111-8111-111111111111' });
  const { run, report } = proof;
  assert.equal(run.mode, 'fixture'); assert.equal(run.state, 'completed');
  assert.equal(run.metrics.planned, 12); assert.equal(run.metrics.valid, 12);
  assert.equal(run.metrics.modelCalls, 0); assert.equal(run.metrics.inputTokens, 0); assert.equal(run.metrics.outputTokens, 0);
  assert.equal(run.metrics.apiCostCny, 0); assert.equal(run.marketResearchValidated, false);
  assert.equal(run.sampling?.populationWeighted, false);
  assert.equal(run.task.questionnaire.questions.length, 16);
  assert.deepEqual(new Set(report.questions.types), new Set(['single', 'multiple', 'scale', 'number', 'text']));
  assert.equal(researchTaskSchema.safeParse(run.task).success, true);
  assert.equal(report.promptLinks.length, 12);
  assert.ok(report.promptLinks.every(link => link.matchesFrozenPersona));
  assert.equal(run.profileHash, fingerprint(run.profiles));
  assert.equal(run.taskHash, fingerprint(run.task));
  for (const profile of run.profiles) {
    assert.ok(profile.persona);
    assert.equal(profile.persona.provenance, 'assumption');
    assert.deepEqual(Object.keys(profile.persona).sort(), ['schemaVersion', 'provenance', 'personality', 'upbringing', 'education', 'household', 'work'].sort());
    const prompt = run.prompt.users.find(user => user.residentId === profile.id)!;
    assert.equal(prompt.hash, fingerprint(prompt.text));
    assert.deepEqual(JSON.parse(prompt.text).resident.persona, profile.persona);
    const response = run.responses.find(item => item.residentId === profile.id)!;
    assert.equal(response.status, 'valid'); assert.equal(response.answers.length, 16);
    assert.deepEqual(validateAnswers(run.task, profile.id, response.raw), response.answers);
  }
  assert.equal(run.profiles.filter(profile => profile.persona?.education.level === 'unknown').length, 6);
  assert.ok(run.profiles.every(profile => profile.persona?.work.income.lower === null));
  assert.ok(report.qualificationPreflight.missingEvidence.some(message => message.includes('petOwner')));
  assert.equal(report.realResidentPreferenceValidated, false); assert.equal(report.personaBehaviorValidated, false);
  assert.equal(report.capabilityChecks.realModelQuality, 'not-tested');
  assert.equal(JSON.stringify(proof).includes('"apiKey"'), false);
  const markdown = renderPersonaProofReport(proof);
  assert.match(markdown, /mode=fixture/); assert.match(markdown, /模型调用=0/); assert.match(markdown, /不是真实居民偏好/);
  assert.match(markdown, /主粮/); assert.match(markdown, /16题/);
});

test('fixture result is deterministic engineering data, not a demonstration of persona-driven preference', async () => {
  const first = await createPersonaProof({ count: 12, seed: 42 });
  const second = await createPersonaProof({ count: 12, seed: 42 });
  assert.equal(first.run.profileHash, second.run.profileHash);
  assert.deepEqual(first.run.responses.map(item => item.raw), second.run.responses.map(item => item.raw));
  const profile = first.run.profiles[0];
  assert.equal(fixtureAnswers(first.run.task, profile, 42), fixtureAnswers(first.run.task, { ...profile, persona: createDefaultPersona() }, 42));
  assert.match(first.report.limitations.join('\n'), /不根据五层画像推导消费偏好/);
});

test('30-person fixture covers its planned denominator without upgrading real complete-rate acceptance', async () => {
  const proof = await createPersonaProof({ count: 30 });
  assert.equal(proof.run.metrics.planned, 30); assert.equal(proof.run.metrics.valid, 30);
  assert.equal(proof.run.metrics.modelCalls, 0);
  assert.equal(proof.report.realResidentPreferenceValidated, false);
  assert.match(proof.report.limitations.join('\n'), /不升级S03/);
});

test('proof rejects unbounded samples, invalid seed and path-like IDs', async () => {
  for (const input of [{ count: 3 }, { count: 31 }, { count: 12.5 }, { seed: -1 }, { seed: Number.NaN }, { id: '../../outside' }]) await assert.rejects(createPersonaProof(input));
});

test('evidence import rejects explicit falsy persona values even with recomputed profile and prompt hashes', async () => {
  const proof = await createPersonaProof({ id: '22222222-2222-4222-8222-222222222222' });
  assert.doesNotThrow(() => parseSurveyEvidence(proof.run));
  for (const invalidPersona of [null, false, 0, '']) {
    const run = structuredClone(proof.run);
    for (const profile of run.profiles) (profile as unknown as { persona: unknown }).persona = invalidPersona;
    for (const preset of run.presetSnapshots!) (preset as unknown as { persona: unknown }).persona = invalidPersona;
    run.profileHash = fingerprint(run.profiles);
    run.prompt.users = run.profiles.map(profile => {
      const text = residentPrompt(run.task, profile, run.exposure);
      return { residentId: profile.id, text, hash: fingerprint(text) };
    });
    assert.equal(run.profileHash, fingerprint(run.profiles));
    assert.ok(run.prompt.users.every(user => user.hash === fingerprint(user.text)));
    assert.ok(run.profiles.every(profile => fingerprint(profile.persona) === fingerprint(run.presetSnapshots!.find(preset => preset.id === profile.presetId)!.persona)));
    // A strict schema error, not a mismatched fingerprint, must reject each forged value.
    assert.throws(() => parseSurveyEvidence(run), ZodError, `persona=${JSON.stringify(invalidPersona)}`);
  }
  assert.ok(proof.run.profiles.every(profile => profile.persona?.provenance === 'assumption'));
});
