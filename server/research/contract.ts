import { fingerprint } from '../../shared/evidence.js';
import { auditPack, hashPopulationPack, regionPackSchema, type RegionPack } from '../population/model.js';
import { researchTaskSchema, type ResearchTask } from '../../shared/research-schema.js';
export { researchTaskSchema, type ResearchTask } from '../../shared/research-schema.js';
type Filter = ResearchTask['population']['filters'][number];
type Output = ResearchTask['requestedOutputs'][number];
const supportedOutputs = new Set<Output>(['questionnaire-review', 'synthetic-analysis', 'group-comparison', 'price-comparison', 'hypothesis-report']);

/** Contract/frame checks only. No source files, URLs, credentials, models or resident counts are accessed. */
export function preflightResearchTask(input: ResearchTask, inputPack: RegionPack) {
  const task = researchTaskSchema.parse(input);
  const pack = regionPackSchema.parse(inputPack);
  const missingEvidence: string[] = [];
  const warnings = [
    'ready 仅代表任务契约与登记人口框预检通过；不表示已执行居民作答或验证市场结论。',
    '本预检不读取原件或核验文件指纹；登记引用存在不等于其内容支持客户端陈述。',
    '所有回答和偏好仍须标注生成来源；不得把人口框拟合或合成回答外推为真实需求、人数或权重。',
    '此预检不执行问卷；请在独立执行区显式启动。allowedOutputs 仅声明输出范围，不表示分析已经执行。',
    'filters 全部按 AND 取交集；不支持隐式 OR、家庭成员关联或自动解释题目文本中的人群资格。',
    'decisionContext 描述研究设定，文字中的购买者、使用者和渠道不构成已核验资格或业务证据。',
    '仅校验结构、登记筛选与引用；未自动理解题意、题目与单位量纲、decisionContext 与 filters 的语义一致性。',
  ];
  const audit = auditPack(pack);
  if (audit.status !== 'ready') missingEvidence.push(...audit.checks.filter(check => !check.passed).map(check => `人口包审计未通过：${check.name}；${check.detail}`));
  if (task.population.regionCode !== pack.region.code) missingEvidence.push(`地区不匹配：任务 ${task.population.regionCode}，登记人口包 ${pack.region.code}；不能跨地区套用。`);
  if (task.population.period !== pack.period) missingEvidence.push(`时点不匹配：任务 ${task.population.period}，登记人口包 ${pack.period}；历史结构不会自动外推。`);
  if (task.population.unit === 'household') missingEvidence.push('当前人口包统计个人，不含家庭户、家庭关系或户内成员链接；不能将人数换算为户数。');

  const categories = new Map<string, string[]>([['street', pack.areas.map(area => area.code)], ['ageBand', pack.ageBands.map(age => age.id)], ['sex', pack.sexCategories.map(sex => sex.id)]]);
  const selected = new Map<string, Set<string>>();
  let minAge = 0;
  let maxAge = Infinity;
  let exactAges: Set<number> | undefined;
  let ageFilterValid = true;
  const numericValues = (filter: Filter): unknown[] => filter.op === 'in' ? filter.values : filter.op === 'between' ? [filter.min, filter.max] : [filter.value];
  for (const filter of task.population.filters) {
    if (filter.field === 'age') {
      const values = numericValues(filter);
      if (values.some(value => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 150)) {
        ageFilterValid = false;
        missingEvidence.push('age 筛选必须使用 0–150 的整数年龄；当前条件无法核验。');
        continue;
      }
      if (filter.op === 'gte') minAge = Math.max(minAge, filter.value);
      else if (filter.op === 'lte') maxAge = Math.min(maxAge, filter.value);
      else if (filter.op === 'between') { minAge = Math.max(minAge, filter.min); maxAge = Math.min(maxAge, filter.max); }
      else {
        const next = new Set(values as number[]);
        exactAges = exactAges ? new Set([...exactAges].filter(age => next.has(age))) : next;
      }
      continue;
    }
    const known = categories.get(filter.field);
    if (!known) {
      missingEvidence.push(`字段 ${filter.field} 没有登记人口观测；职业、收入、家庭阶段、照护、养宠或租户等资格不能由年龄/性别/街道推出。`);
      continue;
    }
    const values = filter.op === 'eq' ? [filter.value] : filter.op === 'in' ? filter.values : [];
    if (!values.length || values.some(value => typeof value !== 'string' || !known.includes(value))) {
      missingEvidence.push(`字段 ${filter.field} 仅支持登记分类的 eq/in：${known.join(', ')}；当前条件无法核验。`);
      continue;
    }
    const next = new Set(values as string[]);
    const previous = selected.get(filter.field);
    selected.set(filter.field, previous ? new Set([...previous].filter(value => next.has(value))) : next);
  }
  for (const [name, values] of selected) if (!values.size) missingEvidence.push(`字段 ${name} 的条件交集为空；不能建立该目标框。`);

  const selectedBands = pack.ageBands.filter(band => !selected.has('ageBand') || selected.get('ageBand')!.has(band.id));
  let matchedAge = false;
  const matchedBands: string[] = [];
  const partialBands: string[] = [];
  for (const band of selectedBands) {
    const lower = Math.max(band.minAge, minAge);
    const upper = Math.min(band.maxAge ?? Infinity, maxAge);
    if (lower > upper) continue;
    if (exactAges) {
      const matches = [...exactAges].filter(age => age >= lower && age <= upper);
      if (!matches.length) continue;
      matchedAge = true;
      matchedBands.push(band.id);
      if (band.maxAge === null || matches.length !== band.maxAge - band.minAge + 1) partialBands.push(band.id);
    } else {
      matchedAge = true;
      matchedBands.push(band.id);
      if (lower !== band.minAge || upper !== (band.maxAge ?? Infinity)) partialBands.push(band.id);
    }
  }
  if (ageFilterValid && !matchedAge) missingEvidence.push('年龄条件交集为空；不能建立该目标框。');
  if (partialBands.length) missingEvidence.push(`年龄精度不足：条件切分登记年龄档 ${partialBands.join(', ')}；例如 18+ 不能从 15–59 岁档中识别，不可将 15+ 冒充成年人。`);
  // A zero observation can rule a frame out. Positive separate margins cannot
  // prove a positive joint cell, so independence mode only checks possibility.
  const candidateAreas = pack.areas.filter(area => !selected.has('street') || selected.get('street')!.has(area.code));
  const candidateSexes = pack.sexCategories.filter(sex => !selected.has('sex') || selected.get('sex')!.has(sex.id));
  const possibleCell = candidateAreas.some(area => matchedBands.some(ageBand => candidateSexes.some(sex => {
    if (pack.method.jointStrategy === 'observed') return pack.observations.some(row => row.areaCode === area.code && row.dimension === 'age_sex' && row.ageBand === ageBand && row.sex === sex.id && row.value > 0);
    return pack.observations.some(row => row.areaCode === area.code && row.dimension === 'age' && row.ageBand === ageBand && row.value > 0)
      && pack.observations.some(row => row.areaCode === area.code && row.dimension === 'sex' && row.sex === sex.id && row.value > 0);
  })));
  if (!possibleCell) missingEvidence.push('登记观测或筛选交集排除了全部候选人口单元；空目标框不能用于作答或分析。');
  if (pack.method.jointStrategy === 'independence') warnings.push('街道内年龄×性别联合来自独立性假设，属于 infer，不是已观测联合或真实个人记录。');

  const sources = new Set(pack.sources.map(source => source.id));
  const observations = new Map(pack.observations.map(observation => [observation.id, observation]));
  for (const declaration of task.declarations) {
    for (const ref of declaration.sourceIds) if (!sources.has(ref)) missingEvidence.push(`声明 ${declaration.id} 引用了未登记来源 ${ref}。`);
    for (const ref of declaration.observationIds) {
      const observation = observations.get(ref);
      if (!observation) missingEvidence.push(`声明 ${declaration.id} 引用了未登记观测 ${ref}。`);
      else if (!declaration.sourceIds.includes(observation.sourceId)) missingEvidence.push(`声明 ${declaration.id} 的观测 ${ref} 与所列来源不对应。`);
    }
    if (declaration.provenance === 'fact') missingEvidence.push(`声明 ${declaration.id} 的 fact 是客户端自报；即使引用已登记，也尚未核验陈述与具体观测的对应，不能升级为已核验事实。`);
    else if (declaration.provenance === 'assumption') warnings.push(`声明 ${declaration.id} 是显式假设，可用于假设预演；它不会补齐目标群体资格或赋予总体代表性。`);
    else warnings.push(`声明 ${declaration.id} 标为 ${declaration.provenance}；不是经核验的现实事实。`);
  }
  const unsupported = task.requestedOutputs.filter(output => !supportedOutputs.has(output));
  if (unsupported.length) warnings.push(`超出当前研究输出范围：${unsupported.join(', ')}；不支持据此给出真实选址、市场预测、部署或后端服务。`);
  return {
    schemaVersion: '1.0' as const,
    taskHash: fingerprint(task),
    populationHash: hashPopulationPack(pack),
    status: unsupported.length ? 'unsupported' as const : missingEvidence.length ? 'needs-data' as const : 'ready' as const,
    missingEvidence: [...new Set(missingEvidence)], warnings: [...new Set(warnings)],
    allowedOutputs: task.requestedOutputs.filter(output => supportedOutputs.has(output)),
    semanticValidation: 'not-performed' as const,
    marketResearchValidated: false as const, modelCalls: 0 as const, executorAvailable: false as const,
  };
}
