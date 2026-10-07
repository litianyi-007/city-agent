# 两业务场景：完整问卷与零费用工程自证

版本：`business-engineering-proof-1.1`；审计器：`explicit-questionnaire-logic-1.1`；日期：2026-10-07。新增证据，不替换旧PDF、冻结Tag或旧persona-proof预算反例。

这是**synthetic工程演示**，不是滨江真人调研。每场景12个合成画像，4个五层情景各3人；真实模型调用、Token和API费用均为0。完整率由显式工程规则保证，不升级真实LLM质量、五层人格行为效度、市场校准、真实购买率或经营推荐门限。

## 1. 两个完整问卷

| 场景 | 冻结问卷 | 题目与测量边界 |
| --- | --- | --- |
| 小学生零食 | [17题问卷](../../data/research/business-child-questionnaire.json) | 资格、购买/许可角色、过去购买、许可因素、计划预算、20克价格区间、规格、渠道、出行、粗粒度可到达街道、顾虑和开放题。只模拟成年照护者，不替代儿童本人表达口味。`child-own-taste`全部null，直接儿童证据未采集。 |
| 宠物零食 | [18题问卷](../../data/research/business-pet-questionnaire.json) | 猫/犬资格、采购角色、零食/主粮边界、过去零食购买、未来预算、50克价格区间、规格、渠道、自提/配送、出行、顾虑及相同50克商品10/20元配对追问。条件交叉表不是随机控价因果实验。 |

单选提供不知道/不购买出口，多选“无/未知”排他。量表、数值及开放题允许null。预算口径明确：儿童为一名选定小学生未来30天；宠物为一个情景家庭未来30天、仅辅助零食。明确“不考虑购买”预算0，未知预算null；不把零食预算与收入、主粮预算或滨江均值互换。

价格区间左闭右开且附固定规格；另一个规格的偏好不被当成同一价格。未知数值不强制填中点。这里只测概念，不采集身份证、儿童真实姓名、住址、学校班级或健康隐私，不给营养/医疗建议。

## 2. 四类五层情景与抽样

[business-personas.json](../../data/research/business-personas.json)给出受雇与共同生活、五层全未知、退休与多代照护、自雇与照护四种工程上下文。每种包含人格、成长、教育、当前家庭、工作/收入；全部`provenance=assumption`，不是真实测量、DNA、人口常模或典型人群占比。收入全部保留未知，不把学历/地区产业推出工资或消费能力。

[research-demo.ts](../../shared/research-demo.ts)分别赋予显式成年/小学照护或养猫犬/采购资格；真实资格人数没有观测，预检保持needs-data。猫/犬/双宠情景配比只用于代码覆盖，不是滨江比例。2020历史人口框按现有单元覆盖抽样，独立性联合和细分年龄仍为推断/假设；没有目标总体权重，不能外推2026市场。

四个回答情景（考虑、需了解、不购买、未知）根据seed和合成resident序号轮转，每4人块再次旋转，避免一个预设永远回显同一个固定购买答案。生成策略只利用明确物种资格避免产品适用矛盾；不根据五层人格、教育、家庭、收入推导购买偏好。这不是LLM，也不是人格驱动行为验证。

## 3. 跨题规则是独立审计

[questionnaire-logic.ts](../../shared/questionnaire-logic.ts)只检查显式登记的互斥和条件规则，例如：

- 明确不考虑购买 → 预算0、不选择未来购买渠道、规格/价格为不购买、出行null。
- 未知购买意向 → 未知预算null；不把unknown改成0。
- 过去购买0次 → 过去品类为未购买；无/未知不能与其他多选项同选。
- 本轮没有儿童直接回答 → 孩子本人口味null；照护者观察不可代替。
- 仅猫情景不出现犬用磨牙条，仅犬情景不出现猫条；只配送时线下出行不适用。
- 宠物总体不考虑购买 → 两个固定规格价格追问均为不考虑。

原始JSON继续通过`executeSurvey`的脱敏、结构校验和已登记画像硬规则路径。新策略ID冻结于`run.parameters.fixturePolicyId`及limitations；只有可信进程内`mode=fixture`能注入，HTTP任务schema不接受函数或策略ID。

`logicAudit`另册保存每个规则/检查/失败，不改`survey.metrics.valid`的含义，不称通用语义理解。一个结构合法但“不买且预算100”的答卷会被本册规则判冲突；它仍不能被自动说成所有消费逻辑已检查。未知出口可通过工程规则，不等于掌握未知事实。旧persona-proof中的两个预算冲突原文仍保留。

审计器1.1不信任导入的`structureValid`或answers：从raw重新执行答题结构验证、比对answers，并检查计划分母、居民ID唯一/归属、缺失及上游状态。空规则或0实际检查返回not-evaluated；必答题缺失、原文与答案不符、缺答卷/重复/孤立居民不能算通过。全批分母不一致时`passed=0`，可复核的单份数量另存`individuallyPassed`，不把部分答卷包装成完整12/12。

冻结画像在任何checkpoint/请求之前检查任务与预设资格交集、年龄/街道/性别单元、属性镜像和证据标记、唯一ID/count及persona血缘。服务端另有来源run的模型配置匹配检查；这些内部一致性检查不是原始供应商或模型身份的独立认证。这里所有模型标识都是`fixture-no-model`，没有供应商请求。

## 4. 本机复现，无Key无网络模型调用

使用项目Node22及已经安装的依赖；无需新安装SDK、Chromium或模型权重：

```sh
npx tsx scripts/create-business-proof.ts
npx tsx scripts/create-business-proof.ts --seed=42 --scenario=child-snacks
npx tsx --test tests/business-proof.test.ts tests/persona-proof.test.ts
```

如不希望npx访问网络，可使用已安装的`./node_modules/.bin/tsx`替代`npx tsx`。脚本只读登记人口原件与源码数据，先验证本地原件完整性，不抓网页、不调用Harness或真实模型。拒绝live、Key、count、自定义输出路径、重复参数及无界seed。默认两场景各12人，输出每次新UUID：`output/business-proof/<UUID>/`。目录与文件exclusive创建，不覆盖旧证据。

产物包括完整问卷、无Key预设、冻结survey-run、每画像Prompt、原始答卷、未加权逐题/街道/预设统计、独立logicAudit、可读报告与字节SHA-256 manifest。稳定证据hash覆盖任务/人口/画像/raw/规则及审计verifier版本，便于相同seed同审计器复算；实际运行时间、耗时和UUID保留真实生成值，故文件字节hash允许不同。哈希证明一致性，不认证现实真实性或真实执行的第三方身份。

`getBusinessDemos()`供前端查看/显式应用；`createBusinessDemoRun({demoId,population,pack,seed?,id?,signal?})`供前端或本机零模型运行，返回`run`、`logicAudit`、`demo`与`evidenceHash`。新增完整业务面板将run与logicAudit/rules一起保存于专用IndexedDB，并同步普通运行库；刷新后的历史按原冻结规则复算，未套用当前规则。旧1.0审计保留原始附件，不静默升级当前通过结论。

“应用问卷与五层预设”仅复制task/presets为草稿，不携带另册业务logicRules或专用fixturePolicy。此后普通“运行问卷演示”仍使用通用随机规则策略；不能借用专用业务面板的12/12跨题自证。编辑后真实问卷质量亦须重新评测。

## 5. 仍不能回答的经营决策

没有真实目标资格与分母、儿童直接口味、猫狗采购者比例、候选点及边界、客流/租金/竞争、线上订单密度、SKU进价/库存、真实报价/履约成本、经营/学校周边合规证据，不能推荐具体区域、店址、主营类别、价位、猫粮或狗粮、销量或盈利。

它补齐比赛中“完整仿真问卷、运行流程、原文和参数可复核”的工程自证，而非补齐真实市场调研。真实模型质量、跨题盲评、同画像重复/消融、真实居民留出校准需独立预算授权与新实验，不拼接旧AI会员实测来冒充本次业务/五层有效。外部现实桥、MCP、长期记忆和dream也没有因此实现。

## 6. 本批工程验收门限

两场景各12个独立Prompt及原始答卷、每问卷12–18题、五题型俱全、4个五层情景均覆盖3人；结构12/12、另册登记跨题规则12/12、各文件hash/画像→Prompt血缘可复算、新版证据导入通过、真实calls/Token/API费均0。任何失败或冲突不删样本、不改seed掩盖，脚本不给通过报告。真实模型/业务/外部效度门限全部not-tested/not-supported。

默认每场景明确不购买3份、未知购买意向3份；预算0为3份、null为6份（包括待进一步了解）、有金额3份。儿童本人直接口味12份均null。这些数量由策略覆盖保证，只是代码分支覆盖，不是市场发现。量表unknown及多选排他、预算冲突、物种冲突、坏规则引用、冻结资格伪造与非法fixture控制都有负面测试。

## 7. 2026-10-07 首轮1.0生成记录（保留历史，非最新验收）

本批源码生成的独立产物目录：[output/business-proof/e73526c1-0374-4cd4-9a84-c2a5b96f48dc](../../output/business-proof/e73526c1-0374-4cd4-9a84-c2a5b96f48dc/)。可读报告：[proof-report.md](../../output/business-proof/e73526c1-0374-4cd4-9a84-c2a5b96f48dc/proof-report.md)；字节清单：[manifest.json](../../output/business-proof/e73526c1-0374-4cd4-9a84-c2a5b96f48dc/manifest.json)。16项产物的字节数与SHA-256全部复算一致。

| 场景 | 实际计划×题数 | 结构/独立跨题规则 | 运行时间（不含文件写入/渲染） | 真实模型调用/Token/API费 |
| --- | --- | --- | --- | --- |
| 儿童照护者 | 12×17 | 12/12；12/12 | 160.431625ms | 0/0/0CNY |
| 宠物零食 | 12×18 | 12/12；12/12 | 160.3655ms | 0/0/0CNY |

稳定证据SHA-256：`0ab20963e9e40ab7b56daaa9c05d87dce377718533d1f627af7100e8948e4f95`。两次独立UUID输出得到相同稳定指纹，实际执行时间和字节manifest各自保留。本批专项20/20测试通过（新增business-proof7、旧persona-proof5、survey-runner8），全项目TypeScript检查通过；旧反例未更改。以上仅为工程验收，不是真实模型/市场/人格效果验收。

首轮完整夹具原文没有改动。后续对抗审查发现1.0独立审计对空规则/缺答卷/伪结构标记存在假通过路径，因此不能沿用1.0审计器作为最新完整批次验收；下面1.1版本另存新UUID，保留上述历史产物。

## 8. 1.1审计修复后最新工程记录

最新产物：[output/business-proof/96709127-8c76-4a18-bdd6-3bdbd5755a9f](../../output/business-proof/96709127-8c76-4a18-bdd6-3bdbd5755a9f/)，可读报告：[proof-report.md](../../output/business-proof/96709127-8c76-4a18-bdd6-3bdbd5755a9f/proof-report.md)。`business-engineering-proof-1.1`明确冻结`explicit-questionnaire-logic-1.1`；16项产物SHA-256/字节数均复算一致，重复同UUID写入被EEXIST阻止，原manifest不变。

| 场景 | 计划×题数 | 结构/原文及完整分母复核后的跨题规则 | 实际运行时间 | calls/Token/API费 |
| --- | --- | --- | --- | --- |
| 儿童照护者 | 12×17 | 12/12；12/12 | 158.944667ms | 0/0/0CNY |
| 宠物零食 | 12×18 | 12/12；12/12 | 156.201666ms | 0/0/0CNY |

每场景未知意向3、不购买3、预算null6/零值3；儿童本人口味仍12份null。稳定证据hash为`084414386cb8e0b06fadf98cba232f592a77ad7b79227d579c3cad8a73511f30`，与首轮不同，因为现在纳入独立审计器版本；不表示答卷被改成真人证据。相同seed/同审计器跨UUID稳定复现通过。

专项22/22通过：business-proof9、旧persona-proof5、survey-runner8；TypeScript全通过。新增反例包括空规则/空答题、只伪造structureValid、删除/重复/孤立答卷、计划分母造假及原文不匹配。输入安全检查使用精确已知凭据检测，普通Bearer教材术语不被误拒；输出仍保守脱敏。仍然不升级真实模型、人格或经营效果门限。
