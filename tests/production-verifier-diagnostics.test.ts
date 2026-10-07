import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { parseJson, parseVerifiedDecision } from '../server/production/contracts.js';
import { parseVerifierDecisionText, VerifierDecisionError, VERIFIER_DECISION_DIAGNOSTICS_VERSION, VERIFIER_RESPONSE_MAX_BYTES } from '../server/production/verifier-diagnostics.js';
import { verifierPreparationRequests } from '../server/production/verifier-corpus-preparation.js';
import { selectVerifierStudy, VERIFIER_STUDY_STRATEGY_VERSION } from '../server/production/verifier-study-strategy.js';
import { readVerifierReal01Evidence, VERIFIER_REAL01_ARCHIVE_SHA256 } from './fixtures/verifier-real01.js';

const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const ids = ['current-a', 'current-b'];
const verdict = () => ({ decision: 'accept' as 'accept' | 'abstain', selectedCandidateId: ids[1] as string | null,
  scores: ids.map((candidateId, index) => ({ candidateId, score: 3 + index, reason: 'Free injected protocol fixture' })), reason: 'Free injected decision' });
function errorFor(raw: unknown, candidateIds = ids) {
  let caught: unknown;
  try { parseVerifierDecisionText(raw, candidateIds); } catch (error) { caught = error; }
  assert.ok(caught instanceof VerifierDecisionError, 'Expected a typed host diagnostic');
  assert.equal(caught.diagnostic.version, VERIFIER_DECISION_DIAGNOSTICS_VERSION);
  assert.equal(Object.isFrozen(caught.diagnostic), true);
  assert.equal('cause' in caught, false);
  return caught;
}
const invalid = (value: unknown, candidateIds = ids) => errorFor(JSON.stringify(value), candidateIds);

test('syntax, truncation, invalid escapes and raw controls fail before structural or score validation', () => {
  for (const raw of ['{"reason":"unescaped "quote"}', '{"scores":[', '{"reason":"bad\\q"}', '{"reason":"line\nbreak"}', '', 'not-json in JSON at position 12345']) {
    const error = errorFor(raw); const diagnostic = error.diagnostic;
    assert.equal(diagnostic.category, 'json-syntax'); assert.equal(diagnostic.code, 'invalid-json');
    assert.equal(diagnostic.source!.sourceSha256, sha(raw));
    assert.equal(diagnostic.source!.byteLength, Buffer.byteLength(raw)); assert.equal(diagnostic.source!.utf16Length, raw.length);
    assert.match(error.message, /JSON syntax/); assert.equal('excerpt' in diagnostic, false);
  }
  const truncated = errorFor('{"scores":[').diagnostic;
  assert.equal(truncated.category, 'json-syntax');
  if (truncated.category === 'json-syntax') { assert.equal(truncated.position, null); assert.equal(truncated.rawPosition, null); }
});

test('existing complete-fence grammar and exact UTF16 coordinate mapping are retained without JSON extraction', () => {
  const body = '{"reason":"😀","invalid":1,}'; const position = body.lastIndexOf('}');
  for (const raw of [body, ` \r\n${body} \r\n`, ` \n\`\`\`json\n${body}\n\`\`\` \n`, `\uFEFF\t\`\`\`JSON\r\n${body}\r\n\`\`\`\r\n `]) {
    const diagnostic = errorFor(raw).diagnostic; assert.equal(diagnostic.category, 'json-syntax');
    if (diagnostic.category !== 'json-syntax') throw new Error('Unexpected fixture category');
    assert.equal(diagnostic.positionUnit, 'utf16-code-unit'); assert.equal(diagnostic.position, position);
    assert.equal(diagnostic.bodyOffset, raw.indexOf('{')); assert.equal(diagnostic.rawPosition, raw.indexOf('{') + position);
  }
  for (const raw of ['before ```json\n{}\n```', '```json\n{}\n``` after', '```javascript\n{}\n```', '```json\n{}', '{} trailing', '{} {}']) {
    assert.equal(errorFor(raw).diagnostic.category, 'json-syntax');
  }
  assert.deepEqual(parseVerifierDecisionText(` \n\`\`\`json\n${JSON.stringify(verdict())}\n\`\`\` \n`, ids), verdict());
});

test('Zod structure failures expose only bounded fixed issue codes and allowlisted host paths', () => {
  for (const value of [null, [], { ...verdict(), scores: 'wrong-type' }, { ...verdict(), selectedCandidateId: 4 },
    { ...verdict(), scores: [{ ...verdict().scores[0], score: '4' }, verdict().scores[1]] },
    { ...verdict(), scores: [{ ...verdict().scores[0], score: 3.5 }, verdict().scores[1]] },
    { ...verdict(), decision: 'override' }, { ...verdict(), extra: true }, { ...verdict(), reason: '' }]) {
    const diagnostic = invalid(value).diagnostic; assert.equal(diagnostic.category, 'zod-structure');
    if (diagnostic.category !== 'zod-structure') throw new Error('Unexpected fixture category');
    assert.ok(diagnostic.issueCount >= 1); assert.ok(diagnostic.issues.length <= 12);
    for (const issue of diagnostic.issues) {
      assert.ok(['invalid_type', 'invalid_value', 'too_small', 'too_big', 'unrecognized_keys', 'other'].includes(issue.code));
      assert.ok(['$', '$.decision', '$.selectedCandidateId', '$.scores', '$.scores[]', '$.scores[].candidateId', '$.scores[].score', '$.scores[].reason', '$.reason'].includes(issue.path));
    }
  }
  const missing = verdict() as Partial<ReturnType<typeof verdict>>; delete missing.selectedCandidateId;
  assert.equal(invalid(missing).diagnostic.category, 'zod-structure', 'Missing required selected-ID is structural, whereas explicit null is semantic');
  const many = invalid({ ...verdict(), scores: Array.from({ length: 100 }, () => ({})) }).diagnostic;
  assert.equal(many.category, 'zod-structure');
  if (many.category === 'zod-structure') { assert.equal(many.issues.length, 12); assert.equal(many.issuesTruncated, true); assert.ok(many.issueCount > 12); }
  assert.ok(Buffer.byteLength(JSON.stringify(many)) < 2000);
});

test('missing, duplicate and unknown score IDs are separate from selected-ID validity and retain no actual IDs', () => {
  const cases = [
    { value: { ...verdict(), scores: verdict().scores.slice(0, 1) }, missing: 1, unknown: 0, duplicate: 0 },
    { value: { ...verdict(), scores: [verdict().scores[0], verdict().scores[0]] }, missing: 1, unknown: 0, duplicate: 1 },
    { value: { ...verdict(), scores: [verdict().scores[0], { ...verdict().scores[1], candidateId: 'foreign-sensitive-id' }] }, missing: 1, unknown: 1, duplicate: 0 },
  ];
  for (const { value, missing, unknown, duplicate } of cases) {
    const error = invalid(value); const diagnostic = error.diagnostic; assert.equal(diagnostic.category, 'candidate-ids');
    if (diagnostic.category !== 'candidate-ids') throw new Error('Unexpected fixture category');
    assert.equal(diagnostic.missingCandidateCount, missing); assert.equal(diagnostic.unknownCandidateCount, unknown);
    assert.equal(diagnostic.duplicateCandidateCount, duplicate); assert.equal(diagnostic.expectedCandidateCount, 2);
    const serialized = JSON.stringify(error); assert.equal(serialized.includes('foreign-sensitive-id'), false);
    for (const id of ids) assert.equal(serialized.includes(id), false);
  }
  for (const [value, code] of [
    [{ ...verdict(), selectedCandidateId: null }, 'accept-without-selected-id'],
    [{ ...verdict(), selectedCandidateId: 'foreign-sensitive-selected-id' }, 'selected-id-not-scored'],
    [{ ...verdict(), decision: 'abstain' }, 'abstain-selects-candidate'],
  ] as const) {
    const error = invalid(value); assert.equal(error.diagnostic.category, 'selected-id'); assert.equal(error.diagnostic.code, code);
    assert.equal(JSON.stringify(error).includes('foreign-sensitive-selected-id'), false);
  }
});

test('minimum score and highest score have independent diagnostics with the original threshold and tie acceptance', () => {
  const low = verdict(); low.scores = low.scores.map(score => ({ ...score, score: 2 }));
  const lowDiagnostic = invalid(low).diagnostic; assert.equal(lowDiagnostic.category, 'minimum-score');
  if (lowDiagnostic.category === 'minimum-score') { assert.equal(lowDiagnostic.minimumScore, 3); assert.equal(lowDiagnostic.selectedScore, 2); }
  const lower = verdict(); lower.selectedCandidateId = ids[0];
  const higherDiagnostic = invalid(lower).diagnostic; assert.equal(higherDiagnostic.category, 'highest-score');
  if (higherDiagnostic.category === 'highest-score') { assert.equal(higherDiagnostic.selectedScore, 3); assert.equal(higherDiagnostic.highestScore, 4); }
  const tied = verdict(); tied.scores = tied.scores.map(score => ({ ...score, score: 3 }));
  assert.equal(parseVerifierDecisionText(JSON.stringify(tied), ids).decision, 'accept');
  const abstain = { ...low, decision: 'abstain', selectedCandidateId: null };
  assert.equal(parseVerifierDecisionText(JSON.stringify(abstain), ids).decision, 'abstain');
  assert.equal(parseVerifiedDecision(verdict(), ids).selectedCandidateId, ids[1]);
  assert.throws(() => parseVerifiedDecision(low, ids), VerifierDecisionError);
});

test('legitimate escaped strings and JSON delimiters inside reasons remain valid original decisions', () => {
  const value = verdict(); value.reason = 'toFixed(2)+" °F"/" °C"; path \\; line\n; 😀; {"reason":1,"reason":2}';
  value.scores[0].reason = 'quote " and escaped slash \\ and tab\t';
  const raw = JSON.stringify(value); const actual = parseVerifierDecisionText(raw, ids);
  assert.deepEqual(actual, value); assert.equal(actual.reason, value.reason);
});

test('strict Verifier wrapper rejects duplicate object keys and escaped aliases while universal parseJson stays unchanged', () => {
  const raw = JSON.stringify(verdict());
  for (const body of [raw.replace('"decision":"accept"', '"decision":"abstain","decision":"accept"'),
    raw.replace('"decision":"accept"', '"decision":"abstain","decisi\\u006fn":"accept"'),
    raw.replace('"score":3', '"score":2,"score":3'), '{"sensitive-duplicate-key":1,"sensitive-duplicate-key":2}',
    '{"__proto__":1,"__proto__":2}']) {
    assert.doesNotThrow(() => parseJson(body)); const error = errorFor(body); const diagnostic = error.diagnostic;
    assert.equal(diagnostic.category, 'json-syntax'); assert.equal(diagnostic.code, 'duplicate-json-key');
    assert.equal(JSON.stringify(error).includes('sensitive-duplicate-key'), false);
    if (diagnostic.category === 'json-syntax') assert.ok(diagnostic.position !== null);
  }
  const deep = `${'['.repeat(15999)}0${']'.repeat(15999)}`;
  assert.equal(errorFor(deep).diagnostic.category, 'zod-structure', 'Bounded scan does not recurse through supplied nesting');
});

test('raw parser input bound uses UTF8 bytes, rejects nonstrings, and never trims oversized input to pass', () => {
  const raw = JSON.stringify(verdict()); const boundary = raw + ' '.repeat(VERIFIER_RESPONSE_MAX_BYTES - Buffer.byteLength(raw));
  assert.equal(parseVerifierDecisionText(boundary, ids).decision, 'accept');
  const tooBig = errorFor(`${boundary} `).diagnostic;
  assert.equal(tooBig.category, 'response-bound'); assert.equal(tooBig.code, 'response-too-large');
  assert.equal(tooBig.source!.byteLength, 32001); assert.equal(tooBig.source!.sourceSha256, undefined);
  assert.equal(errorFor('😀'.repeat(8001)).diagnostic.category, 'response-bound');
  for (const value of [null, {}, 1, new String(raw)]) assert.equal(errorFor(value).diagnostic.code, 'invalid-response-type');
});

test('serialized diagnostic errors never expose provider text, arbitrary keys, ID values, reasons or parser messages', () => {
  const secret = 'sk-KeyLike_PrivateProviderText_91';
  const values = [
    `{"${secret}":"${secret} ${secret}"`,
    JSON.stringify({ ...verdict(), [secret]: { [secret]: secret }, reason: secret }),
    JSON.stringify({ ...verdict(), selectedCandidateId: secret, reason: secret }),
    JSON.stringify({ ...verdict(), reason: secret, scores: verdict().scores.map(score => ({ ...score, candidateId: secret, reason: secret })) }),
    `{"reason":"${secret} in JSON at position 91","scores":}`, `${secret}${' '.repeat(32001)}`,
  ];
  for (const raw of values) {
    const error = errorFor(raw); const serialized = JSON.stringify(error);
    assert.equal(serialized.includes(secret), false); assert.equal(String(error).includes(secret), false);
    assert.equal(error.stack!.includes(secret), false); assert.equal(serialized.includes('excerpt'), false);
    assert.ok(Buffer.byteLength(serialized) < 2400);
  }
});

test('study selection attaches precise safe diagnostics with one independent callback and no retry or synthetic decision', async () => {
  const requests = verifierPreparationRequests('H01'); let callbacks = 0;
  const selection = await selectVerifierStudy('llm', requests, {
    llm: async () => { callbacks++; return '{"secret-provider-key":"sk-FixtureText","scores":['; },
    jev: async () => { throw new Error('Unexpected Jev callback'); },
  }, new AbortController().signal);
  assert.equal(selection.version, VERIFIER_STUDY_STRATEGY_VERSION); assert.equal(selection.version, 'verifier-study-strategy-v2');
  assert.equal(selection.decision, 'error'); assert.equal(selection.failureCode, 'protocol'); assert.equal(selection.selectedCandidateId, null);
  assert.equal(selection.verifierDiagnostic!.category, 'json-syntax'); assert.match(selection.reason, /JSON syntax/);
  assert.equal(selection.llmDecision, undefined); assert.equal(callbacks, 1); assert.deepEqual(selection.callbackCounts, { llm: 1, jev: 0 });
  assert.equal(JSON.stringify(selection).includes('sk-FixtureText'), false);
});

test('original H04 public archive response replays as JSON syntax at UTF16 238 with its exact ledger hash and no repaired result', async () => {
  const { archiveBytes, inspection, events } = readVerifierReal01Evidence();
  assert.equal(inspection.terminalStatus, 'failed'); assert.equal(inspection.extracted, false); assert.equal(inspection.repaired, false);
  const archived = events.find(event => event.sequence === 42)!;
  assert.equal(archived.payload.poolId, 'H04'); assert.equal(archived.payload.strategy, 'llm');
  const raw = (archived.payload.responseSnapshot as { text: string }).text;
  const originalTextSha256 = 'a3db2e3e85211a67000dee4b2a3d96e1968b4ac6ec9a871a61c4aa27c437b170';
  assert.equal(sha(raw), originalTextSha256);
  const requests = verifierPreparationRequests('H04'); let callbacks = 0;
  const selection = await selectVerifierStudy('llm', requests, {
    llm: async () => { callbacks++; return raw; }, jev: async () => { throw new Error('Unexpected H04 fixture callback'); },
  }, new AbortController().signal);
  assert.equal(selection.decision, 'error'); assert.equal(selection.failureCode, 'protocol'); assert.equal(selection.selectedCandidateId, null);
  assert.equal(selection.llmDecision, undefined); assert.equal(callbacks, 1); assert.deepEqual(selection.callbackCounts, { llm: 1, jev: 0 });
  const diagnostic = selection.verifierDiagnostic!; assert.equal(diagnostic.category, 'json-syntax');
  if (diagnostic.category !== 'json-syntax') throw new Error('Unexpected H04 diagnostic');
  assert.equal(diagnostic.position, 238); assert.equal(diagnostic.rawPosition, 238); assert.equal(diagnostic.positionUnit, 'utf16-code-unit');
  assert.equal(diagnostic.source!.sourceSha256, originalTextSha256); assert.equal('excerpt' in diagnostic, false);
  assert.equal(sha(archiveBytes), VERIFIER_REAL01_ARCHIVE_SHA256);
  assert.equal(events.at(-1)!.payload.status, 'failed');
});
