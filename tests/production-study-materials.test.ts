import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assertStudyMaterialPublic, VERIFIER_REAL02_ARCHIVE_SHA256, VERIFIER_REAL02_MATERIAL_FILES, verifyVerifierReal02Materials } from '../scripts/production-study-materials.js';
import { reviewerInstallCommands, REVIEWER_CAMERA_PREPARATION_COMMANDS } from '../scripts/production-install.js';
const evidence = () => new Map(VERIFIER_REAL02_MATERIAL_FILES.map(name => [name, readFileSync(new URL('../docs/production/experiments/' + name, import.meta.url))]));

test('v6 actual pinned public REAL02 archive derives every metric from blind selections and actual Oracle without modifying originals', () => {
  const files = evidence(), before = [...files].map(([name, bytes]) => [name, Buffer.from(bytes)] as const);
  const summary = verifyVerifierReal02Materials(files);
  assert.equal(summary.archiveSha256, VERIFIER_REAL02_ARCHIVE_SHA256);
  assert.deepEqual(summary.totals, { calls: 52, inputTokens: 342986, outputTokens: 8557, estimatedCostUsd: .077296446 });
  assert.equal(summary.blindDecisionCount, 54); assert.equal(summary.oracleCandidateCount, 36); assert.equal(summary.events, 286);
  assert.ok(summary.lastDecisionEvent < summary.firstOracleIntentEvent);
  assert.equal(summary.arithmeticDriftUpgrades, 12); assert.equal(summary.uncertainUpgrades, 4);
  assert.equal(summary.byStrategy[2].falseAbstentions, 1); assert.equal(summary.valueVerdict.highValue, false);
  assert.equal(summary.byStrategy[2].goodSelected, 11); assert.equal(summary.byStrategy[1].goodSelected, 12);
  assert.equal(summary.currentPolicyExperimented, false); assert.equal(summary.recordedJevPolicy, 'jev-candidate-v3');
  for (const [name, bytes] of before) assert.ok(files.get(name)!.equals(bytes));
});

test('missing files, changed archive pin or independent control confirmation cannot become published evidence', () => {
  const missing = evidence(); missing.delete('VERIFIER-REAL-02/control/terminal.confirmed.json'); assert.throws(() => verifyVerifierReal02Materials(missing));
  const changed = evidence(); const bytes = Buffer.from(changed.get('VERIFIER-REAL-02/run-ledger.tar.gz')!); bytes[bytes.length - 1] ^= 1; changed.set('VERIFIER-REAL-02/run-ledger.tar.gz', bytes); assert.throws(() => verifyVerifierReal02Materials(changed), /archive-sha256-mismatch/);
  const control = evidence(); const name = 'VERIFIER-REAL-02/control/terminal.confirmed.json'; const value = JSON.parse(control.get(name)!.toString()); value.terminalSha256 = '0'.repeat(64); control.set(name, Buffer.from(JSON.stringify(value))); assert.throws(() => verifyVerifierReal02Materials(control));
});

test('pre-filled highValue, fabricated Oracle label, cost and false-abstention totals never override actual events', () => {
  for (const change of [(value: any) => value.valueVerdict.highValue = true, (value: any) => value.pools[0].candidates[0].passed = false, (value: any) => value.byStrategy[2].falseAbstentions = 0, (value: any) => value.totals.estimatedCostUsd = 0, (value: any) => value.valueVerdict.costDeltaPercent += .001]) {
    const files = evidence(), name = 'VERIFIER-REAL-02/metrics.json', value = JSON.parse(files.get(name)!.toString()); change(value); files.set(name, Buffer.from(JSON.stringify(value))); assert.throws(() => verifyVerifierReal02Materials(files), /pinned actual ledger/);
  }
});

test('validated archive member secrecy scan covers decoded values/keys, private paths and malformed JSON with fixed errors', () => {
  for (const input of ['{"nested":{"api\\u004bey":"synthetic-sensitive-fixture"}}', '{"echo":"sk-\\u0061' + 'a'.repeat(25) + '"}', '{"echo":"Bearer synthetic-sensitive-fixture"}', '{"echo":"/Users/example/private/file"}', '{"echo":".city-agent-production/production/state.json"}', '{"synthetic-sensitive-fixture":']) {
    assert.throws(() => assertStudyMaterialPublic(Buffer.from(input), 'member.json'), error => error instanceof Error && !error.message.includes('synthetic-sensitive-fixture') && error.message.includes('pinned actual ledger'));
  }
  assert.doesNotThrow(() => assertStudyMaterialPublic(Buffer.from('{"hasApiKey":true,"apiKey":null}'), 'member.json'));
});

test('one manual software installation block requires full immutable commit and excludes optional camera download commands', () => {
  const commit = 'a'.repeat(40), commands = reviewerInstallCommands(commit);
  assert.ok(commands.includes(`git checkout --detach ${commit}`));
  assert.ok(commands.startsWith('(\nset -eu\n')); assert.ok(commands.includes('npm ci --engine-strict'));
  for (const value of ['main', 'a'.repeat(7), 'A'.repeat(40), commit + '\nmalicious']) assert.throws(() => reviewerInstallCommands(value));
  assert.equal(commands.includes('prepare-camera-assets'), false); assert.equal(commands.includes('Node.js'), false);
  assert.ok(REVIEWER_CAMERA_PREPARATION_COMMANDS.includes('--verify'));
});
test('manual installation is shell-valid and clone/checkout failure stops before npm or any service command', () => {
  const commands = reviewerInstallCommands('a'.repeat(40));
  assert.equal(spawnSync('/bin/bash', ['-n', '-c', commands], { cwd: process.cwd(), env: { PATH: '/usr/bin:/bin' } }).status, 0);
  for (const setup of ['git() { echo CLONE_FAILED; return 1; }; cd() { echo MUST_NOT_CD; }; npm() { echo MUST_NOT_NPM; }; npx() { echo MUST_NOT_NPX; }', 'git() { if [ "$1" = clone ]; then echo CLONE_OK; return 0; fi; echo CHECKOUT_FAILED; return 1; }; cd() { return 0; }; npm() { echo MUST_NOT_NPM; }; npx() { echo MUST_NOT_NPX; }']) {
    const result = spawnSync('/bin/bash', ['-c', setup + '\n' + commands], { cwd: process.cwd(), env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout.includes('MUST_NOT'), false);
  }
});
