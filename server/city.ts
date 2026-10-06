import { createHash } from 'node:crypto';
import { getPopulationModel } from './population/service.ts';
import type { CompiledPopulation } from './population/model.ts';

/** Historical official statistics and a deliberately uncalibrated survey fixture. */
export type Provenance = 'fact' | 'infer' | 'generated';
export interface SurveyInput {
  product: string;
  price: number;
  sampleSize: number;
  seed: number;
}

const MODEL_VERSION = 'binjiang-survey-fixture-v2';

function sourceIds(model: CompiledPopulation, evidenceIds: string[]) {
  return [...new Set(evidenceIds.map((id) => model.observations.find((row) => row.id === id)!.sourceId))];
}

function legacySources(model: CompiledPopulation) {
  return model.sources.map((source) => {
    const observation = model.observations.find((row) => row.sourceId === source.id)!;
    const locator = observation.locator;
    return {
      ...source, locator: `表 ${locator.table}，印刷页 ${locator.page ?? '未标注'}，PDF 第 ${locator.pdfPage ?? '未标注'} 页`,
      period: model.period, collectedAt: source.retrievedAt, populationBasis: model.populationBasis,
      access: '公开政府统计资料', provenance: 'fact' as const,
    };
  });
}

const DISCLAIMERS = [
  '这是可复现的规则仿真夹具，回答并非真人调查或 LLM 受访者输出，不能解释为市场需求或真实购买预测。',
  '人口来源为 2020 年第七次人口普查；历史结构未外推到当前年份。全龄人口与 15 岁及以上调研框分开报告。',
  '0–14 岁不进入作答样本。15–59 岁公开组包含 15–17 岁，无法据此识别成年人，结果不是成年人购买率。',
  '街道×年龄和街道×性别的边际为公开事实；年龄×性别联合分布按街道内独立性假设推断，未获公开联合表验证。',
  '兴趣、预算和价格接受度均由演示规则生成；未使用真实收入、偏好或价格弹性。各人口组使用相同偏好分布，组间差异不能当作人口特征导致的消费差异。',
  '产品名称仅作问卷标签，当前规则不理解商品语义；价格统一按人民币一次报价处理。用于真实决策前需定义业务量纲并开展真人验证。',
  '价格升高时接受度下降由模型公式保证，只验证实现方向，不构成对真实价格弹性的验证；不提供真人总体的置信区间。',
];

export function getCityProfile() {
  const model = getPopulationModel();
  return {
    id: model.packId,
    name: model.region.name,
    datasetHash: model.datasetHash, datasetVersion: model.version,
    population: model.population,
    eligiblePopulation: model.eligiblePopulation,
    eligibleAge: '15 岁及以上（包含 15–17 岁）',
    period: model.period,
    populationBasis: model.populationBasis,
    boundaryVintage: model.region.boundaryVersion,
    provenance: 'fact' as const,
    streets: model.areas.map((street) => ({
      id: street.code, name: street.name, population: street.population,
      share: street.population / model.population,
      eligiblePopulation: street.eligiblePopulation,
      provenance: 'fact' as const,
      sourceIds: model.sources.map((source) => source.id), evidenceIds: street.evidenceIds,
      ageGroups: street.ageGroups.map((age) => ({ id: age.id, name: age.label, population: age.population, provenance: 'fact' as const, sourceId: sourceIds(model, age.evidenceIds)[0], evidenceIds: age.evidenceIds })),
      sexCounts: street.sexCounts.map((sex) => ({ id: sex.id, name: sex.label, population: sex.population, provenance: 'fact' as const, sourceId: sourceIds(model, sex.evidenceIds)[0], evidenceIds: sex.evidenceIds,
        derivation: model.observations.find((row) => row.id === sex.evidenceIds[0])?.derivation ? '同表常住人口减另一性别人口；算术恒等式，输入链见人口数据包' : undefined,
      })),
    })),
    ageGroups: model.ageBands.map((age) => ({ id: age.id, name: age.label, population: age.population, share: age.population / model.population, provenance: 'fact' as const, sourceId: sourceIds(model, age.evidenceIds)[0], evidenceIds: age.evidenceIds })),
    sources: legacySources(model),
    limitations: [...new Set([...DISCLAIMERS, ...model.audit.limitations])],
  };
}

function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function validate(input: SurveyInput) {
  if (typeof input.product !== 'string' || !input.product.trim() || input.product.trim().length > 500) throw new Error('商品名称必须为 1–500 个字符');
  if (!Number.isFinite(input.price) || input.price < 0 || input.price > 100_000) throw new Error('价格必须为 0–100000 的有限数值');
  if (!Number.isInteger(input.sampleSize) || input.sampleSize < 30 || input.sampleSize > 600) throw new Error('样本数必须为 30–600 的整数');
  if (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 0xffff_ffff) throw new Error('随机种子必须为 0–4294967295 的整数');
}

function buildStrata(sampleSize: number, model: CompiledPopulation) {
  const strata = model.cells.filter((cell) => cell.eligible && cell.population > 0).map((cell) => {
    const street = model.areas.find((area) => area.code === cell.areaCode)!;
    const age = model.ageBands.find((band) => band.id === cell.ageBand)!;
    return {
      id: `${street.code}:${age.id}:${cell.sex}`, streetId: street.code, street: street.name, ageId: age.id, age: age.label, sex: cell.sex,
      population: cell.population, populationShare: cell.population / model.eligiblePopulation,
      provenance: cell.provenance, evidenceIds: cell.evidenceIds, feasibleRange: cell.feasibleRange,
      sourceIds: sourceIds(model, cell.evidenceIds),
      method: cell.method,
      sampleSize: 1,
      weight: 0,
    };
  });
  if (!strata.length || strata.length > sampleSize) throw new Error('调研样本数不足以覆盖全部非空人口层，或调研框为空');
  // Give each of the 12 strata one slot; apportion the remainder by largest remainder.
  const remaining = sampleSize - strata.length;
  const remainders = strata.map((stratum, index) => {
    const ideal = remaining * stratum.populationShare;
    stratum.sampleSize += Math.floor(ideal);
    return { index, remainder: ideal - Math.floor(ideal) };
  }).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const unallocated = sampleSize - strata.reduce((sum, stratum) => sum + stratum.sampleSize, 0);
  for (let i = 0; i < unallocated; i++) strata[remainders[i].index].sampleSize++;
  for (const stratum of strata) stratum.weight = stratum.population / stratum.sampleSize;
  return strata;
}

/** Pure, deterministic fixture; caller owns persistence and LLM execution. */
export function simulateSurvey(input: SurveyInput) {
  validate(input);
  const model = getPopulationModel();
  const { price, sampleSize, seed } = input;
  const product = input.product.trim();
  const rng = randomGenerator(seed);
  const strata = buildStrata(sampleSize, model);
  const latentResponses = strata.flatMap((stratum) => Array.from({ length: stratum.sampleSize }, (_, index) => {
    const interestScore = 0.2 + 0.75 * rng();
    const willingnessToPay = Math.round((8 + 112 * rng() ** 2) * 100) / 100;
    return {
      id: `${stratum.id}:${index + 1}`, stratumId: stratum.id,
      streetId: stratum.streetId, street: stratum.street, ageId: stratum.ageId, age: stratum.age, sex: stratum.sex,
      weight: stratum.weight, interestScore, willingnessToPay,
      latentThreshold: rng(),
    };
  }));
  // Common random numbers hold the respondent fixed across every price scenario.
  const probability = (response: typeof latentResponses[number], offer: number) => response.interestScore / (1 + Math.exp(Math.min(700, (offer - response.willingnessToPay) / 15)));
  const responses = latentResponses.map(({ latentThreshold, ...response }) => {
    const acceptanceProbability = probability({ ...response, latentThreshold }, price);
    const accepts = latentThreshold < acceptanceProbability;
    return {
      ...response, acceptanceProbability, accepts,
      answer: accepts ? '在这组生成的兴趣与预算条件下，我愿意进一步了解。' : '在这组生成的兴趣与预算条件下，我暂不接受这个报价。',
      provenance: 'generated' as const,
      attributeProvenance: { street: 'infer', age: 'infer', sex: 'infer', interestScore: 'generated', willingnessToPay: 'generated', answer: 'generated' } satisfies Record<string, Provenance>,
      sourceIds: model.sources.map((source) => source.id),
      generationPolicy: MODEL_VERSION,
    };
  });
  const summarize = (rows: typeof responses) => {
    const population = rows.reduce((sum, row) => sum + row.weight, 0);
    const weightedInterestedPopulation = rows.reduce((sum, row) => sum + (row.accepts ? row.weight : 0), 0);
    return {
      sampleSize: rows.length, population,
      interestedCount: rows.filter((row) => row.accepts).length,
      weightedInterestedPopulation,
      acceptanceRate: weightedInterestedPopulation / population,
      avgWillingnessToPay: rows.reduce((sum, row) => sum + row.willingnessToPay * row.weight, 0) / population,
      effectiveSampleSize: population ** 2 / rows.reduce((sum, row) => sum + row.weight ** 2, 0),
      provenance: 'generated' as const,
    };
  };
  const summary = summarize(responses);
  const priceSensitivity = [...new Set([price * 0.5, price * 0.75, price, price * 1.25, price * 1.5].map((value) => Math.round(value * 100) / 100))].map((offer) => ({
    price: offer,
    acceptanceRate: latentResponses.reduce((sum, response) => sum + (response.latentThreshold < probability(response, offer) ? response.weight : 0), 0) / model.eligiblePopulation,
    expectedAcceptanceRate: latentResponses.reduce((sum, response) => sum + probability(response, offer) * response.weight, 0) / model.eligiblePopulation,
    provenance: 'generated' as const,
  }));
  return {
    mode: 'deterministic-fixture' as const,
    modelVersion: MODEL_VERSION,
    product, price, sampleSize, seed,
    population: model.population,
    eligiblePopulation: model.eligiblePopulation,
    eligibleAge: '15 岁及以上（包含 15–17 岁）',
    period: model.period,
    summary, strata, responses,
    byStreet: model.areas.map((street) => ({ id: street.code, name: street.name, ...summarize(responses.filter((response) => response.streetId === street.code)) })),
    byAge: model.ageBands.filter((age) => age.eligible).map((age) => ({ id: age.id, name: age.label, ...summarize(responses.filter((response) => response.ageId === age.id)) })),
    priceSensitivity,
    sources: legacySources(model),
    disclaimers: [...new Set([...DISCLAIMERS, ...model.audit.limitations])],
    manifest: {
      modelVersion: MODEL_VERSION,
      datasetVersion: model.version, datasetHash: model.datasetHash,
      sourceHashes: model.sources.map((source) => ({ id: source.id, sha256: source.sha256 })),
      inputHash: createHash('sha256').update(JSON.stringify({ product, price, sampleSize, seed, modelVersion: MODEL_VERSION, datasetHash: model.datasetHash })).digest('hex'),
      randomAlgorithm: 'mulberry32', seed,
      sampling: '街道×年龄组×性别，12 层；每层至少 1 个代表样本，余量按人口比例最大余数法分配',
      weighting: '推断层人口 / 层样本数；每个样本代表其层的一部分逻辑人口',
      preferencePolicy: '各组相同：interest ~ Uniform(0.2,0.95); budget = 8 + 112 × Uniform(0,1)^2 RMB; acceptProb = interest / (1 + exp((price-budget)/15))',
      syntheticSample: true,
      withReplacement: false,
      samplingNote: '唯一合成代表 ID，不是从真人名册抽样；无真人抽样误差解释',
      llmCalls: 0, tokens: 0, estimatedCost: 0,
      structure: {
        weightSum: responses.reduce((sum, response) => sum + response.weight, 0),
        targetPopulation: model.eligiblePopulation,
        weightingError: Math.abs(responses.reduce((sum, response) => sum + response.weight, 0) - model.eligiblePopulation),
        interpretation: '权重回归人口边际由设计保证，不证明偏好模型真实性',
      },
    },
  };
}

export type CityProfile = ReturnType<typeof getCityProfile>;
export type SurveyResult = ReturnType<typeof simulateSurvey>;
