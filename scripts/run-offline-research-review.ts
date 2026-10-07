import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAnswerContract, decodeAnswerContract, encodeAnswerContract } from '../shared/answer-contract';
import { fingerprint } from '../shared/evidence';
import { diagnoseBusinessResearchRun } from '../shared/research-diagnostics';
import type { QuestionnaireLogicRule } from '../shared/questionnaire-logic';
import type { SurveyRun } from '../shared/survey-engine';
import { verifyHistoricalEvidence } from '../server/research/historical-integrity';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (args.some(arg => arg !== '--local-full') || new Set(args).size !== args.length) throw new Error('用法：npm run review:offline [-- --local-full]；无Key、预算或网络参数。');
const scope = args.includes('--local-full') ? 'local-full' : 'repository';
const startedAt = new Date().toISOString(); const start = performance.now();
const sourceNames = ['scripts/run-offline-research-review.ts', 'shared/answer-contract.ts', 'shared/research-diagnostics.ts',
  'shared/survey-engine.ts', 'shared/questionnaire-logic.ts', 'shared/research-schema.ts', 'shared/research-demo.ts',
  'server/research/historical-integrity.ts', 'server/research/provider-usage-witness.ts', 'server/research/single-request-relay.ts', 'server/research/bounded-harness.ts',
  'server/research/structured-capability.ts', 'server/research/structured-harness-adapter.ts', 'server/research/structured-harness-adapter-plugin.mjs'];
const captureSources = () => Promise.all(sourceNames.map(async name => ({ name, sha256: createHash('sha256').update(await readFile(path.join(root, name))).digest('hex') })));
const sources = await captureSources();
const before = await verifyHistoricalEvidence(root, scope);
const readJson = async <T>(name: string) => JSON.parse(await readFile(path.join(root, name), 'utf8')) as T;
const cases = [];
const contracts = [];
for (const scenarioId of ['child-snacks', 'pet-snacks'] as const) {
  for (const group of ['fixture', 'historical-1.0', ...(scope === 'local-full' ? ['historical-1.1'] : [])]) {
    const folder = group === 'fixture' ? `public/submission-next/business-proof/${scenarioId}` : group === 'historical-1.0'
      ? `public/submission-next/live-proof/${scenarioId}` : `output/live-proof/f736fda5-2b12-4918-b843-1421e1c76454/${scenarioId}`;
    const run = await readJson<SurveyRun>(`${folder}/survey-run.json`);
    const oldRules = await readJson<{ rules: QuestionnaireLogicRule[] }>(`${folder}/logic-audit.json`);
    cases.push({ evidenceGroup: group, source: `${folder}/survey-run.json`, historicalMetricsUnchanged: structuredClone(run.metrics),
      diagnostic: diagnoseBusinessResearchRun(run, { scenarioId, logicRules: oldRules.rules }) });
    if (group !== 'fixture') continue;
    for (const response of run.responses) {
      const contract = compileAnswerContract(run.task, response.residentId, oldRules.rules);
      const convertedFixture = encodeAnswerContract(response.residentId, response.answers);
      if (fingerprint(decodeAnswerContract(contract, convertedFixture)) !== fingerprint(response.answers)) throw new Error('新契约夹具无损回放失败。');
      contracts.push({ scenarioId, sourceRunId: run.id, residentId: response.residentId, version: contract.version,
        taskHash: contract.taskHash, rulesHash: contract.rulesHash, schemaHash: contract.schemaHash, schema: contract.schema,
        fixtureConversion: { source: `${folder}/survey-run.json`, originalRawSha256: createHash('sha256').update(response.raw).digest('hex'),
          convertedRaw: convertedFixture, meaning: 'explicit-fixture-projection-not-provider-response', modelCalls: 0 } });
    }
  }
}
if (contracts.length !== 24) throw new Error('完整业务夹具必须逐份回放24个新契约。');
const after = await verifyHistoricalEvidence(root, scope);
if (fingerprint(before) !== fingerprint(after)) throw new Error('历史文件在离线审计期间漂移。');
if (fingerprint(sources) !== fingerprint(await captureSources())) throw new Error('离线审计期间源码漂移；本次结果不导出。');
const durationMs = performance.now() - start;
const report = { version: 'offline-research-review-1.0', startedAt, endedAt: new Date().toISOString(), durationMs,
  timingBasis: '包含固定历史校验、只读诊断、24份schema编译和无损回放、结束校验；不含以下文件导出，不覆盖旧运行时长。',
  providerRequests: 0, inputTokens: 0, outputTokens: 0, apiCostCny: 0,
  historicalIntegrity: { scope, beforeHash: fingerprint(before), afterHash: fingerprint(after), verifiedCount: after.verifiedCount, matched: true },
  compiledFixtureContracts: contracts.length, cases,
  source: { node: process.versions.node, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), files: sources, fileHashAlgorithm: 'sha256-file-bytes' },
  realProviderSchemaSupport: 'not-tested', structuredAnswerProductionRouteChanged: false, marketResearchValidated: false,
  scope: '离线shadow诊断及新契约夹具投影，独立导出；不会修历史答卷、评分、账本，也不请求模型或认证真实市场。' };
const parent = path.join(root, 'output/offline-review'); await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, 'review-'));
await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
await writeFile(path.join(directory, 'historical-integrity.json'), JSON.stringify(after, null, 2) + '\n', { flag: 'wx' });
await writeFile(path.join(directory, 'fixture-answer-contracts.json'), JSON.stringify(contracts, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ directory, verifiedHistoricalFiles: after.verifiedCount, compiledFixtureContracts: contracts.length, providerRequests: 0, durationMs,
  cases: cases.map(item => ({ group: item.evidenceGroup, scenarioId: item.diagnostic.scenarioId, planned: item.diagnostic.planned, summary: item.diagnostic.summary })) }, null, 2));
