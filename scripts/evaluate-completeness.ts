import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluateCompleteness } from '../shared/research-evaluation';

const args = process.argv.slice(2);
if (args.length !== 3) throw new Error('用法：npx tsx scripts/evaluate-completeness.ts <预登记计划.json> <运行证据.json> <新报告.json>；纯离线，不调用模型。');
const [planName, evidenceName, outputName] = args.map(value => path.resolve(value));
if (outputName === planName || outputName === evidenceName) throw new Error('输出不能覆盖原计划或运行证据。');
const [plan, evidence] = await Promise.all([readFile(planName, 'utf8'), readFile(evidenceName, 'utf8')]);
if (Buffer.byteLength(plan) > 1024 * 1024 || Buffer.byteLength(evidence) > 50 * 1024 * 1024) throw new Error('离线输入超过安全限额。');
const result = evaluateCompleteness(JSON.parse(plan), JSON.parse(evidence));
await mkdir(path.dirname(outputName), { recursive: true });
await writeFile(outputName, JSON.stringify(result, null, 2), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ status: result.status, counts: result.counts, realThirtyResidentGate: result.realThirtyResidentGate, report: outputName, modelCallsThisCommand: 0 }));
