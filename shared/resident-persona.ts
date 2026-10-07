import { z } from 'zod';

/** Optional, scenario-authored layers. No field is a demographic observation or measured personality. */
export const PERSONA_CATALOG = {
  bigFive: [
    { id: 'openness', label: '开放性', description: '0–100情景倾向：从偏好熟悉经验到愿意探索新经验；不等于商品偏好或真实测量。' },
    { id: 'conscientiousness', label: '尽责性', description: '0–100情景倾向：规划、自律和履约方式；不推断收入、学历或道德水平。' },
    { id: 'extraversion', label: '外向性', description: '0–100情景倾向：社交互动与外部刺激偏好；不预设购买意愿。' },
    { id: 'agreeableness', label: '宜人性', description: '0–100情景倾向：合作和处理分歧的方式；不保证赞同产品或问卷。' },
    { id: 'emotionalStability', label: '情绪稳定性', description: '0–100情景倾向：较高表示设定中较稳定（神经质的反向方向）；不是心理诊断。' },
  ],
  primaryCaregiving: [
    { id: 'unknown', label: '未知' }, { id: 'two-caregivers', label: '两位主要照护者' },
    { id: 'single-caregiver', label: '单亲/单一主要照护者情景' }, { id: 'grandparents', label: '祖辈主要照护' }, { id: 'other', label: '其他主要照护结构' },
  ],
  experiences: [
    { id: 'relocated', label: '成长期间迁居' }, { id: 'extended-family', label: '扩展家庭共同照护' },
    { id: 'single-caregiver-period', label: '曾有单亲/单一照护阶段' }, { id: 'two-caregivers-period', label: '曾有双亲/两位照护阶段' },
    { id: 'grandparent-care-period', label: '曾有祖辈照护阶段' },
    { id: 'boarding', label: '寄宿经历' }, { id: 'rural', label: '乡村生活经历' }, { id: 'urban', label: '城市生活经历' },
  ],
  education: [
    { id: 'unknown', label: '未知' }, { id: 'primary', label: '小学' }, { id: 'junior', label: '初中' },
    { id: 'secondary', label: '高中' }, { id: 'vocational', label: '中等职业教育' }, { id: 'associate', label: '专科' },
    { id: 'bachelor', label: '本科' }, { id: 'master', label: '硕士' }, { id: 'doctor', label: '博士' }, { id: 'other', label: '其他/自定义' },
  ],
  relationship: [
    { id: 'unknown', label: '未知' }, { id: 'single', label: '单身' }, { id: 'partnered', label: '伴侣关系' },
    { id: 'married', label: '已婚' }, { id: 'divorced', label: '离异' }, { id: 'widowed', label: '丧偶' },
  ],
  livingRoles: [
    { id: 'living-alone', label: '独居' }, { id: 'with-partner', label: '与伴侣同住' }, { id: 'with-children', label: '与子女同住' },
    { id: 'with-parents', label: '与父母同住' }, { id: 'multi-generation', label: '多代同住' },
    { id: 'shared-housing', label: '合住' }, { id: 'caregiver', label: '承担照护角色（不要求同住）' },
  ],
  employment: [
    { id: 'unknown', label: '未知' }, { id: 'employed', label: '受雇' }, { id: 'self-employed', label: '自雇' },
    { id: 'student', label: '学生' }, { id: 'retired', label: '退休' }, { id: 'unemployed', label: '未就业' }, { id: 'other', label: '其他' },
  ],
  socialRoles: [
    { id: 'employee', label: '员工' }, { id: 'business-owner', label: '经营者' }, { id: 'student', label: '学习者' },
    { id: 'parent', label: '父母角色' }, { id: 'caregiver', label: '照护者' }, { id: 'volunteer', label: '志愿者' },
    { id: 'community-member', label: '社区参与者' }, { id: 'creator', label: '创作者' },
  ],
  incomeBasis: [
    { id: 'unknown', label: '未知' }, { id: 'personal-gross', label: '个人税前月收入' }, { id: 'household-disposable', label: '家庭月可支配收入' },
  ],
} as const;

const customEntry = z.object({ label: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(1000) }).strict();
const customEntries = z.array(customEntry).max(10).refine(entries => new Set(entries.map(entry => entry.label)).size === entries.length, '自定义项目标签不能重复');
const score = z.number().int().min(0).max(100).nullable();
const uniqueChoices = <T extends string>(values: readonly T[]) => z.array(z.enum(values)).max(values.length).refine(choices => new Set(choices).size === choices.length, '多选项目不能重复');

export const residentPersonaSchema = z.object({
  schemaVersion: z.literal('1.0'),
  provenance: z.literal('assumption'),
  personality: z.object({
    openness: score, conscientiousness: score, extraversion: score, agreeableness: score, emotionalStability: score,
    customTraits: customEntries,
  }).strict(),
  upbringing: z.object({
    primaryCaregiving: z.enum(PERSONA_CATALOG.primaryCaregiving.map(option => option.id)),
    experiences: uniqueChoices(PERSONA_CATALOG.experiences.map(option => option.id)),
    customExperiences: customEntries,
  }).strict(),
  education: z.object({
    level: z.enum(PERSONA_CATALOG.education.map(option => option.id)), customDetail: z.string().trim().max(1000),
  }).strict(),
  household: z.object({
    relationship: z.enum(PERSONA_CATALOG.relationship.map(option => option.id)),
    livingRoles: uniqueChoices(PERSONA_CATALOG.livingRoles.map(option => option.id)), customRoles: customEntries,
  }).strict(),
  work: z.object({
    employment: z.enum(PERSONA_CATALOG.employment.map(option => option.id)), occupation: z.string().trim().max(200),
    socialRoles: uniqueChoices(PERSONA_CATALOG.socialRoles.map(option => option.id)), customRoles: customEntries,
    income: z.object({
      currency: z.literal('CNY'), period: z.literal('month'),
      basis: z.enum(PERSONA_CATALOG.incomeBasis.map(option => option.id)),
      lower: z.number().finite().nonnegative().nullable(), upper: z.number().finite().nonnegative().nullable(),
    }).strict(),
  }).strict(),
}).strict().superRefine((persona, context) => {
  const income = persona.work.income;
  if (income.lower !== null && income.upper !== null && income.lower > income.upper) {
    context.addIssue({ code: 'custom', path: ['work', 'income', 'upper'], message: '收入上界不能小于下界。' });
  }
  if (income.basis === 'unknown' && (income.lower !== null || income.upper !== null)) {
    context.addIssue({ code: 'custom', path: ['work', 'income', 'basis'], message: '设置收入范围时必须明确个人税前或家庭可支配口径。' });
  }
  if (persona.household.livingRoles.includes('living-alone') && persona.household.livingRoles.some(role => !['living-alone', 'caregiver'].includes(role))) {
    context.addIssue({ code: 'custom', path: ['household', 'livingRoles'], message: '独居与明确共同居住项目互斥；照护角色不要求同住。' });
  }
});

export type ResidentPersona = z.infer<typeof residentPersonaSchema>;

/** A fresh object on each call; unknown is not silently assigned a midpoint. */
export function createDefaultPersona(): ResidentPersona {
  return {
    schemaVersion: '1.0', provenance: 'assumption',
    personality: { openness: null, conscientiousness: null, extraversion: null, agreeableness: null, emotionalStability: null, customTraits: [] },
    upbringing: { primaryCaregiving: 'unknown', experiences: [], customExperiences: [] },
    education: { level: 'unknown', customDetail: '' },
    household: { relationship: 'unknown', livingRoles: [], customRoles: [] },
    work: { employment: 'unknown', occupation: '', socialRoles: [], customRoles: [], income: { currency: 'CNY', period: 'month', basis: 'unknown', lower: null, upper: null } },
  };
}

/** UI text only: does not generate preferences, weights, eligibility or facts. */
export function summarizePersona(persona?: ResidentPersona): string[] {
  if (!persona) return ['五层画像未设置；旧预设保持原样，不自动补推。'];
  const value = residentPersonaSchema.parse(persona);
  const label = (options: readonly { id: string; label: string }[], id: string) => options.find(option => option.id === id)?.label ?? id;
  const custom = (items: { label: string; description: string }[]) => items.map(item => `${item.label}：${item.description}`);
  const join = (items: string[]) => items.length ? items.join('；') : '未知';
  const traits = PERSONA_CATALOG.bigFive.flatMap(trait => value.personality[trait.id] === null ? [] : [`${trait.label}=${value.personality[trait.id]}/100`]);
  const income = value.work.income;
  const incomeText = income.lower === null && income.upper === null ? '收入未知'
    : `${label(PERSONA_CATALOG.incomeBasis, income.basis)}，${income.lower === null ? '下界未知' : income.lower}–${income.upper === null ? '上界未知' : income.upper} CNY/month`;
  return [
    '五层设定均为用户情景假设，不是DNA、真实人格测量或人口事实。',
    `人格倾向：${join([...traits, ...custom(value.personality.customTraits)])}`,
    `成长经历：${join([label(PERSONA_CATALOG.primaryCaregiving, value.upbringing.primaryCaregiving), ...value.upbringing.experiences.map(id => label(PERSONA_CATALOG.experiences, id)), ...custom(value.upbringing.customExperiences)])}`,
    `教育：${label(PERSONA_CATALOG.education, value.education.level)}${value.education.customDetail ? `；${value.education.customDetail}` : ''}`,
    `当前家庭：${join([label(PERSONA_CATALOG.relationship, value.household.relationship), ...value.household.livingRoles.map(id => label(PERSONA_CATALOG.livingRoles, id)), ...custom(value.household.customRoles)])}`,
    `工作与社会角色：${join([label(PERSONA_CATALOG.employment, value.work.employment), ...(value.work.occupation ? [value.work.occupation] : []), ...value.work.socialRoles.map(id => label(PERSONA_CATALOG.socialRoles, id)), ...custom(value.work.customRoles)])}；${incomeText}`,
  ];
}
