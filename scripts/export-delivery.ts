import { mkdirSync, writeFileSync } from 'node:fs';
import type { Run } from '../server/types';
const base = 'http://127.0.0.1:4310/api';
const id = process.argv[2]; if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('请传入确切运行ID。');
const response = await fetch(`${base}/runs/${id}`); if (!response.ok) throw new Error('运行不存在');
const run = await response.json() as Run;
if (['queued', 'running'].includes(run.status)) throw new Error('先等待运行结束。');
if (JSON.stringify(run).includes('"apiKey"')) throw new Error('拒绝包含凭证字段的记录。');
mkdirSync('public/submission', { recursive: true });
writeFileSync('public/submission/delivery-run.json', JSON.stringify(run, null, 2));
for (const [source, target] of [['manifest.json', 'delivery-manifest.json'], ['acceptance.json', 'delivery-acceptance.json'], ['gate.json', 'delivery-gate.json'], ['index.html', 'delivery-source.txt']] as const) {
  if (!run.artifacts.some(artifact => artifact.name === source)) continue;
  const result = await fetch(`${base}/runs/${id}/artifacts/${source}`); if (!result.ok) throw new Error(`产物读取失败:${source}`);
  writeFileSync(`public/submission/${target}`, await result.text());
}
const all = await (await fetch(`${base}/runs`)).json() as Run[];
const attempts = all.filter(value => value.input.researchSurveyId && !['queued', 'running'].includes(value.status));
writeFileSync('public/submission/delivery-attempts.json', JSON.stringify(attempts, null, 2));
console.log(JSON.stringify({ id, status: run.status, gate: run.gate?.passed, attempts: attempts.length }));
