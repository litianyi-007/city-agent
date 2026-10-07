import assert from 'node:assert/strict';
import test from 'node:test';
import { CRITERIA_VERSION, parseVerifiedDecision, verifierSchema } from '../server/production/contracts.js';
import type { ProductionCapability } from '../shared/production-schema.js';
import { phaseVerifierSystemPrompt, productionPhaseRubric, PRODUCTION_VERIFIER_VERSION, VERIFIER_COMPACT_OUTPUT_POLICY } from '../shared/production-verifier-rubric.js';

const phases = ['product', 'research', 'think-design', 'acceptance', 'implement', 'repair-0', 'repair-1', 'repair-2', 'feedback-0', 'feedback-1', 'feedback-2'];
const capabilities: ProductionCapability[] = ['offline-single-html', 'camera-scene-v1'];
const promptLine = (prompt: string, prefix: string) => {
  const line = prompt.split('\n').find(value => value.startsWith(prefix));
  assert.ok(line, `Missing prompt line: ${prefix}`);
  return line.slice(prefix.length);
};

test('new verifier criteria and compact policy apply to every registered phase and capability', () => {
  assert.equal(PRODUCTION_VERIFIER_VERSION, 'verifier-phase-ordinal-v5');
  assert.equal(CRITERIA_VERSION, PRODUCTION_VERIFIER_VERSION);
  assert.deepEqual(VERIFIER_COMPACT_OUTPUT_POLICY, { version: 'verifier-compact-output-v2', candidateReasonTargetCharacters: 120, overallReasonTargetCharacters: 160, hostCandidateReasonMaximum: 1000, hostOverallReasonMaximum: 1500 });
  for (const capability of capabilities) for (const phase of phases) {
    const rubric = productionPhaseRubric(phase, capability)!;
    const prompt = phaseVerifierSystemPrompt(rubric);
    assert.equal(rubric.version, PRODUCTION_VERIFIER_VERSION);
    assert.equal(rubric.minimumOrdinalScore, 3);
    assert.ok(prompt.includes(rubric.expectedArtifact));
    assert.ok(prompt.includes(rubric.evidenceBoundary));
    assert.ok(prompt.includes(rubric.dimensions.coverage));
    assert.match(rubric.dimensions.coverage, /Preserve ALL explicit goal\/acceptance constraints/);
    assert.match(rubric.dimensions.coverage, /Schema enums never authorize optionalizing, reversing, disabling \(none\) or omitting required behavior/);
    assert.match(rubric.dimensions.coverage, /unsupported requirements block, never silently weaken the goal/);
    for (const dimension of [rubric.dimensions.consistency, rubric.dimensions.scope]) assert.match(dimension, /Apply ALL coverage business constraints/);
    assert.equal(prompt.split('Preserve ALL explicit goal/acceptance constraints').length - 1, 1, 'Full host business policy appears once; all dimensions retain its obligation');
    assert.match(prompt, /只能返回一个完整严格JSON对象/);
    assert.match(prompt, /不加Markdown、围栏、注释或额外前后文字/);
    assert.match(prompt, /reason必须是简短标量字符串/);
    assert.match(prompt, /不复制候选代码、HTML\/配置、长引文或完整上下文，不输出思维过程/);
    assert.doesNotMatch(prompt, /accept\|abstain|候选ID或null|0至5整数,"reason"/);
  }
  for (const phase of ['developer', 'whole-answer', 'repair-3', 'feedback-3']) assert.equal(productionPhaseRubric(phase), null);
});

test('all embedded complete-output examples parse as strict current-schema decisions', () => {
  for (const capability of capabilities) for (const phase of phases) {
    const prompt = phaseVerifierSystemPrompt(productionPhaseRubric(phase, capability)!);
    for (const [prefix, decision] of [['接受语法示例：', 'accept'], ['弃权语法示例：', 'abstain']] as const) {
      const text = promptLine(prompt, prefix);
      const example = verifierSchema.parse(JSON.parse(text));
      assert.equal(text, JSON.stringify(example));
      assert.equal(example.decision, decision);
      assert.equal(parseVerifiedDecision(example, example.scores.map(score => score.candidateId)).decision, decision);
      assert.ok(example.reason.length <= VERIFIER_COMPACT_OUTPUT_POLICY.overallReasonTargetCharacters);
      assert.ok(example.scores.every(score => score.reason.length <= VERIFIER_COMPACT_OUTPUT_POLICY.candidateReasonTargetCharacters));
      if (decision === 'abstain') {
        assert.equal(example.selectedCandidateId, null);
        assert.equal(example.scores.length, 2);
        assert.ok(example.scores.every(score => score.score < 3));
      } else assert.ok(text.includes('\\"静态审查\\"'), 'Quoted evidence label must be JSON-escaped');
    }
  }
});

test('string encoding example round-trips double quotes, backslashes and control characters', () => {
  const prompt = phaseVerifierSystemPrompt(productionPhaseRubric('implement')!);
  assert.match(prompt, /JSON.stringify兼容的JSON转义/);
  assert.match(prompt, /U\+0000–U\+001F控制字符/);
  assert.match(prompt, /禁止将未转义双引号、反斜杠或原始控制字符放入JSON字符串/);
  const text = promptLine(prompt, '任何字符串中的双引号、反斜杠、换行、制表、回车及其他U+0000–U+001F控制字符必须使用JSON.stringify兼容的JSON转义，禁止将未转义双引号、反斜杠或原始控制字符放入JSON字符串。字符串编码示例（仅语法，不是完整输出，也不代表证据）：');
  const expected = '引号"、反斜杠\\、换行\n、制表\t、回车\r、控制字符\u0000';
  assert.equal(text, JSON.stringify(expected));
  assert.equal(JSON.parse(text), expected);
  assert.doesNotMatch(text, /[\u0000-\u001f]/);
  for (const escape of ['\\"', '\\\\', '\\n', '\\t', '\\r', '\\u0000']) assert.ok(text.includes(escape), `Missing JSON escape: ${escape}`);
});

test('stage-aware evidence rules require applicable boundary coverage and all-bad abstention without overriding Gate', () => {
  for (const capability of capabilities) for (const phase of phases) {
    const rubric = productionPhaseRubric(phase, capability)!;
    const coverage = rubric.dimensions.coverage;
    const prompt = phaseVerifierSystemPrompt(rubric);
    assert.match(coverage, /Map original clauses to stage evidence/);
    assert.match(coverage, /Check applicable threshold equality\/below\/above, empty, min\/max, zero\/negative, rounding\/state changes/);
    assert.match(coverage, /Product\/research\/plan preserve\/plan cases/);
    assert.match(coverage, /acceptance needs independent exact assertions/);
    assert.match(coverage, /implementation checks artifact/);
    assert.match(coverage, /feedback uses supplied Gate/);
    assert.match(coverage, /Never demand future artifacts or execute code/);
    assert.match(coverage, /static review is not execution/);
    assert.match(coverage, /Tests\/search\/device claims need control-plane execution evidence/);
    assert.match(coverage, /Required failures score <3/);
    assert.match(coverage, /all-bad\/insufficient evidence means abstain regardless of rank/);
    assert.match(coverage, /Never override hardGate\/frozen Gate or broaden recorded acceptance/);
    assert.ok(coverage.slice(coverage.indexOf('Map original clauses')).length <= 600, 'Generic checklist stays compact so complete review evidence fits unchanged request caps');
    assert.match(prompt, /两候选都不合格或证据不足时必须abstain/);
    assert.match(prompt, /5分需充分覆盖且无实质缺口/);
    assert.doesNotMatch(prompt, /H02|H04|VERIFIER-REAL-01|total\s*>\s*100|toFixed\(2\)/);
  }
});
