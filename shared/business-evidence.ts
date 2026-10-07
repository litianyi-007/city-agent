import { z } from 'zod';
import { fingerprint, HASH_ALGORITHM } from './evidence.ts';

const id = z.string().trim().min(1).max(160);
const text = z.string().trim().min(1).max(2000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, '日期须为有效的 YYYY-MM-DD');
const nullableDay = day.nullable();
const number = z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable();
const geographyLevel = z.enum(['district', 'street', 'catchment', 'site']);
const verificationStatus = z.enum(['pending', 'verified', 'conflict']);
const geographySchema = z.object({
  regionCode: id, level: geographyLevel, code: id, name: text, boundaryVintage: id,
}).strict();
const derivationSchema = z.object({
  method: text, methodVersion: id, inputObservationIds: z.array(id).min(1).max(100),
}).strict();

export const businessEvidencePackSchema = z.object({
  schemaVersion: z.literal('1.0'), id, version: id, createdAt: nullableDay,
  region: z.object({ code: id, name: text, boundaryVintage: id }).strict(),
  period: z.object({ start: nullableDay, end: nullableDay }).strict(),
  sources: z.array(z.object({
    id, title: text, publisher: text,
    provenance: z.enum(['official-statistics', 'business-export', 'field-observation', 'synthetic-fixture', 'other']),
    url: z.url({ protocol: /^https?$/ }).nullable(), exportOwner: text.nullable(),
    publishedAt: nullableDay, retrievedAt: nullableDay,
    coveredRegionCodes: z.array(id).max(100), periodStart: nullableDay, periodEnd: nullableDay,
    snapshot: z.object({
      sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
      bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), mediaType: id.nullable(),
    }).strict(),
    license: text.nullable(), shareScope: z.enum(['public', 'internal', 'restricted', 'private']).nullable(),
    verificationStatus,
    verificationRecord: z.object({ reviewer: id, reviewedAt: day, note: text }).strict().nullable(),
    useLimit: text,
  }).strict()).max(100),
  observations: z.array(z.object({
    id, metric: id, value: number, unit: id, populationBasis: text,
    geography: geographySchema, periodStart: nullableDay, periodEnd: nullableDay,
    sourceId: id, locator: text, provenance: z.enum(['fact', 'infer', 'assumption', 'generated']),
    verificationStatus, missingReason: text.nullable(), useLimit: text,
    denominatorObservationId: id.nullable(), derivation: derivationSchema.nullable(),
    modelEvidence: z.object({ provider: id, modelId: id, promptHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().nullable(),
  }).strict()).max(1000),
  claims: z.array(z.object({
    id, text, kind: z.enum(['observation-summary', 'hypothesis']),
    observationIds: z.array(id).min(1).max(100), metric: id, value: number, unit: id, populationBasis: text,
    geography: geographySchema, periodStart: nullableDay, periodEnd: nullableDay,
    provenance: z.enum(['fact', 'infer', 'assumption', 'generated']), useLimit: text,
  }).strict()).max(100),
  limitations: z.array(text).min(1).max(100),
}).strict();

/** The caller freezes metric names and units; there are no school/pet-specific branches. */
export const businessEvidenceRequirementsSchema = z.object({
  schemaVersion: z.literal('1.0'), regionCode: id, boundaryVintage: id,
  periodStart: day, periodEnd: day, asOf: day,
  maxAgeDays: z.number().int().min(0).max(36500).nullable(),
  requiredMetrics: z.array(z.object({
    metric: id, unit: id, populationBasis: text, geographyLevel,
    geographyCode: id.nullable(), requiresDenominator: z.boolean(),
    denominatorUnit: id.nullable(), denominatorPopulationBasis: text.nullable(),
  }).strict()).min(1).max(100),
}).strict();

export type BusinessEvidencePack = z.infer<typeof businessEvidencePackSchema>;
export type BusinessEvidenceRequirements = z.infer<typeof businessEvidenceRequirementsSchema>;
type Observation = BusinessEvidencePack['observations'][number];
export interface BusinessEvidenceCheck {
  id: string; name: string; severity: 'invalid' | 'conflict' | 'needs-data' | 'info'; passed: boolean;
  detail: string; observationIds: string[]; sourceIds: string[]; claimIds: string[];
}
export interface BusinessEvidenceAudit {
  schemaVersion: '1.0'; status: 'ready-for-review' | 'needs-data' | 'conflict' | 'invalid';
  packId: string | null; packVersion: string | null;
  hashAlgorithm: typeof HASH_ALGORITHM; packHash: string | null; requirementsHash: string | null; auditHash: string;
  checks: BusinessEvidenceCheck[]; gaps: string[]; limitations: string[];
  manualSourceVerificationNeeded: true; automaticRecommendationsAllowed: false; populationPublicationAllowed: false;
  requirementsProvided: boolean; claimedVerifiedSourceIds: string[];
}

const SCOPE = '只预检用户登记的结构、口径和引用；不访问URL或包内路径，不验证原件字节、发布者、授权或摘录真实性。fact/verified是提交者声明，哈希不是来源认证。';
const STOP = '本批只是现实桥的前置契约，尚未绑定外部真实世界；不生成经营推荐、不激活人口包、不计算总体权重或外推销量。';

/** Intentionally uncollected. These placeholders never certify a real region or source. */
export function createBusinessEvidenceTemplate(): BusinessEvidencePack {
  return {
    schemaVersion: '1.0', id: 'new-business-evidence', version: 'draft-1', createdAt: null,
    region: { code: 'new-region', name: '待核验区域', boundaryVintage: 'unverified-boundary' },
    period: { start: null, end: null },
    sources: [{
      id: 'uncollected-source', title: '尚未采集的来源', publisher: '待登记', provenance: 'other',
      url: null, exportOwner: null, publishedAt: null, retrievedAt: null,
      coveredRegionCodes: ['new-region'], periodStart: null, periodEnd: null,
      snapshot: { sha256: null, bytes: null, mediaType: null }, license: null, shareScope: null,
      verificationStatus: 'pending', verificationRecord: null, useLimit: '尚未采集，不支持任何经营结论。',
    }],
    observations: [{
      id: 'uncollected-observation', metric: 'requiredMetric', value: null, unit: '待明确单位',
      populationBasis: '待明确目标人群、去重与覆盖口径',
      geography: { regionCode: 'new-region', level: 'district', code: 'new-region', name: '待核验区域', boundaryVintage: 'unverified-boundary' },
      periodStart: null, periodEnd: null, sourceId: 'uncollected-source', locator: '待采集并登记原表或导出字段',
      provenance: 'assumption', verificationStatus: 'pending', missingReason: '尚未采集',
      useLimit: '仅为录入占位，不当人口或业务事实；不得把null替换为0。',
      denominatorObservationId: null, derivation: null, modelEvidence: null,
    }],
    claims: [], limitations: ['空模板，不含现实观测。需独立来源核验、授权审查和任务证据要求。'],
  };
}

function sameGeography(a: z.infer<typeof geographySchema>, b: z.infer<typeof geographySchema>) {
  return a.regionCode === b.regionCode && a.boundaryVintage === b.boundaryVintage && a.level === b.level && a.code === b.code;
}
function sameScope(a: Observation, b: Observation) {
  return sameGeography(a.geography, b.geography) && a.periodStart === b.periodStart && a.periodEnd === b.periodEnd;
}
function reversed(start: string | null, end: string | null) { return start !== null && end !== null && start > end; }

/** Pure, bounded JSON preflight. Dates are caller-supplied, so repeated audits are reproducible. */
export function validateBusinessEvidence(input: unknown, requirements?: unknown): BusinessEvidenceAudit {
  const checks: BusinessEvidenceCheck[] = [];
  const add = (id: string, name: string, passed: boolean, severity: BusinessEvidenceCheck['severity'], detail: string,
    references: Partial<Pick<BusinessEvidenceCheck, 'observationIds' | 'sourceIds' | 'claimIds'>> = {}) => {
    checks.push({ id, name, passed, severity, detail, observationIds: [], sourceIds: [], claimIds: [], ...references });
  };
  const parsed = businessEvidencePackSchema.safeParse(input);
  const requested = requirements === undefined ? undefined : businessEvidenceRequirementsSchema.safeParse(requirements);
  const pack = parsed.success ? parsed.data : null;
  const target = requested?.success ? requested.data : null;
  const finish = (): BusinessEvidenceAudit => {
    const failed = checks.filter(check => !check.passed);
    const status: BusinessEvidenceAudit['status'] = failed.some(check => check.severity === 'invalid') ? 'invalid'
      : failed.some(check => check.severity === 'conflict') ? 'conflict'
        : failed.some(check => check.severity === 'needs-data') ? 'needs-data' : 'ready-for-review';
    const body: Omit<BusinessEvidenceAudit, 'auditHash'> = {
      schemaVersion: '1.0' as const, status, packId: pack?.id ?? null, packVersion: pack?.version ?? null,
      hashAlgorithm: HASH_ALGORITHM, packHash: pack ? fingerprint(pack) : null,
      requirementsHash: target ? fingerprint(target) : null,
      checks, gaps: failed.map(check => check.detail), limitations: [...(pack?.limitations ?? []), SCOPE, STOP],
      manualSourceVerificationNeeded: true as const, automaticRecommendationsAllowed: false as const,
      populationPublicationAllowed: false as const, requirementsProvided: requirements !== undefined,
      claimedVerifiedSourceIds: pack?.sources.filter(source => source.verificationStatus === 'verified').map(source => source.id) ?? [],
    };
    return { ...body, auditHash: fingerprint(body) };
  };
  add('schema', '业务观测包结构', parsed.success, 'invalid', parsed.success ? '严格版本、字段与类型校验通过。'
    : parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'));
  if (requested) add('requirements-schema', '任务证据要求结构', requested.success, 'invalid', requested.success
    ? '任务要求已显式提供。' : requested.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；'));
  if (!pack || requested && !requested.success) return finish();

  const unique = (values: string[], label: string) => {
    const duplicates = [...new Set(values.filter((value, index) => values.indexOf(value) !== index))];
    add(`unique-${label}`, `${label}标识唯一`, !duplicates.length, 'invalid', duplicates.length ? `重复${label}：${duplicates.join('、')}` : `${label}无重复。`);
  };
  unique(pack.sources.map(row => row.id), 'sources');
  unique(pack.observations.map(row => row.id), 'observations');
  unique(pack.claims.map(row => row.id), 'claims');
  const sources = new Map(pack.sources.map(row => [row.id, row]));
  const observations = new Map(pack.observations.map(row => [row.id, row]));
  add('pack-period', '包统计区间', !reversed(pack.period.start, pack.period.end), 'conflict', '包统计开始日期不得晚于结束日期。');
  add('pack-dates', '包时点已录入', pack.createdAt !== null && pack.period.start !== null && pack.period.end !== null,
    'needs-data', '录入创建日及完整统计区间；缺日期不能视为当前数据。');
  add('evidence-present', '来源及观测已录入', !!pack.sources.length && !!pack.observations.length, 'needs-data', '至少需要一份来源和一条观测；空模板保持未采集。');

  for (const source of pack.sources) {
    const refs = { sourceIds: [source.id] };
    unique(source.coveredRegionCodes, `source-regions-${source.id}`);
    add(`source-origin-${source.id}`, '来源登记链', !!source.url || !!source.exportOwner, 'needs-data', `来源 ${source.id} 需原URL或合法业务导出责任人。`, refs);
    add(`source-snapshot-${source.id}`, '原件指纹登记', source.snapshot.sha256 !== null && source.snapshot.bytes !== null && source.snapshot.mediaType !== null,
      'needs-data', `来源 ${source.id} 需原件SHA-256、字节数和媒体类型；本预检不会读取原件验证。`, refs);
    add(`source-rights-${source.id}`, '授权及分享范围', source.license !== null && source.shareScope !== null,
      'needs-data', `来源 ${source.id} 需授权说明及分享范围；private/internal不能默认公开发布。`, refs);
    add(`source-date-${source.id}`, '来源采集与覆盖期', source.retrievedAt !== null && source.periodStart !== null && source.periodEnd !== null,
      'needs-data', `来源 ${source.id} 缺采集日或统计覆盖期。`, refs);
    add(`source-order-${source.id}`, '来源日期顺序', !reversed(source.periodStart, source.periodEnd)
      && !(source.publishedAt && source.retrievedAt && source.publishedAt > source.retrievedAt)
      && !(source.periodEnd && source.retrievedAt && source.periodEnd > source.retrievedAt)
      && !(source.verificationRecord && source.retrievedAt && source.verificationRecord.reviewedAt < source.retrievedAt),
    'conflict', `来源 ${source.id} 统计日期或发布日期/采集日顺序冲突。`, refs);
    add(`source-verification-${source.id}`, '来源核验声明', source.verificationStatus !== 'conflict', 'conflict', `来源 ${source.id} 标记存在冲突。`, refs);
    add(`source-review-${source.id}`, '人工核验记录', source.verificationStatus === 'verified' && source.verificationRecord !== null,
      'needs-data', `来源 ${source.id} 尚待人工核验或缺核验记录；填verified不会自动认证。`, refs);
  }

  const cells = new Map<string, Observation[]>();
  for (const row of pack.observations) {
    const refs = { observationIds: [row.id], sourceIds: [row.sourceId] };
    const source = sources.get(row.sourceId);
    add(`observation-source-${row.id}`, '观测来源引用', !!source, 'invalid', `观测 ${row.id} 的来源 ${row.sourceId} 必须存在。`, refs);
    add(`observation-region-${row.id}`, '观测地域及边界', row.geography.regionCode === pack.region.code && row.geography.boundaryVintage === pack.region.boundaryVintage,
      'conflict', `观测 ${row.id} 必须与包地域和边界版本一致，边界变化不能静默映射。`, refs);
    add(`observation-period-${row.id}`, '观测统计区间', !reversed(row.periodStart, row.periodEnd)
      && row.periodStart === pack.period.start && row.periodEnd === pack.period.end,
    'conflict', `观测 ${row.id} 与包区间不一致；不同期间保留为不同包，不能混算。`, refs);
    add(`observation-dates-${row.id}`, '观测时点完整', row.periodStart !== null && row.periodEnd !== null,
      'needs-data', `观测 ${row.id} 未完整登记统计期间。`, refs);
    add(`observation-value-${row.id}`, '观测非空', row.value !== null, 'needs-data', `观测 ${row.id} 未采集：${row.missingReason ?? '缺少missingReason'}；null不填0。`, refs);
    add(`observation-missing-${row.id}`, '缺失原因', row.value !== null || row.missingReason !== null, 'needs-data', `观测 ${row.id} 的null须注明未采集原因。`, refs);
    add(`observation-conflict-${row.id}`, '观测冲突声明', row.verificationStatus !== 'conflict', 'conflict', `观测 ${row.id} 标记存在冲突。`, refs);
    add(`observation-review-${row.id}`, '观测用途核验', row.verificationStatus === 'verified' && row.provenance === 'fact',
      'needs-data', `观测 ${row.id} 仍为待核验、推断或生成资料；不作为已验证经营事实。`, refs);
    if (source) {
      add(`source-region-${row.id}`, '来源覆盖地域', source.coveredRegionCodes.includes(row.geography.regionCode),
        'conflict', `来源 ${source.id} 未登记覆盖观测 ${row.id} 的地域。`, refs);
      add(`source-period-${row.id}`, '来源覆盖期间', !(source.periodStart && row.periodStart && row.periodStart < source.periodStart)
        && !(source.periodEnd && row.periodEnd && row.periodEnd > source.periodEnd),
      'conflict', `观测 ${row.id} 不在来源 ${source.id} 的统计覆盖期间。`, refs);
      add(`source-synthetic-${row.id}`, '合成夹具不可认证事实', source.provenance !== 'synthetic-fixture', 'needs-data', `观测 ${row.id} 来自synthetic-fixture，不可作为现实业务事实。`, refs);
    }
    if (row.provenance === 'infer') add(`derivation-present-${row.id}`, '推断方法可追溯', row.derivation !== null,
      'needs-data', `推断观测 ${row.id} 需方法版本与输入观测ID。`, refs);
    if (row.provenance === 'generated') add(`model-present-${row.id}`, '生成观测可追溯', row.modelEvidence !== null,
      'needs-data', `生成观测 ${row.id} 需模型配置及Prompt哈希，不能声明真实偏好。`, refs);
    if (row.derivation) {
      unique(row.derivation.inputObservationIds, `derivation-${row.id}`);
      const inputs = row.derivation.inputObservationIds.map(id => observations.get(id));
      add(`derivation-inputs-${row.id}`, '推断输入引用', inputs.every(input => input && input.id !== row.id),
        'invalid', `观测 ${row.id} 的推断引用须存在且不可自引。`, refs);
      add(`derivation-scope-${row.id}`, '推断输入统计范围', inputs.every(input => !input || sameScope(input, row)),
        'conflict', `推断观测 ${row.id} 不可跨地域、边界或期间合并。`, refs);
    }
    if (row.denominatorObservationId !== null) {
      const denominator = observations.get(row.denominatorObservationId);
      add(`denominator-reference-${row.id}`, '目标分母引用', !!denominator && denominator.id !== row.id, 'invalid', `观测 ${row.id} 的分母须存在且不可引用自身。`, refs);
      if (denominator) {
        add(`denominator-scope-${row.id}`, '分母地域与期间', sameScope(row, denominator), 'conflict', `观测 ${row.id} 的分母须同地域、地理粒度、边界及期间。`, refs);
        add(`denominator-value-${row.id}`, '分母可用性', denominator.value !== null && denominator.value > 0 && denominator.provenance === 'fact'
          && denominator.verificationStatus === 'verified', 'needs-data', `观测 ${row.id} 的分母必须为正数且有事实核验声明；缺失/0/推断不能生成总体权重。`, refs);
      }
    }
    const key = JSON.stringify([row.metric, row.unit, row.populationBasis, row.geography.regionCode, row.geography.boundaryVintage,
      row.geography.level, row.geography.code, row.periodStart, row.periodEnd]);
    cells.set(key, [...(cells.get(key) ?? []), row]);
  }
  for (const [index, rows] of [...cells.values()].entries()) {
    if (rows.length < 2) continue;
    const values = rows.filter(row => row.value !== null).map(row => row.value);
    const conflicting = new Set(values).size > 1;
    add(`same-cell-${index}`, '同口径重复观测', !conflicting, 'conflict', `同指标/单位/分母/地域/期间有不同值：${rows.map(row => row.id).join('、')}。`, { observationIds: rows.map(row => row.id) });
    if (!conflicting) add(`duplicate-cell-${index}`, '同口径重复来源不可累加', false, 'needs-data', `重复观测 ${rows.map(row => row.id).join('、')} 需人工选择来源版本，不能相加或充当独立样本。`, { observationIds: rows.map(row => row.id) });
  }
  const metricUnits = new Map<string, Observation[]>();
  for (const row of pack.observations) {
    const key = JSON.stringify([row.metric, row.populationBasis, row.geography.regionCode, row.geography.boundaryVintage,
      row.geography.level, row.geography.code, row.periodStart, row.periodEnd]);
    metricUnits.set(key, [...(metricUnits.get(key) ?? []), row]);
  }
  for (const [index, rows] of [...metricUnits.values()].entries()) {
    add(`metric-unit-consistency-${index}`, '同指标单位一致', new Set(rows.map(row => row.unit)).size === 1,
      'conflict', `同口径指标 ${rows[0].metric} 出现不同单位，须显式拆指标或有审核的转换，不能自动比较。`,
      { observationIds: rows.map(row => row.id) });
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string): boolean => {
    if (active.has(id)) return false;
    if (visited.has(id)) return true;
    active.add(id);
    let acyclic = true;
    for (const ref of observations.get(id)?.derivation?.inputObservationIds ?? []) acyclic = visit(ref) && acyclic;
    active.delete(id); visited.add(id); return acyclic;
  };
  add('derivation-cycle', '推断输入无循环', pack.observations.every(row => visit(row.id)), 'invalid', '推断输入引用不可形成循环。');

  for (const claim of pack.claims) {
    const refs = { claimIds: [claim.id], observationIds: claim.observationIds };
    unique(claim.observationIds, `claim-${claim.id}`);
    const inputs = claim.observationIds.map(id => observations.get(id));
    add(`claim-reference-${claim.id}`, '声明观测引用', inputs.every(Boolean), 'invalid', `声明 ${claim.id} 须引用存在的观测。`, refs);
    add(`claim-scope-${claim.id}`, '声明支持范围', inputs.every(row => !row || row.metric === claim.metric && row.unit === claim.unit
      && row.populationBasis === claim.populationBasis && sameGeography(row.geography, claim.geography)
      && row.periodStart === claim.periodStart && row.periodEnd === claim.periodEnd),
    'conflict', `声明 ${claim.id} 不得把观测改成不同指标、单位、分母、人群、地域或期间。`, refs);
    if (claim.kind === 'hypothesis') {
      add(`claim-hypothesis-${claim.id}`, '假设不认证事实', ['assumption', 'generated'].includes(claim.provenance) && claim.value === null,
        'invalid', `假设 ${claim.id} 必须标assumption/generated且value为null，不可伪装数值事实。`, refs);
    } else {
      add(`claim-value-${claim.id}`, '直接摘要数值一致', claim.value !== null && inputs.every(row => !row || row.value === claim.value),
        'conflict', `声明 ${claim.id} 仅支持原观测直接摘要；加总/推断需另建带方法的观测。`, refs);
      add(`claim-provenance-${claim.id}`, '摘要血缘不升级', claim.provenance !== 'fact' || inputs.every(row => !row || row.provenance === 'fact'
        && row.verificationStatus === 'verified' && row.value !== null && sources.get(row.sourceId)?.verificationStatus === 'verified'
        && sources.get(row.sourceId)?.provenance !== 'synthetic-fixture'),
      'conflict', `声明 ${claim.id} 不可将推断、合成、空值或待核验观测升级为fact。`, refs);
    }
  }

  if (target) {
    add('requirements-period', '任务统计区间', !reversed(target.periodStart, target.periodEnd) && target.periodEnd <= target.asOf,
      'invalid', '任务统计期间须有序，且不得晚于asOf。');
    add('requirements-scope', '任务地域及时点匹配', target.regionCode === pack.region.code && target.boundaryVintage === pack.region.boundaryVintage
      && target.periodStart === pack.period.start && target.periodEnd === pack.period.end,
    'conflict', '包与任务地域、边界及期间不匹配，不能静默使用历史人口或他区业务数据。');
    const futureSources = pack.sources.filter(source => [source.publishedAt, source.retrievedAt, source.verificationRecord?.reviewedAt]
      .some(date => date !== null && date !== undefined && date > target.asOf));
    add('requirements-evidence-dates', '证据登记不晚于审核时点', (!pack.createdAt || pack.createdAt <= target.asOf) && !futureSources.length,
      'conflict', '包创建日、来源发布/采集日及核验日不得晚于任务asOf；未来核验记录不能用于过去的审核。',
      { sourceIds: futureSources.map(source => source.id) });
    unique(target.requiredMetrics.map(row => JSON.stringify(row)), 'requiredMetrics');
    if (target.maxAgeDays !== null && pack.period.end) {
      const age = (Date.parse(`${target.asOf}T00:00:00Z`) - Date.parse(`${pack.period.end}T00:00:00Z`)) / 86_400_000;
      add('freshness', '任务资料时效', age >= 0 && age <= target.maxAgeDays, 'needs-data', `距统计期末 ${age} 天；任务上限 ${target.maxAgeDays} 天，过期不能视为当前资料。`);
    }
    target.requiredMetrics.forEach((required, index) => {
      const matchingMetric = pack.observations.filter(row => row.metric === required.metric && row.geography.level === required.geographyLevel
        && (required.geographyCode === null || row.geography.code === required.geographyCode));
      const matching = matchingMetric.filter(row => row.unit === required.unit && row.populationBasis === required.populationBasis);
      add(`metric-unit-${index}`, '任务指标口径', !matchingMetric.length || !!matching.length, 'conflict', `指标 ${required.metric} 的单位/覆盖人群须为 ${required.unit} / ${required.populationBasis}，不能自动换算或替代。`, { observationIds: matchingMetric.map(row => row.id) });
      add(`metric-present-${index}`, '任务必需观测', matching.some(row => row.value !== null && row.provenance === 'fact'
        && row.verificationStatus === 'verified' && sources.get(row.sourceId)?.verificationStatus === 'verified'
        && sources.get(row.sourceId)?.provenance !== 'synthetic-fixture'),
      'needs-data', `必需指标 ${required.metric} 缺同口径、非空且具有核验声明的现实观测；不得生成经营推荐。`, { observationIds: matching.map(row => row.id) });
      if (required.requiresDenominator) {
        add(`denominator-definition-${index}`, '任务目标分母定义', required.denominatorUnit !== null && required.denominatorPopulationBasis !== null,
          'needs-data', `指标 ${required.metric} 需要显式目标分母单位与覆盖人群。`);
        const hasDenominator = matching.some(row => {
          const denominator = row.denominatorObservationId ? observations.get(row.denominatorObservationId) : undefined;
          return denominator && denominator.value !== null && denominator.value > 0 && sameScope(row, denominator)
            && denominator.unit === required.denominatorUnit && denominator.populationBasis === required.denominatorPopulationBasis
            && denominator.provenance === 'fact' && denominator.verificationStatus === 'verified'
            && sources.get(denominator.sourceId)?.verificationStatus === 'verified'
            && sources.get(denominator.sourceId)?.provenance !== 'synthetic-fixture';
        });
        add(`metric-denominator-${index}`, '目标分母存在且适配', !!hasDenominator, 'needs-data', `指标 ${required.metric} 缺符合任务口径的目标分母；不能用常住人口、订单或家庭户互相代替。`);
      }
    });
  } else {
    add('requirements-not-provided', '任务证据要求未指定', true, 'info', '仅完成包预检；调用方须提供requiredMetrics才能判断具体任务缺口。');
  }
  add('manual-certification', '保留人工核验闸门', true, 'info', SCOPE);
  return finish();
}
