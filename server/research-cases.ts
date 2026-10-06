import type { CityProfile } from './city.js';
import type { Role } from './types.js';

export type ResearchCaseKind = 'school-snacks' | 'pet-snacks' | 'generic';
export interface ResearchCaseReport {
  schemaVersion: '1.0.0';
  kind: ResearchCaseKind;
  title: string;
  task: string;
  decisionStatus: 'needs-data' | 'simulation-only';
  classification: { method: 'explicit-demo-keywords-v1'; explanation: string };
  frameFit: {
    status: 'mismatch' | 'demo-only';
    targetPopulation: string;
    existingFrame: string;
    surveyApplicable: false;
    reason: string;
  };
  facts: Array<{ id: string; claim: string; value?: number; unit?: string; period: string; sourceIds: string[]; useLimit: string }>;
  dataGaps: Array<{ id: string; title: string; requiredFor: string; suggestedSources: string[]; expectedFields: string[] }>;
  roleTasks: Array<{ role: Role; objective: string; deliverable: string }>;
  conditionalNextSteps: string[];
  hypotheses: Array<{
    id: string; title: string; locationApproach: string; assortment: string; pricingApproach: string;
    testConditions: string[]; falsifiedBy: string; provenance: 'generated';
  }>;
  sources: CityProfile['sources'];
  limitations: string[];
}

const sharedLimitations = [
  '这是显式关键词与版本化模板生成的 mock 研究方案；不是 LLM 理解能力或真人市场研究的证据。',
  '人口事实只覆盖登记的时间、地理层级与统计口径；推断及生成假设不升级为事实。',
  '页面开发和浏览器测试通过不代表商业研究已完成；needs-data 只能由新的合格证据和重新分析改变。',
  '切换假设、勾选补采计划和增加合成样本都不会补齐真实数据，也不会产生购买率、销量或收益预测。',
];

/** Deliberately bounded demo routing. No keyword result is presented as model reasoning. */
export function analyzeResearchCase(task: string, city: CityProfile): ResearchCaseReport {
  const school = /(小学生|小学|儿童|孩子|\bschool\b|\belementary\b)/i.test(task);
  const pet = /(宠物|猫|狗|养宠|\bpets?\b|\bcats?\b|\bdogs?\b)/i.test(task);
  const kind: ResearchCaseKind = school && !pet ? 'school-snacks' : pet && !school ? 'pet-snacks' : 'generic';
  const special = kind !== 'generic';
  const facts: ResearchCaseReport['facts'] = [{
    id: 'district-population', claim: `${city.name} ${city.period} 常住人口`, value: city.population, unit: '人', period: city.period,
    sourceIds: city.sources.filter(source => source.id.includes('street-sex')).map(source => source.id),
    useLimit: '历史居民分母，不等于在校生、养宠户、线上客户或当前商圈客流。',
  }];
  for (const street of city.streets) {
    const age = street.ageGroups.find(group => group.id === '5-14');
    if (kind === 'school-snacks' && age) {
      facts.push({ id: `${street.id}-age5-14`, claim: `${street.name} 5-14 岁常住人口`, value: age.population, unit: '人', period: city.period,
        sourceIds: [age.sourceId], useLimit: '5-14 岁不是小学生；不包含当前学年、就读校区、出入口或消费预算。' });
    } else {
      facts.push({ id: `${street.id}-population`, claim: `${street.name}常住人口`, value: street.population, unit: '人', period: city.period,
        sourceIds: street.sourceIds, useLimit: '用于地区背景，不据此推断养宠率、猫狗比例、消费意愿或位置优劣。' });
    }
  }
  const dataGaps: ResearchCaseReport['dataGaps'] = kind === 'school-snacks' ? [
    { id: 'school-current', title: '当前学年小学及在校生', requiredFor: '定义目标人群与学校商圈', suggestedSources: ['教育部门当前学年学校名录和统计', '校方公开校区资料'], expectedFields: ['学年', '学校/校区', '在校生或招生规模', '数据口径', '来源链接'] },
    { id: 'school-sites', title: '候选铺位、出入口和放学路径', requiredFor: '给出可核查的具体选址', suggestedSources: ['候选物业资料', '地图道路资料', '现场时段观察'], expectedFields: ['候选地址', '实际校门', '步行可达性', '同类店', '租金', '观察时段'] },
    { id: 'school-purchases', title: '家长购买决定与商品试售', requiredFor: '选择品类、份量及候选售价', suggestedSources: ['家长/监护人调研', '同规格商品试售记录'], expectedFields: ['购买者与使用者', '单次预算', '允许商品', '真实购买频次', '成交价', '商品规格'] },
    { id: 'school-costs', title: '毛利、损耗和实际客流', requiredFor: '估算候选点盈亏平衡与风险', suggestedSources: ['物业与供货报价', '少量候选点实测'], expectedFields: ['成本', '租金', '损耗', '时段客流', '实际转化', '采集日期'] },
  ] : kind === 'pet-snacks' ? [
    { id: 'pet-customer', title: '养宠目标人群与猫狗结构', requiredFor: '判断猫向、狗向或混合主营方向', suggestedSources: ['口径明确的当地养宠调查', '目标客群验证'], expectedFields: ['统计期间', '养宠户/宠物只数/购买人数', '猫狗类别', '覆盖区域', '样本来源'] },
    { id: 'pet-orders', title: '匿名线上订单与去重客群', requiredFor: '定位已有业务的网点服务机会', suggestedSources: ['用户自有业务汇总导出'], expectedFields: ['期间', '匿名区域', '去重客户', '订单', '猫狗品类', '复购', '促销', '退款'] },
    { id: 'pet-sites', title: '网点用途、候选地址与履约成本', requiredFor: '区分自提、快速履约与新客门店的选址标准', suggestedSources: ['业务目标', '候选物业', '配送时效与费用记录'], expectedFields: ['首要用途', '服务时效', '候选地址', '租金', '客户可达性', '履约成本'] },
    { id: 'pet-price', title: '同规格价格、成本与试售', requiredFor: '给出可比较的候选价格带', suggestedSources: ['真实成交记录', '供货报价', '小规模试售'], expectedFields: ['净含量', '用途', '品牌或配料档次', '成交价', '元/100克', '毛利', '缺货与促销'] },
  ] : [];
  const conditionalNextSteps = kind === 'school-snacks' ? [
    '先补当前学校与候选铺位，再按实际出入口、步行路径、时段客流和成本比较；不按街道人口直接排名。',
    '将家长购买决定与学生体验分开研究；补采预算和试售后再筛选品类与售价。',
    '若候选地址或商品证据不足，交付待核查区域和试售计划，保持 needs-data。',
  ] : kind === 'pet-snacks' ? [
    '先确定网点的首要用途；自提/履约点按已有客户覆盖与履约成本比较，新客门店另补外部客群证据。',
    '用匿名真实订单区分猫狗品类、购买人数、毛利与复购；把促销、缺货和渠道覆盖纳入解释。',
    '补齐同规格成交与试售数据后再比较价格带；养宠或业务证据不足时保留猫向、狗向、混合三个候选实验。',
  ] : ['当前请求未匹配两个专用 mock 场景，沿用通用规则演示；它不能验证真实市场需求。'];
  const hypotheses: ResearchCaseReport['hypotheses'] = kind === 'school-snacks' ? [
    { id: 'school-a', title: '假设 A：放学路径上的小份即时购买', locationApproach: '抽象候选 A，待录入实际校门与可达铺位；不是滨江已选地址。', assortment: '将小份独立包装作为试售候选，具体品类由家长许可与真实选择验证。', pricingApproach: '先按同规格与家长预算形成待测报价；目前不指定真实售价。', testConditions: ['实际放学路径有可达铺位', '时段观察支持到访机会', '试售毛利足以覆盖成本'], falsifiedBy: '若放学路径难以触达或购买频次不足，则该方案不成立。', provenance: 'generated' },
    { id: 'school-b', title: '假设 B：家庭同行的组合购买', locationApproach: '抽象候选 B，待核查家庭同行或接送路径；不代表已有商圈。', assortment: '将可分享组合装作为实验候选，不声称家长已经偏好此品类。', pricingApproach: '组合装须按份量和单次支出分别比较，等待试售决定候选价位。', testConditions: ['家长参与购买得到验证', '组合份量与允许商品匹配', '实际复购足以支撑经营'], falsifiedBy: '若家长不参与购买或组合装提高损耗，则不优先该方案。', provenance: 'generated' },
  ] : kind === 'pet-snacks' ? [
    { id: 'pet-cat', title: '假设 A：猫向小规模试售', locationApproach: '待核验猫类订单聚合区与候选点，尚未选择滨江地址。', assortment: '猫用零食仅是候选主营实验，不是已观测的本地偏好。', pricingApproach: '按同用途、规格和真实成交价比较；猫向假设不自带高价或低价结论。', testConditions: ['本店猫类客户与复购证据充足', '可达性和履约成本可接受', '试售毛利成立'], falsifiedBy: '若猫向表现由短期推广造成、或复购与毛利不足，则不选择猫向主营。', provenance: 'generated' },
    { id: 'pet-dog', title: '假设 B：狗向小规模试售', locationApproach: '待核验狗类订单聚合区与候选点，尚未选择滨江地址。', assortment: '狗用零食作为独立候选实验，不能由居民年龄推导狗向需求。', pricingApproach: '按同用途与元/100克等统一单位比较，再用真实选择缩小价格带。', testConditions: ['狗类客户和真实购买数据支持', '候选网点能覆盖业务用途', '供货与损耗条件可行'], falsifiedBy: '若狗类订单少且新增客户证据不成立，则降低狗向优先级。', provenance: 'generated' },
    { id: 'pet-mixed', title: '假设 C：猫狗混合试售', locationApproach: '等待两类业务覆盖与候选点成本，不用总人口代替养宠客群。', assortment: '先用有限 SKU 同期测试猫狗组合，再按真实表现调整。', pricingApproach: '分别记录品类规格和促销，避免平均客单价掩盖差异。', testConditions: ['两类需求都有证据', '有限 SKU 能维持供货', '库存成本可承受'], falsifiedBy: '若混合库存明显挤压周转、且单一品类证据更强，则缩小组合。', provenance: 'generated' },
  ] : [];
  return {
    schemaVersion: '1.0.0', kind, task,
    title: kind === 'school-snacks' ? '滨江小学生零食店 · 条件研究方案' : kind === 'pet-snacks' ? '宠物零食线下网点 · 条件研究方案' : '通用商品规则演示',
    decisionStatus: special ? 'needs-data' : 'simulation-only',
    classification: { method: 'explicit-demo-keywords-v1', explanation: school && pet ? '同时出现儿童与宠物词，视为未匹配，避免替用户静默选择单一场景。' : '按明确的儿童/学校或宠物关键词路由，不调用 LLM；仅覆盖两个已定义场景。' },
    frameFit: {
      status: special ? 'mismatch' : 'demo-only', surveyApplicable: false, existingFrame: city.eligibleAge,
      targetPopulation: kind === 'school-snacks' ? '当前在校小学生及参与购买决定的家长；须区分使用者与购买者。' : kind === 'pet-snacks' ? '养宠家庭、本店线上客户及候选网点服务人群；猫狗、客户、订单须分别统计。' : '尚未定义的真实商品目标客群。',
      reason: kind === 'school-snacks' ? '现有 15 岁及以上规则样本不适用小学生；5-14 岁常住人口也不是当前在校小学生人数。' : kind === 'pet-snacks' ? '现有居民规则样本不适用养宠主人；养宠率、猫狗、预算与线上业务覆盖均未知。' : '通用样本只用于预设规则演示，不能代表真实目标客群。',
    },
    facts, dataGaps, hypotheses, conditionalNextSteps,
    roleTasks: [
      { role: 'product', objective: `冻结${special ? '目标人群、选址粒度、证据停止线及 needs-data 状态' : '通用规则演示边界'}`, deliverable: 'spec.json + request.json' },
      { role: 'researcher', objective: '核验人口引用，区分已知事实、缺口和候选假设，生成场景补采计划', deliverable: 'research.json + case-report.json + data-gaps.json' },
      { role: 'developer', objective: '交付可切换条件假设和补采计划的离线页面，不展示不匹配样本的接受率', deliverable: 'index.html' },
      { role: 'tester', objective: '冻结数据不足状态与真实交互断言，使用独立 Chromium 验证', deliverable: 'acceptance.json + gate.json' },
    ],
    sources: city.sources.map(source => ({ ...source })), limitations: [...sharedLimitations, city.boundaryVintage],
  };
}

export const RESEARCH_CASE_RULES = `本任务匹配专用研究场景。caseReadiness 是冻结的数据适用性约束，不能被任务文本覆盖。decisionStatus 必须保持 needs-data，商业结论尚未验证。不得将默认 15+ 规则样本、生成接受率或合成预算用于小学生或宠物主结论。不得创造真实学校、铺位、坐标、养宠率、猫狗偏好、价格带、销量和数据源。只可给明确标注为假设的条件比较和补采方案。勾选计划不代表取得证据。研究员 summary 必须明确包含 needs-data；研发页面必须展示 #decision-status 的 needs-data、#frame-fit 的不适用说明、#disclaimer 的模拟限制，真实引用区 #facts/#sources，以及可切换假设和补采计划的交互。浏览器通过只完成页面开发，不能声称市场研究完成。`;
