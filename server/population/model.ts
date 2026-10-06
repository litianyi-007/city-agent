import { createHash } from 'node:crypto';
import { z } from 'zod';

const identifier = z.string().trim().min(1).max(200);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const sourceSchema = z.object({
  id: identifier,
  title: z.string().min(1),
  publisher: z.string().min(1),
  url: z.url({ protocol: /^https?$/ }),
  landingUrl: z.url({ protocol: /^https?$/ }),
  publishedAt: z.string().min(1).nullable(),
  retrievedAt: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  localPath: z.string().min(1),
  bytes: count,
}).strict();

const observationSchema = z.object({
  id: identifier,
  areaCode: identifier,
  dimension: z.enum(['total', 'age', 'sex', 'age_sex']),
  ageBand: identifier.optional(),
  sex: identifier.optional(),
  value: count,
  sourceId: identifier,
  locator: z.object({
    table: z.string().min(1),
    page: z.number().int().positive().optional(),
    pdfPage: z.number().int().positive().optional(),
    row: z.string().min(1),
    column: z.string().min(1),
  }).strict(),
  period: z.string().min(1),
  populationBasis: z.string().min(1),
  boundaryVersion: z.string().min(1),
  provenance: z.literal('fact'),
  derivation: z.object({
    operation: z.literal('subtract'),
    inputObservationIds: z.tuple([identifier, identifier]),
  }).strict().optional(),
}).strict();

/** An intake format, not a certification of the publisher or extracted values. */
export const regionPackSchema = z.object({
  schemaVersion: z.literal('1.0'),
  id: identifier,
  version: identifier,
  region: z.object({
    code: identifier,
    name: z.string().min(1),
    level: z.enum(['district', 'city', 'custom']),
    boundaryVersion: z.string().min(1),
  }).strict(),
  period: z.string().min(1),
  populationBasis: z.string().min(1),
  areas: z.array(z.object({ code: identifier, name: z.string().min(1) }).strict()).min(1),
  ageBands: z.array(z.object({
    id: identifier, label: z.string().min(1), minAge: count, maxAge: count.nullable(),
  }).strict()).min(1),
  sexCategories: z.array(z.object({ id: identifier, label: z.string().min(1) }).strict()).min(1),
  sources: z.array(sourceSchema),
  observations: z.array(observationSchema),
  limitations: z.array(z.string().min(1)),
  method: z.object({
    jointStrategy: z.enum(['independence', 'observed']),
    eligibleAgeBandIds: z.array(identifier),
    note: z.string().min(1),
  }).strict(),
}).strict().superRefine((pack, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const unique = (values: string[], path: string) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) issue([path, index], `重复标识：${value}`);
      seen.add(value);
    });
  };
  unique(pack.areas.map((row) => row.code), 'areas');
  unique(pack.ageBands.map((row) => row.id), 'ageBands');
  unique(pack.sexCategories.map((row) => row.id), 'sexCategories');
  unique(pack.sources.map((row) => row.id), 'sources');
  unique(pack.observations.map((row) => row.id), 'observations');
  unique(pack.method.eligibleAgeBandIds, 'method.eligibleAgeBandIds');
  const areaCodes = new Set([pack.region.code, ...pack.areas.map((row) => row.code)]);
  const ageIds = new Set(pack.ageBands.map((row) => row.id));
  const sexIds = new Set(pack.sexCategories.map((row) => row.id));
  const sourceIds = new Set(pack.sources.map((row) => row.id));
  const observationIndex = new Map(pack.observations.map((row) => [row.id, row]));
  pack.areas.forEach((row, index) => {
    if (row.code === pack.region.code) issue(['areas', index, 'code'], '子区域不能使用整个区域的标识');
  });
  pack.method.eligibleAgeBandIds.forEach((id, index) => {
    if (!ageIds.has(id)) issue(['method', 'eligibleAgeBandIds', index], `未知年龄组：${id}`);
  });
  const sortedAges = [...pack.ageBands].sort((a, b) => a.minAge - b.minAge);
  sortedAges.forEach((age, index) => {
    if (age.maxAge !== null && age.maxAge < age.minAge) issue(['ageBands'], `年龄组上下界颠倒：${age.id}`);
    if (index === 0 && age.minAge !== 0) issue(['ageBands'], '全龄人口的年龄组必须从 0 岁开始');
    if (index > 0) {
      const previous = sortedAges[index - 1];
      if (previous.maxAge === null || age.minAge !== previous.maxAge + 1) {
        issue(['ageBands'], `年龄组存在重叠或缺口：${previous.id} / ${age.id}`);
      }
    }
    if (index === sortedAges.length - 1 && age.maxAge !== null) issue(['ageBands'], '最后一个全龄年龄组必须开放上界（maxAge: null）');
  });
  const cells = new Set<string>();
  pack.observations.forEach((row, index) => {
    if (!areaCodes.has(row.areaCode)) issue(['observations', index, 'areaCode'], `未知区域：${row.areaCode}`);
    if (!sourceIds.has(row.sourceId)) issue(['observations', index, 'sourceId'], `未知证据：${row.sourceId}`);
    const needsAge = row.dimension === 'age' || row.dimension === 'age_sex';
    const needsSex = row.dimension === 'sex' || row.dimension === 'age_sex';
    if (needsAge !== (row.ageBand !== undefined)) issue(['observations', index, 'ageBand'], '年龄维度与观测类型不匹配');
    if (needsSex !== (row.sex !== undefined)) issue(['observations', index, 'sex'], '性别维度与观测类型不匹配');
    if (row.ageBand !== undefined && !ageIds.has(row.ageBand)) issue(['observations', index, 'ageBand'], `未知年龄组：${row.ageBand}`);
    if (row.sex !== undefined && !sexIds.has(row.sex)) issue(['observations', index, 'sex'], `未知性别分类：${row.sex}`);
    const key = JSON.stringify([row.areaCode, row.dimension, row.ageBand, row.sex]);
    if (cells.has(key)) issue(['observations', index], `同一人口单元重复观测：${key}`);
    cells.add(key);
    if (row.derivation) {
      for (const ref of row.derivation.inputObservationIds) {
        if (!observationIndex.has(ref)) issue(['observations', index, 'derivation'], `派生输入不存在：${ref}`);
        if (ref === row.id) issue(['observations', index, 'derivation'], '派生事实不可引用自身');
      }
    }
  });
  const visited = new Set<string>();
  const active = new Set<string>();
  const visit = (id: string) => {
    if (active.has(id)) { issue(['observations'], `派生事实存在循环：${id}`); return; }
    if (visited.has(id)) return;
    active.add(id);
    for (const ref of observationIndex.get(id)?.derivation?.inputObservationIds ?? []) visit(ref);
    active.delete(id);
    visited.add(id);
  };
  pack.observations.forEach((row) => visit(row.id));
});

export type RegionPack = z.infer<typeof regionPackSchema>;
type Observation = RegionPack['observations'][number];
export interface PopulationAudit {
  status: 'ready' | 'blocked';
  checks: { id: string; name: string; passed: boolean; detail: string }[];
  limitations: string[];
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Object key ordering is immaterial; array order and all evidence metadata are hashed. */
export function hashPopulationPack(pack: RegionPack): string {
  return createHash('sha256').update(canonical(regionPackSchema.parse(pack))).digest('hex');
}

function indexObservations(pack: RegionPack) {
  const index = new Map(pack.observations.map((row) => [JSON.stringify([row.areaCode, row.dimension, row.ageBand, row.sex]), row]));
  return (area: string, dimension: Observation['dimension'], age?: string, sex?: string) => index.get(JSON.stringify([area, dimension, age, sex]));
}

/** Tests semantic consistency only. Local bytes and original table accuracy need separate checks. */
export function auditPack(input: RegionPack): PopulationAudit {
  const parsed = regionPackSchema.safeParse(input);
  const checks: PopulationAudit['checks'] = [];
  const add = (id: string, name: string, passed: boolean, detail: string) => checks.push({ id, name, passed, detail });
  const scopeNote = '此审计仅检查结构、口径和算术一致性；不认证发布者身份、原表摘录准确性、统计调查质量或当前现实。CLI 另行校验本地证据文件的字节数与 SHA-256。';
  if (!parsed.success) {
    add('schema', '格式与引用完整性', false, parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
    return { status: 'blocked', checks, limitations: [scopeNote] };
  }
  const pack = parsed.data;
  add('schema', '格式与引用完整性', true, 'ID、人口单元唯一；来源及分类引用存在；年龄组全龄互斥且连续；人数为非负安全整数。');
  const mismatched = pack.observations.filter((row) => row.period !== pack.period || row.populationBasis !== pack.populationBasis || row.boundaryVersion !== pack.region.boundaryVersion);
  add('same-basis', '统计时点、人口口径与边界一致', mismatched.length === 0,
    mismatched.length ? `不可合并的观测：${mismatched.map((row) => row.id).join(', ')}` : `${pack.period} / ${pack.populationBasis} / ${pack.region.boundaryVersion}`);
  add('evidence', '观测具有来源与表格定位', pack.sources.length > 0 && pack.observations.length > 0,
    `${pack.sources.length} 份证据，${pack.observations.length} 条事实；链接与哈希字段存在不代表内容已人工核对。`);
  const derivationProblems: string[] = [];
  const observationIndex = new Map(pack.observations.map((row) => [row.id, row]));
  for (const row of pack.observations) {
    if (!row.derivation) continue;
    const [left, right] = row.derivation.inputObservationIds.map((id) => observationIndex.get(id)!);
    if ([left, right].some((input) => input.areaCode !== row.areaCode || input.period !== row.period || input.populationBasis !== row.populationBasis || input.boundaryVersion !== row.boundaryVersion)) derivationProblems.push(`${row.id} 的输入统计范围不一致`);
    if (row.value !== left.value - right.value) derivationProblems.push(`${row.id} 不等于输入之差`);
    const binaryPartition = left.dimension === 'total' && (
      (row.dimension === 'sex' && right.dimension === 'sex' && row.sex !== right.sex && pack.sexCategories.length === 2)
      || (row.dimension === 'age' && right.dimension === 'age' && row.ageBand !== right.ageBand && pack.ageBands.length === 2)
    );
    if (!binaryPartition) derivationProblems.push(`${row.id} 仅允许从总数减去互斥二分类的另一项，不能推测其他维度`);
  }
  add('derived-facts', '算术派生事实可重算且统计范围一致', derivationProblems.length === 0,
    derivationProblems.length ? derivationProblems.join('; ') : '派生事实使用明确输入的减法恒等式；保留 fact 标记，并区别于原表直接刊载值。');
  const get = indexObservations(pack);
  const regionTotal = get(pack.region.code, 'total');
  const areaTotals = pack.areas.map((area) => get(area.code, 'total'));
  const completeTotals = regionTotal !== undefined && areaTotals.every((row) => row !== undefined);
  const sumAreas = areaTotals.reduce((sum, row) => sum + (row?.value ?? 0), 0);
  add('totals', '区域总人口与子区域总人口完整且相符', completeTotals && sumAreas === regionTotal?.value,
    `区域总数 ${regionTotal?.value ?? '缺失'}；子区域合计 ${sumAreas}；${completeTotals ? '总数齐全' : '缺少总数，禁止估填'}。`);
  add('population-positive', '区域人口大于零', regionTotal !== undefined && regionTotal.value > 0,
    '空子区域允许为 0；整个调研区域必须有常住人口。');

  for (const area of pack.areas) {
    const total = get(area.code, 'total');
    for (const dimension of ['age', 'sex'] as const) {
      const rows = dimension === 'age'
        ? pack.ageBands.map((age) => get(area.code, 'age', age.id))
        : pack.sexCategories.map((sex) => get(area.code, 'sex', undefined, sex.id));
      const complete = rows.every((row) => row !== undefined);
      const sum = rows.reduce((value, row) => value + (row?.value ?? 0), 0);
      add(`${area.code}-${dimension}`, `${area.name} ${dimension === 'age' ? '年龄' : '性别'}边际`,
        complete && total !== undefined && sum === total.value,
        `${rows.filter(Boolean).length}/${rows.length} 项；合计 ${sum} / 总人口 ${total?.value ?? '缺失'}；未公开不等于零。`);
    }
  }

  // Optional district margins, when supplied, must also form a complete coherent table.
  for (const dimension of ['age', 'sex'] as const) {
    if (!pack.observations.some((row) => row.areaCode === pack.region.code && row.dimension === dimension)) continue;
    const categories = dimension === 'age' ? pack.ageBands : pack.sexCategories;
    let complete = true;
    const discrepancies: string[] = [];
    for (const category of categories) {
      const district = get(pack.region.code, dimension, dimension === 'age' ? category.id : undefined, dimension === 'sex' ? category.id : undefined);
      const subrows = pack.areas.map((area) => get(area.code, dimension, dimension === 'age' ? category.id : undefined, dimension === 'sex' ? category.id : undefined));
      if (!district || subrows.some((row) => !row)) complete = false;
      const sum = subrows.reduce((value, row) => value + (row?.value ?? 0), 0);
      if (district?.value !== sum) discrepancies.push(category.id);
    }
    add(`region-${dimension}`, `区域${dimension === 'age' ? '年龄' : '性别'}表与子区域一致`, complete && discrepancies.length === 0,
      complete && !discrepancies.length ? '提供的区域边际逐项等于子区域边际之和。' : `不完整或不一致分类：${discrepancies.join(', ') || '存在缺失'}`);
  }

  const jointRows = pack.observations.filter((row) => row.dimension === 'age_sex');
  if (pack.method.jointStrategy === 'independence') {
    add('joint-strategy', '联合分布方法与证据相符', jointRows.length === 0,
      jointRows.length ? '已输入联合事实却选择独立性推断；请使用完整 observed 联合表或将不可使用的联合表留在外部证据中，不可静默忽略。' : '未输入联合事实；街道内年龄×性别采用独立性假设，产物标记 infer。');
  } else {
    const jointProblems: string[] = [];
    for (const area of pack.areas) {
      for (const age of pack.ageBands) {
        const rows = pack.sexCategories.map((sex) => get(area.code, 'age_sex', age.id, sex.id));
        if (rows.some((row) => row === undefined)) jointProblems.push(`${area.code}/${age.id} 缺少联合单元`);
        if (rows.reduce((sum, row) => sum + (row?.value ?? 0), 0) !== get(area.code, 'age', age.id)?.value) jointProblems.push(`${area.code}/${age.id} 联合行和不符`);
      }
      for (const sex of pack.sexCategories) {
        const sum = pack.ageBands.reduce((value, age) => value + (get(area.code, 'age_sex', age.id, sex.id)?.value ?? 0), 0);
        if (sum !== get(area.code, 'sex', undefined, sex.id)?.value) jointProblems.push(`${area.code}/${sex.id} 联合列和不符`);
      }
    }
    // Region-level joint facts are optional but cannot disagree or be partially supplied.
    if (jointRows.some((row) => row.areaCode === pack.region.code)) {
      for (const age of pack.ageBands) for (const sex of pack.sexCategories) {
        const row = get(pack.region.code, 'age_sex', age.id, sex.id);
        const sum = pack.areas.reduce((value, area) => value + (get(area.code, 'age_sex', age.id, sex.id)?.value ?? 0), 0);
        if (!row || row.value !== sum) jointProblems.push(`区域/${age.id}/${sex.id} 缺失或不等于子区域之和`);
      }
    }
    add('joint-strategy', '联合事实完整且同时匹配年龄、性别边际', jointProblems.length === 0,
      jointProblems.length ? jointProblems.join('; ') : '全部联合单元已观测；明确的 0 保留，缺失不能替代为 0。');
  }
  add('eligible-frame', '调研年龄组已明示', pack.method.eligibleAgeBandIds.length > 0,
    pack.method.eligibleAgeBandIds.length ? pack.method.eligibleAgeBandIds.join(', ') : '请指定调研年龄组；不得隐式把全龄人口当成年人。');
  return {
    status: checks.every((check) => check.passed) ? 'ready' : 'blocked', checks,
    limitations: [...pack.limitations, scopeNote,
      '人口联合单元是加权逻辑人口，可为小数，并非真实个人名单。独立性假设不是个体事实，人口拟合通过也不证明偏好或消费预测可信。',
      'feasibleRange 为固定边际下的 Fréchet 可行界，不是置信区间；各单元的上下界不可同时任意取值。'],
  };
}

export function compilePopulation(input: RegionPack) {
  const pack = regionPackSchema.parse(input);
  const audit = auditPack(pack);
  if (audit.status !== 'ready') throw new Error(`人口数据包不可建模：${audit.checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`).join('; ')}`);
  const get = indexObservations(pack);
  const eligible = new Set(pack.method.eligibleAgeBandIds);
  const areas = pack.areas.map((area) => {
    const total = get(area.code, 'total')!;
    const ageGroups = pack.ageBands.map((age) => {
      const row = get(area.code, 'age', age.id)!;
      return { id: age.id, label: age.label, population: row.value, evidenceIds: [row.id] };
    });
    const sexCounts = pack.sexCategories.map((sex) => {
      const row = get(area.code, 'sex', undefined, sex.id)!;
      return { id: sex.id, label: sex.label, population: row.value, evidenceIds: [row.id] };
    });
    return { ...area, population: total.value, eligiblePopulation: ageGroups.filter((age) => eligible.has(age.id)).reduce((sum, age) => sum + age.population, 0), evidenceIds: [total.id], ageGroups, sexCounts };
  });
  const ageBands = pack.ageBands.map((age) => {
    const rows = pack.areas.map((area) => get(area.code, 'age', age.id)!);
    return { ...age, population: rows.reduce((sum, row) => sum + row.value, 0), eligible: eligible.has(age.id), evidenceIds: rows.map((row) => row.id) };
  });
  const cells = pack.areas.flatMap((area) => pack.ageBands.flatMap((age) => pack.sexCategories.map((sex) => {
    const total = get(area.code, 'total')!;
    const ageMargin = get(area.code, 'age', age.id)!;
    const sexMargin = get(area.code, 'sex', undefined, sex.id)!;
    const observed = get(area.code, 'age_sex', age.id, sex.id);
    const population = pack.method.jointStrategy === 'observed'
      ? observed!.value
      : total.value === 0 ? 0 : ageMargin.value * (sexMargin.value / total.value);
    return {
      id: JSON.stringify([area.code, age.id, sex.id]), areaCode: area.code, ageBand: age.id, sex: sex.id,
      population, eligible: eligible.has(age.id),
      provenance: pack.method.jointStrategy === 'observed' ? 'fact' as const : 'infer' as const,
      evidenceIds: pack.method.jointStrategy === 'observed' ? [observed!.id] : [total.id, ageMargin.id, sexMargin.id],
      method: pack.method.jointStrategy === 'observed' ? '原表联合频数，无统计下推' : '子区域年龄人口 × 同子区域全龄性别人口 / 子区域全龄人口；假设区域内年龄与性别独立',
      feasibleRange: { min: Math.max(0, ageMargin.value - (total.value - sexMargin.value)), max: Math.min(ageMargin.value, sexMargin.value) },
    };
  })));
  return {
    packId: pack.id, version: pack.version, datasetHash: hashPopulationPack(pack),
    period: pack.period, populationBasis: pack.populationBasis, region: structuredClone(pack.region),
    population: get(pack.region.code, 'total')!.value,
    eligiblePopulation: areas.reduce((sum, area) => sum + area.eligiblePopulation, 0),
    areas, ageBands, sexCategories: structuredClone(pack.sexCategories), sources: structuredClone(pack.sources),
    observations: structuredClone(pack.observations), method: structuredClone(pack.method), cells, audit,
  };
}

export type CompiledPopulation = ReturnType<typeof compilePopulation>;
