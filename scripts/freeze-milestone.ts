import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { SurveyRun } from '../shared/survey-engine';
import type { Run } from '../server/types';

// Package retained experiments only. This script never accesses keys or calls a model.
const root = path.resolve('public/submission');
const load = <T>(name: string) => JSON.parse(readFileSync(path.join(root, name), 'utf8')) as T;
const milestone = load<{ id: string; cutoffAt: string; freezeTag: string; validatedSourceCommit: string }>('milestone.json');
const live = load<SurveyRun>('live-run.json');
const experiments = load<{ arm: string; run: SurveyRun }[]>('experiment-runs.json');
const delivery = load<Run[]>('delivery-attempts.json');
const evaluation = load<{ realModelRequests: number; inputTokens: number; outputTokens: number }>('evaluation-summary.json');
const cutoff = Date.parse(milestone.cutoffAt);
assert.ok(Number.isFinite(cutoff));
assert.equal(live.mode, 'live'); assert.equal(live.task.questionnaire.questions.length, 15);
assert.equal(live.metrics.planned, 12); assert.equal(live.metrics.valid, 12);
assert.equal(experiments.reduce((sum, { run }) => sum + run.metrics.modelCalls, 0), 49);
assert.equal(experiments.reduce((sum, { run }) => sum + run.metrics.valid, 0), 44);
assert.equal(evaluation.realModelRequests, 49); assert.equal(evaluation.inputTokens, 84916); assert.equal(evaluation.outputTokens, 13120);
assert.equal(delivery.length, 6); assert.equal(delivery.filter(run => run.status === 'completed' && run.gate?.passed).length, 0);
for (const { run } of experiments) {
  assert.equal(run.mode, 'live');
  const measuredEnd = Date.parse(run.startedAt) + run.durationMs;
  assert.ok(Number.isFinite(measuredEnd) && measuredEnd <= cutoff, `实验超出截止时点:${run.id}`);
}
for (const run of delivery) assert.ok(run.finishedAt && Date.parse(run.finishedAt) <= cutoff, `交付超出截止时点:${run.id}`);
const videoSeconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(root, 'demo.mp4')], { encoding: 'utf8' }).trim());
assert.equal(videoSeconds, 254); assert.ok(videoSeconds >= 180 && videoSeconds <= 300);
const info = execFileSync('pdfinfo', [path.join(root, 'project-materials.pdf')], { encoding: 'utf8' });
assert.match(info, /Pages:\s+8\b/);
function files(directory: string, prefix = ''): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name), prefix + entry.name + '/') : [prefix + entry.name]);
}
const manifest = files(root).filter(name => name !== 'milestone-files.json').sort().map(name => {
  const bytes = readFileSync(path.join(root, name));
  return { path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
});
writeFileSync(path.join(root, 'milestone-files.json'), JSON.stringify({ id: milestone.id, cutoffAt: milestone.cutoffAt,
  validatedSourceCommit: milestone.validatedSourceCommit, freezeTag: milestone.freezeTag, packagedAt: new Date().toISOString(),
  note: '本清单不含自身；SHA-256核验字节版本，不构成数字签名或效度认证。Tag与GitHub Release保存同版材料。', files: manifest }, null, 2));
const output = path.resolve('output/milestones'); mkdirSync(output, { recursive: true });
const archive = path.join(output, `${milestone.id}.zip`);
execFileSync('zip', ['-q', '-r', archive, 'submission'], { cwd: path.resolve('public') });
console.log(JSON.stringify({ id: milestone.id, files: manifest.length + 1, pdfPages: 8, videoSeconds, archive, modelCallsAdded: 0 }));
