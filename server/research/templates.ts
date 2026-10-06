import { researchTaskSchema, type ResearchTask } from './contract.js';

const population = { regionCode: 'binjiang', period: '2020-11-01', unit: 'person' as const };
const options = (labels: string[]) => labels.map((label, index) => ({ id: `option-${index + 1}`, label }));
const textQuestion = (id: string, prompt: string): ResearchTask['questionnaire']['questions'][number] => ({ id, type: 'text', prompt, required: true, maxLength: 1000 });

/** Ordinary task configurations; no template ID or title has privileged execution semantics. */
export function getResearchTemplates(): ResearchTask[] {
  return [
    {
      schemaVersion: '1.0', id: 'caregiver-snacks', title: '儿童照护者零食概念研究', objective: 'purchase-concerns',
      decisionContext: { offering: '儿童零食概念；具体配料、净含量和报价待定义，未定义前只评估信息需求。', buyer: '参与儿童零食购买或许可的成年照护者，资格尚无登记证据。', endUser: '儿童；本问卷向假设照护者提问，不直接代表儿童回答。', channel: '候选线下购买情景，具体学校、铺位及客流未知。' },
      population: { ...population, filters: [{ field: 'age', op: 'gte', value: 18 }, { field: 'caregiver', op: 'eq', value: true }] },
      questionnaire: { id: 'caregiver-snacks-v1', version: '1', questions: [
        textQuestion('purchase-role', '在假设照护情景中，您如何参与孩子零食的购买和许可？'),
        { id: 'concerns', type: 'multiple', prompt: '对于一份明确规格的儿童零食，哪些信息会影响您的考虑？', required: true, options: options(['配料与过敏原', '份量', '价格', '孩子接受程度', '其他']), minSelections: 1, maxSelections: 3 },
        textQuestion('evidence-needed', '在决定尝试之前，您还需要哪些商品信息？'),
      ] },
      declarations: [{ id: 'caregiver-assumption', claim: '照护身份仅为待核验的研究资格；当前人口包不能识别成年照护者。', provenance: 'assumption', sourceIds: [], observationIds: [] }],
      requestedOutputs: ['questionnaire-review', 'synthetic-analysis', 'hypothesis-report'],
    },
    {
      schemaVersion: '1.0', id: 'pet-snacks', title: '宠物零食概念研究', objective: 'demand-validation',
      decisionContext: { offering: '猫狗零食概念，不是主粮；用途、配料、净含量和报价待定义。', buyer: '18岁及以上购买宠物零食的成年人；成年、养宠和购买资格均待核验。', endUser: '猫或狗；成人购买者代述使用情境，不把宠物作为人类受访者。', channel: '线上业务与线下网点的研究情景；订单覆盖和网点用途待核验。' },
      population: { ...population, filters: [{ field: 'age', op: 'gte', value: 18 }, { field: 'petOwner', op: 'eq', value: true }] },
      questionnaire: { id: 'pet-snacks-v1', version: '1', questions: [
        { id: 'pet-type', type: 'single', prompt: '在本次假设情景中，您为哪类宠物考虑零食？', required: true, options: options(['猫', '狗', '猫和狗', '不适用']) },
        textQuestion('purchase-situation', '请说明考虑购买零食的具体情境与所需商品信息。'),
        textQuestion('objections', '什么条件会使您放弃购买？'),
      ] },
      declarations: [{ id: 'pet-assumption', claim: '养宠身份与猫狗类别没有登记人口证据，只能作为明确假设。', provenance: 'assumption', sourceIds: [], observationIds: [] }],
      requestedOutputs: ['questionnaire-review', 'synthetic-analysis', 'hypothesis-report'],
    },
    {
      schemaVersion: '1.0', id: 'ai-membership', title: 'AI 生活服务会员问卷预检', objective: 'price-benefits',
      decisionContext: { offering: 'AI会员概念：免费版提供基础AI与5GB；标准版19元/月，完整AI与100GB；家庭版39元/月，最多5人共用500GB。', buyer: '假设考虑个人或家庭订阅的人；15+人口框不等于有购买资格的成年人。', endUser: '免费版/标准版为个人使用，家庭版最多5人；实际家庭关系和支付决定者尚未核验。', channel: '假设线上订阅渠道；没有真实渠道触达或支付数据。' },
      population: { ...population, filters: [{ field: 'ageBand', op: 'in', values: ['15-59', '60+'] }] },
      questionnaire: { id: 'ai-membership-15', version: '1', questions: [
        { id: 'street', type: 'single', prompt: '在本次设定中，您居住在哪个街道？回答不会更新登记人口事实。', required: true, options: options(['西兴', '长河', '浦沿', '其他地区', '不确定']) },
        { id: 'age-range', type: 'single', prompt: '在本次设定中，您的年龄范围是？', required: true, options: options(['14岁及以下', '15–17岁', '18–29岁', '30–44岁', '45–59岁', '60岁及以上', '不确定']) },
        { id: 'occupation', type: 'single', prompt: '在本次设定中，您的职业或就业状态是？', required: true, options: options(['在职雇员', '个体经营/自由职业', '学生', '退休', '暂未就业', '其他或不确定']) },
        { id: 'household', type: 'single', prompt: '在本次设定中，您的同住家庭情况是？', required: true, options: options(['独居', '与伴侣同住', '与孩子同住', '多代同住', '其他或不确定']) },
        { id: 'ai-experience', type: 'single', prompt: '在本次设定中，您是否使用过AI产品？', required: true, options: options(['经常使用', '偶尔使用', '试过但已不用', '从未使用', '不确定']) },
        textQuestion('ai-uses', '在本次设定中，您通常使用AI做哪些事情？如果没有使用过或没有明确用途，请如实说明，不必编造用途。'),
        { id: 'cloud-experience', type: 'single', prompt: '在本次设定中，您是否使用过云存储或照片备份服务？', required: true, options: options(['经常使用', '偶尔使用', '试过但已不用', '从未使用', '不确定']) },
        { id: 'top-features', type: 'multiple', prompt: '对AI会员，您最看重哪些功能？最多选3项，选项不代表已具备相关偏好证据。', required: true, options: options(['AI能力与效果', '存储容量', '照片备份', '家庭共享', '隐私与数据控制', '价格', '使用方便']), minSelections: 1, maxSelections: 3 },
        { id: 'privacy', type: 'scale', prompt: '在考虑此类服务时，您有多关注隐私和数据使用？', required: true, min: 1, max: 5, minLabel: '完全不关注', maxLabel: '非常关注' },
        { id: 'version-choice', type: 'single', prompt: '假设以下套餐可用，您会考虑哪一种？', required: true, options: options(['免费版：基础AI + 5GB', '标准版：19元/月，完整AI + 100GB', '家庭版：39元/月，最多5人 + 500GB', '都不选择', '不确定']) },
        { id: 'max-monthly-payment', type: 'number', prompt: '对于符合您需求的AI会员，您最高愿意考虑每月支付多少元？不愿付费可填0；这是合成意向而非真实成交价。', required: true, min: 0, max: 1000, unit: '元/月' },
        textQuestion('purchase-concerns', '您购买或使用该会员的主要顾虑是什么？如不适用，请说明。'),
        { id: 'standard-price-change', type: 'single', prompt: '仅将标准版从19元/月改为29元/月，其他套餐与权益不变，您会如何调整第10题的选择？', required: true, options: options(['保持原选择', '改选免费版', '改选标准版29元/月', '改选家庭版39元/月', '改为都不选择', '不确定']) },
        { id: 'family-antifraud', type: 'single', prompt: '回到第10题的原始价格与套餐，只在家庭版增加老人防诈功能，您会如何调整第10题的选择？', required: true, options: options(['保持原选择', '改选免费版', '改选标准版19元/月', '改选家庭版39元/月', '改为都不选择', '不确定']) },
        textQuestion('trial-intent-reason', '如果可免费试用一个月，您是否愿意尝试，为什么？也可回答不确定或不适用。'),
      ] },
      declarations: [{ id: 'membership-assumption', claim: '三套餐和15题为概念研究设定；回答的职业、家庭、年龄细分等不能当人口事实。15+框包含未成年人。问卷内条件追问不等于已经执行9/19/29/49独立价格实验、单属性反事实、跨街道、措辞或重复作答验证。', provenance: 'assumption', sourceIds: [], observationIds: [] }],
      requestedOutputs: ['questionnaire-review', 'synthetic-analysis', 'price-comparison', 'group-comparison'],
      validationRules: [
        { id: 'street-profile', questionId: 'street', field: 'street', choices: [{ optionId: 'option-1', equals: 'xixing' }, { optionId: 'option-2', equals: 'changhe' }, { optionId: 'option-3', equals: 'puyan' }, { optionId: 'option-4', equals: 'outside' }, { optionId: 'option-5', unknown: true }] },
        { id: 'age-profile', questionId: 'age-range', field: 'age', choices: [{ optionId: 'option-1', min: 0, max: 14 }, { optionId: 'option-2', min: 15, max: 17 }, { optionId: 'option-3', min: 18, max: 29 }, { optionId: 'option-4', min: 30, max: 44 }, { optionId: 'option-5', min: 45, max: 59 }, { optionId: 'option-6', min: 60 }, { optionId: 'option-7', unknown: true }] },
      ],
      comparisons: [
        { id: 'standard-price', label: '标准版19→29元的问卷内条件追问', kind: 'price', baselineQuestionId: 'version-choice', changedQuestionId: 'standard-price-change' },
        { id: 'family-benefit', label: '家庭版增加老人防诈权益的问卷内条件追问', kind: 'benefit', baselineQuestionId: 'version-choice', changedQuestionId: 'family-antifraud' },
      ],
    },
  ].map(task => researchTaskSchema.parse(task));
}
