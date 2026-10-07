import type { ResearchTask } from './research-schema';
import { fingerprint, summarize, type Profile, type ResponseRecord } from './survey-engine';

export function samplingReport(profiles: Profile[]) {
  const counts = (field: 'streetName' | 'ageBand' | 'sex' | 'presetName') => [...new Set(profiles.map(profile => profile[field]))].map(value => ({ value, planned: profiles.filter(profile => profile[field] === value).length }));
  const identities = profiles.map(profile => fingerprint({ street: profile.street, age: profile.age, sex: profile.sex, attributes: profile.attributes, description: profile.description, assumptions: profile.assumptions, behaviorNotes: profile.behaviorNotes, ...(profile.persona ? { persona: profile.persona } : {}) }));
  return { method: 'seeded-cell-coverage-fresh-draw-v2', populationWeighted: false, planned: profiles.length, uniqueProfiles: new Set(identities).size, duplicateProfiles: profiles.length - new Set(identities).size,
    coveredCells: new Set(profiles.map(profile => `${profile.street}:${profile.ageBand}:${profile.sex}`)).size,
    streets: counts('streetName'), ageBands: counts('ageBand'), sexes: counts('sex'), presets: counts('presetName'),
    limitations: ['优先覆盖未抽取的可行单元；每次重新赋值具体年龄，受约束时仍可能重复。', '重复画像不自动成为独立居民；画像数量不是目标群体人口分母。', '预设按轮转分配，无总体权重；低样本数不保证每个预设覆盖所有单元。'] };
}

export function buildAnalysis(task: ResearchTask, profiles: Profile[], responses: ResponseRecord[]) {
  const groups = (['streetName', 'ageBand', 'presetName'] as const).flatMap(field => [...new Set(profiles.map(profile => profile[field]))].map(value => {
    const selected = profiles.filter(profile => profile[field] === value); const ids = new Set(selected.map(profile => profile.id));
    const records = responses.filter(response => ids.has(response.residentId));
    return { field, value, planned: selected.length, uniqueProfiles: samplingReport(selected).uniqueProfiles, valid: records.filter(record => record.status === 'valid').length, summaries: summarize(task, records) };
  }));
  const comparisons = (task.comparisons ?? []).map(comparison => {
    const before = task.questionnaire.questions.find(question => question.id === comparison.baselineQuestionId)!;
    const after = task.questionnaire.questions.find(question => question.id === comparison.changedQuestionId)!;
    if (before.type !== 'single' || after.type !== 'single') throw new Error('配对分析只支持已登记单选题。');
    const valid = responses.filter(response => response.status === 'valid');
    const pairs = valid.map(response => ({ before: response.answers.find(answer => answer.questionId === before.id)?.value, after: response.answers.find(answer => answer.questionId === after.id)?.value })).filter(pair => typeof pair.before === 'string' && typeof pair.after === 'string');
    return { ...comparison, denominator: pairs.length, missing: responses.length - pairs.length,
      transitions: before.options.flatMap(first => after.options.map(second => ({ beforeId: first.id, beforeLabel: first.label, afterId: second.id, afterLabel: second.label, count: pairs.filter(pair => pair.before === first.id && pair.after === second.id).length }))),
      interpretation: '同一答卷内的条件追问交叉表，不是独立随机实验；“保持原选择”保留原文，不把它误算成某固定套餐。不推断真实市场因果。' };
  });
  const outputs = task.requestedOutputs.map(output => ({ output, status: output === 'price-comparison' && !comparisons.some(comparison => comparison.kind === 'price') ? 'needs-config' : 'completed', detail: output === 'price-comparison' && !comparisons.some(comparison => comparison.kind === 'price') ? '缺少 comparisons 中的价格配对题定义；不能由题干自动推断。' : output === 'group-comparison' ? '街道、年龄档和预设的未加权分组数表。' : output === 'price-comparison' ? '预登记价格追问交叉表；独立控价实验另行运行。' : output === 'hypothesis-report' ? '条件研究简报和后续证据清单，不提供真实开店预测。' : output === 'questionnaire-review' ? '结构检查与已登记约束覆盖，不等于全部题意审查。' : '逐题确定性汇总。' }));
  return { outputs, groups, comparisons,
    questionnaireReview: { questions: task.questionnaire.questions.length, required: task.questionnaire.questions.filter(question => question.required).length, types: [...new Set(task.questionnaire.questions.map(question => question.type))], profileRules: task.validationRules?.length ?? 0, semanticCoverage: 'only-declared-rules', warnings: ['未定义 validationRules 的问题不能宣称已完成语义自洽检查。', '职业、家庭与开放题需要进一步人工或模型盲评。'] },
    hypothesisReport: { title: task.title, valid: responses.filter(response => response.status === 'valid').length, planned: profiles.length, assumptions: [...new Set(profiles.flatMap(profile => profile.assumptions))], claims: task.declarations,
      nextEvidence: ['先核验目标人群资格和分母，再决定是否采用总体权重。', '用冻结画像做独立重复、单变量实验与无画像基线；保留失败及负结果。', '真实选址需候选点、客流、租金、竞争和目标用户/订单证据；儿童口味不能由照护者许可代替。'], marketRecommendation: 'not-supported' },
    limitations: ['所有比较仅描述这批合成答卷，不是滨江人口占比或真实购买率。', '有效答卷统计排除结构错误及已声明画像硬矛盾，须同时报告计划、失败和分组分母。'] };
}
export type SurveyAnalysis = ReturnType<typeof buildAnalysis>;
