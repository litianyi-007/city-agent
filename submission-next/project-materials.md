# City Agent：公开评审申报材料

体验入口：https://litianyi-007.github.io/city-agent/

CITY AGENT / 公开评审发布版 · 01

## City Agent：可追溯的虚拟社会调查
  人口证据 × 五层情景居民
真实LLM调查测试轮与工程夹具分账
  

### 真实测试已执行；首批质量门限未通过，不扩样、不伪装成功
  项目体验入口[https://litianyi-007.github.io/city-agent/](https://litianyi-007.github.io/city-agent/)

[完整申报PDF](project-materials.pdf) · [新增真实测试轮](live-proof/report.md) · [4分33秒实际UI录屏](demo-next.mp4)

公开评审发布版；待部署后核验公网。无需Key可看来源、旧实验、零费用工程示例；真实新请求需要自行配置Key和明确预算。完整Harness及规划执行在本机。


  本次授权API尝试 7 次；确认上游请求7，有已报告usage的响应7，不使用mock规则回答。受访者仍是合成居民，不是滨江真人。每场景计划10人，失败/未启动保留在分母。


  
| 重点验收材料 | 可追溯交付 | 
| --- | --- |

| 来源、人群与角色构建 | 官方统计原件；五层假设与未知；画像、资格、Prompt冻结 | 
| 问卷及结果自证 | 两套固定17/18题真实LLM测试轮；另列12人规则夹具与历史负例 | 
| 技术及业务数据 | Harness、模型、抽样、参数、Token和保守费用；unknown不填0 | 
| 体验、视频、创新与价值 | 公开入口、安装指南、4:33实际UI录屏、补采与假设压力测试 | 


  本版生成2026-10-07T12:40:45.613Z；原15页候选与旧Tag保持不动。不是比赛正式提交回执。源码固定ref、上线可达性以独立发布记录为准；录屏是之前零费用UI演示，不冒充此次付费API实录。


CITY AGENT / 公开评审发布版 · 02

## 新增重点：真实LLM虚拟社会调查测试轮
  执行：real-api-synthetic-residents；mockUsed=false；模型deepseek / deepseek-flash；Base URL https://api.deepseek.com；DeepSeek Harness 0.1.5-rc.3。每个画像独立请求，不能看其他答卷；共享模型仍可能相关。


  
| 场景 | 计划 | 请求 | 未启动 | 结构/计划 | 跨题/计划 | 资格/计划 | 联合/计划 | 
| --- | --- | --- | --- | --- | --- | --- | --- |

| 小学照护者 · 17题 | 10 | 1 | 9 | 0/10 | 0/10 | 0/10 | 0/10 | 
| 宠物采购者 · 18题 | 10 | 2 | 8 | 1/10 | 1/10 | 1/10 | 1/10 | 


  
| 场景 | 结构失败/无效 | 居民调用耗时 | 输入 / 输出Token | 居民保守费用 | 10人门限 | 
| --- | --- | --- | --- | --- | --- |

| 小学照护者 · 17题 | 1 | 2.53秒 | 2701 / 289 | ¥0.007714 | 未满足 | 
| 宠物采购者 · 18题 | 1 | 4.94秒 | 5609 / 574 | ¥0.015810 | 未满足 | 


  全部居民、规划与CORS授权尝试合计7/24；确认上游请求7；已知usage响应7。授权预留次数不等于全部成功发出；realModelCalls is conservative authorization/model-attempt count, not successful inference count; confirmed transport and reported-usage responses are separate. CORS failures may never forward a POST.。已报告输入15418、输出6881，合计22299Token（usage=reported；缺失部分不作0）。已报告用量保守估价¥0.085884；承诺预留¥0.085884；授权总上限¥5。预算状态=closed；停止原因=无。


  登记到证据冻结39.00秒，包含居民、规划与浏览器检查，不是纯模型推理时间。单价按已核验官方高峰非缓存输入2/输出8元/百万Token；不计缓存/谷价优惠，不是供应商账单。


  

### 抽样、Prompt与停止规则seed=20261007；四情景覆盖3/3/2/2，无总体权重。居民maxOutputTokens=3000，timeout=90000ms，concurrency=1，retries=0，answerCache=false，temperature/providerSeed未设置，thinking disabled。所有五层为assumption，儿童本人原文未采集时必须null。


  首份结构、登记跨题或资格冲突停止该场景；预算/usage/网络/存储不确定停止后续授权请求。不补答、不替换居民、不重试、不换模型、不充值；未通过10/10时不得自动扩30人。


  结构失败/无效数量与跨题冲突是不同口径；上表全部以10个预登记画像为分母。真实API验证模型工程质量，不证明真实消费者偏好、五层贡献或选址。[逐次预留/结算](live-proof/budget-ledger.json) · [预登记协议](live-proof/plan.json) · [定价来源](live-proof/pricing-source.json)


CITY AGENT / 公开评审发布版 · 03

## 自然规划候选、负结果与24项真实轮附件
  自然语言规划请求与实际固定问卷分列：规划候选不自动替换本次17/18题问卷，也不认证现实选址或人格有效性。


  
| 自然语言规划 | 实际状态 | 边界/失败 | 
| --- | --- | --- |

| 小学照护者 · 17题 | failed | [
  {
    "code": "invalid_union",
    "errors": [],
    "note": "No matching discriminator",
    "discriminator": "type",
    "options": [
      "single",
      "multiple",
      "scale",
      "number",
      "text"
    ],
    "path": [
      "task",
      "questionnaire",
     | 
| 宠物采购者 · 18题 | failed | [
  {
    "code": "invalid_union",
    "errors": [],
    "note": "No matching discriminator",
    "discriminator": "type",
    "options": [
      "single",
      "multiple",
      "scale",
      "number",
      "text"
    ],
    "path": [
      "task",
      "questionnaire",
     | 


  
| 浏览器检查 | 结果 / HTTP / finishReason | 分母与能力边界 | 
| --- | --- | --- |

| 小学照护者 · 17题 | completed / 200 / stop | 实际Pages origin协议/CORS；重复首画像，不计独立居民，不等于新版页面全流程。 | 
| 宠物采购者 · 18题 | completed / 200 / stop | 实际Pages origin协议/CORS；重复首画像，不计独立居民，不等于新版页面全流程。 | 


  

### 负结果不修补
- 小学照护者 · 17题：resident-001：答卷值违反题目契约：past-categories；原始raw无法通过答题结构复核：答卷值违反题目契约：past-categories；上游答卷状态为invalid，不计独立审计通过。；答题结构无法复核：必答题缺失：eligibility；答卷结构/状态未通过，不算资格核对通过。；资格回答未与明确照护小学假设一致；不替换样本。；未采集儿童原文，应明确null；不事后修补。 [raw原文](live-proof/child-snacks/raw-responses.json) · [全部规则问题](live-proof/child-snacks/logic-audit.json)。
- 宠物采购者 · 18题：resident-002：答卷值违反题目契约：past-snack-categories；原始raw无法通过答题结构复核：答卷值违反题目契约：past-snack-categories；上游答卷状态为invalid，不计独立审计通过。；答题结构无法复核：必答题缺失：pet-type；答卷结构/状态未通过，不算资格核对通过。；猫犬资格回答与画像明确属性不一致。；采购参与回答未与已赋资格一致。 [raw原文](live-proof/pet-snacks/raw-responses.json) · [全部规则问题](live-proof/pet-snacks/logic-audit.json)。
  

### 全部真实轮附件（独立于夹具与历史实验）[report.json](live-proof/report.json) · [report.md](live-proof/report.md) · [plan.json](live-proof/plan.json) · [budget-ledger.json](live-proof/budget-ledger.json) · [pricing-source.json](live-proof/pricing-source.json) · [planning-child.json](live-proof/planning-child.json) · [planning-pet.json](live-proof/planning-pet.json) · [cors-checks.json](live-proof/cors-checks.json)


  小学照护者 · 17题：[questionnaire](live-proof/child-snacks/questionnaire.json) · [presets](live-proof/child-snacks/presets.json) · [survey-run](live-proof/child-snacks/survey-run.json) · [logic-audit](live-proof/child-snacks/logic-audit.json) · [qualification-audit](live-proof/child-snacks/qualification-audit.json) · [raw-responses](live-proof/child-snacks/raw-responses.json) · [statistics](live-proof/child-snacks/statistics.json) · [prompts.txt](live-proof/child-snacks/prompts.txt)

宠物采购者 · 18题：[questionnaire](live-proof/pet-snacks/questionnaire.json) · [presets](live-proof/pet-snacks/presets.json) · [survey-run](live-proof/pet-snacks/survey-run.json) · [logic-audit](live-proof/pet-snacks/logic-audit.json) · [qualification-audit](live-proof/pet-snacks/qualification-audit.json) · [raw-responses](live-proof/pet-snacks/raw-responses.json) · [statistics](live-proof/pet-snacks/statistics.json) · [prompts.txt](live-proof/pet-snacks/prompts.txt)


  下文“规则夹具”各12人问卷/结果与新真实LLM的10人计划独立分账；不将24名夹具居民混入真实样本。不计算真人置信区间/猫犬市场占比/儿童口味，不据此输出主营价位或铺位建议。所有规划失败、未知usage、未启动与原文均保留。


CITY AGENT / 公开评审发布版 · 04

## 人口来源与跨区域录入方法
  
| 观测 | 统计时点 / 分母 / 原表定位 | 可用范围 | 
| --- | --- | --- |

| 503,859常住人口；西兴143,318 / 长河168,276 / 浦沿192,265 | 2020-11-01七普；年鉴街道人口、年龄与性别表 | 历史街道框；不是2026实时坐标 | 
| 55.2 / 55.9万人 | 2024 / 2025年末公报第3页；2025为1%抽样推算 | 发布精度0.1万人；不能无条件外推旧街道结构 | 
| 家庭户165,654户；家庭户人口395,911；均值2.39 | 年鉴PDF118 / 印刷110，表1-3 | 不能推出三口之家、有小学子女或养宠 | 
| 3岁及以上教育表489,131人 | 年鉴PDF122 / 印刷114，表1-7，含在校口径 | 不能等同已获学位或当前小学生 | 
| 小学21所；38,394 / 39,949在校生 | 2024 / 2025公报第8页；分母在校生 | 不是居民儿童/家长数、招生片区或客流 | 
| 年人均可支配收入85,734 / 89,266元 | 2024 / 2025公报第8页；元/(人·年) | 不是个体税前工资/家庭收入/商品预算 | 


  

### 新区域也可复用的两本账
- 人口校准账：固定行政边界、年份、常住/户籍、单位与年龄范围；官方原件留底并记录URL、SHA-256、页表行列。
- 核对总数、单位、分母、重复来源与分类crosswalk；保留未知项，不拿转载作第二独立调查。
- 已有联合表优先；本版街道内年龄×性别仅独立性推断 infer，24个逻辑单元。未实施IPF或五层联合拟合。
- 情景覆盖账：选不同决策/生活情景，记录纳入理由、资格假设、模型和seed。目标分母缺失时不赋总体权重。
- 发布新版本前人工核验原件、差异及敏感性；记录撤销/失效，不静默更新历史画像与运行。
  [人口来源清单](population-sources.json) · [当前冻结人口包](population-pack.json) · [完整跨区方法论](methods/population-methodology.md)。

官方原件：[2020七普年鉴](sources/binjiang-census-yearbook.pdf) · [2024公报](sources/binjiang-2024-communique.pdf) · [2025公报](sources/binjiang-2025-communique.pdf)。


  fact=原表/算术事实；infer=明确联合推断；assumption=情景资格与五层设定；generated=模型回答。来源可信、统计转录正确和偏好外部效度是三个不同问题。哈希不认证现实真实性。


CITY AGENT / 公开评审发布版 · 05

## 人群构建：五层独立轴，不作DNA因果推断
  
| 层 | 可配置与未知 | 禁止自动推断 | 
| --- | --- | --- |

| 1 基础人格倾向 | Big Five：开放性、尽责性、外向性、宜人性、情绪稳定性；null为未知；0–100仅情景刻度；支持自定义描述 | 不是DNA、百分位、诊断或量表实测 | 
| 2 生长环境 | 主要照护结构；单亲/双亲/祖辈、迁居、寄宿等多选；可说明不同时间段 | 家庭标签不推出人格或商品喜好 | 
| 3 教育 | 已完成教育、在读与补充经历分别说明 | 学历不等于智力、工资或购买能力 | 
| 4 当前家庭 | 关系状态、同住组成、照护与购买/许可职责多选 | 单身≠独居；已婚≠有小学生；独居≠养猫 | 
| 5 社会分工与收入 | 就业/学习状态、职业、社会角色；收入区间附币种、周期与个人税前/家庭可支配口径 | 地区产业比例≠职业比例；收入≠零食预算 | 


  

### 科学依据与适用边界[BFI-2原作者](https://www.ocf.berkeley.edu/~johnlab/bfi.html)提供五维与15细分面向，商业使用需授权；本项目不复制其量表题项。[IPIP公共领域](https://www.ipip.ori.org/)是未来题项备选，不证明中文/儿童/滨江适用性。


  [人格遗传元分析](https://pubmed.ncbi.nlm.nih.gov/25961374/)约0.40是研究人群差异的估计，不是个体40%DNA，更不能变成agent混合系数。[HEXACO](https://hexaco.org/hexaco-inventory)为另一六维组织，不与Big Five简单拼分。


  整个五层对象在当前schema中固定 provenance=assumption。人口背景事实在独立登记中，不会因为选择预设而成为该居民真实经历。所有未知默认留空，不填“平均人格50”。


  

### 来源不能代替本地验证[Park等自报agents研究，v3](https://arxiv.org/abs/2411.10109v3)使用1,052名美国参与者的访谈/结构自报；其相对人类重测基准不是本项目准确率。[Argyle条件仿真](https://doi.org/10.1017/pan.2023.2)与[Bisbee反证](https://doi.org/10.1017/pan.2024.5)共同提示：均值相似不保证差异、相关结构或跨文化效度。当前没有滨江真人留出集。


  [12项原始来源与13项背景观测登记](persona-source-register.json) · [完整五层构建方法、许可与反证](methods/resident-construction.md)。


CITY AGENT / 公开评审发布版 · 06

## 人群Agent与研发角色：构建、抽样、冻结
  两种角色分开管理：调查居民具有目标资格、五层情景与独立模型配置；产品/研发/测试/研究员用于本机任务编排。复制预设会生成新ID，不创造真实居民或真实人口份额。


  
| 步骤 | 当前实现 | 证据边界 | 
| --- | --- | --- |

| 新增/勾选/自定义 | 五层表单、探索组合、模型Provider/Base URL/Model ID、页面输入Key、编辑/复制 | 均为情景假设，资格单独设置 | 
| 业务场景四份预设 | 每份3画像；本次小学照护者及猫/犬/共同采购者分别冻结 | 无真实养宠率/照护者总体分母 | 
| 人口与资格相交 | 18+及task/preset filters按AND校验；单元/街道/年龄/性别及资格镜像复核 | 2020宽年龄档不能识别精确18+分母 | 
| 覆盖抽样 | seed=20261007，12个画像，预设轮转；不按真实总体加权 | 样本只用于工程情景覆盖，不计算真人置信区间 | 
| 画像到Prompt | 冻结persona→profile→user prompt→raw；任务、人口、画像与规则hash可复算 | 哈希不是实际真人或供应商调用身份认证 | 
| 逐答卷独立执行 | 本机真实居民任务经Harness SDK；公网真实模式浏览器直连 | 共享模型可能相关，独立请求不等于独立真人 | 


  

### 本次五层预设摘要
| 预设 | 五层情景（完整JSON随附件） | 
| --- | --- |

| 小学生照护者 · 受雇与共同生活情景 | 受雇、与伴侣及子女同住为明确假设；没有消费偏好、品牌、预算或购买答案。 | 
| 小学生照护者 · 五层未知对照情景 | 只设目标资格，五层均保留未知，不自动填中等人格、学历、收入或消费能力。 | 
| 小学生照护者 · 退休与多代照护情景 | 退休、多代同住、照护及60岁以上均为各自明确假设，不能从年龄自动推出退休或喜好。 | 
| 小学生照护者 · 自雇与照护情景 | 自雇、共同照护与成长经历只用于上下文传递，不指定主营、价格、购买意向或网点位置。 | 


  所有预设不预写低糖偏好、猫狗主营、价格预算、品牌或铺位。五层在fixture中进入冻结Prompt，但夹具作答不读取其人格/收入等值，因此本次不能证明人格对真实作答的贡献。


  完整业务一键自证不读当前草稿/Key、不用后端SQLite、不请求供应商。可应用问卷与四份无Key预设为新草稿，但不会自动保存或启动调查；更改问卷后不可沿用原自证结论。


CITY AGENT / 公开评审发布版 · 07

## 规则夹具工程示例：小学生照护者完整问卷 · 1–9题
      面向小学生的包装零食概念；价格题统一为每20克独立包装。仅模拟问卷流程，不判断学校周边能否经营。


| 稳定ID | 题型 | 完整问题 | 选项 / 单位 / 边界 | 
| --- | --- | --- | --- |

| eligibility | single / 必答 | 本次情景中，您是否是正在照护在读小学生的成年人？这是资格自报，不是人口统计核验。 | eligible: 是（情景设定）；ineligible: 否，不应纳入此目标样本；unknown: 不知道/资格未确认 | 
| purchase-role | multiple / 必答 | 对于选定的一名小学生，您有哪些零食决策参与？无参与/不知道不能与其他项同选。 | purchaser: 实际购买；permission: 允许或限制；shared: 与其他照护者共同决定；none: 无参与；unknown: 不知道 | 
| child-evidence | single / 必答 | 本轮对孩子本人口味掌握了什么证据？本轮没有儿童直接问卷；未经核验的照护者观察不算本人回答。 | not-collected: 未采集孩子本人口味；proxy-unverified: 只有未经核验的照护者观察；unknown: 不知道 | 
| past-frequency | single / 必答 | 过去30天为选定孩子购买零食的大致次数（不含正餐）？没有记录请选不知道。 | none: 0次；one-three: 1–3次；four-eight: 4–8次；nine-plus: 9次及以上；unknown: 不知道/无记录 | 
| past-categories | multiple / 必答 | 过去30天购买过哪些零食类别？类别只用于概念测量，不代表孩子喜欢；未购买/不知道排他。 | dairy: 乳制品零食；grain: 谷物/烘焙零食；fruit: 水果类零食；candy: 糖果/巧克力；savory: 咸味膨化类；none: 未购买；unknown: 不知道 | 
| permission-factors | multiple / 必答 | 您决定是否许可时会查哪些信息？不关心/不知道排他。与孩子本人口味分开回答。 | ingredients: 成分/过敏提示；portion: 份量；traceability: 生产日期与来源；price: 价格；school-rules: 学校与家庭规定；none: 不关心上述信息；unknown: 不知道 | 
| child-own-taste | text / 可选 | 孩子本人表达的具体口味原文及采集方式。本轮未直接采集，请回答null/留空；不得根据照护者或画像编造儿童喜好。 | 文本最多500字；可选题允许null | 
| purchase-intent | single / 必答 | 未来30天是否考虑为选定孩子购买包装零食？不考虑不是态度中点。 | yes: 考虑；maybe: 需进一步了解；no: 不考虑；unknown: 不知道 | 
| monthly-budget | number / 可选 | 未来30天为选定一名小学生计划支出的零食总额。明确不考虑购买填0；预算不知道或暂未决定填null，不把未知填0。 | 0–1000 / CNY/一名选定小学生/未来30天；可选题允许null | 


      [冻结原始完整问卷JSON](business-proof/child-snacks/questionnaire.json) · [无Key五层预设](business-proof/child-snacks/presets.json)。


      本轮受访者为假设成年照护者，不直接调查儿童。许可、购买与儿童本人口味分开，未采集的儿童原文用null。


CITY AGENT / 公开评审发布版 · 08

## 规则夹具工程示例：小学生照护者完整问卷 · 10–17题
      面向小学生的包装零食概念；价格题统一为每20克独立包装。仅模拟问卷流程，不判断学校周边能否经营。


| 稳定ID | 题型 | 完整问题 | 选项 / 单位 / 边界 | 
| --- | --- | --- | --- |

| package-size | single / 必答 | 若考虑购买，单次独立包装希望是多大？这是规格概念题，不与20克价格题混用；不购买/不知道单列。 | g10: 10克；g20: 20克；g50: 50克；none: 不购买；unknown: 不知道 | 
| price-per20g | single / 必答 | 只针对20克独立包装，考虑的单包价位范围？不是主餐/大包装价格。区间左闭右开；不考虑购买选不购买。 | under3: 大于0且小于3元/20克；three-six: 3至小于6元/20克；six-ten: 6至小于10元/20克；ten-plus: 10元及以上/20克；none: 不购买；unknown: 不知道 | 
| planned-channels | multiple / 必答 | 未来计划通过哪些渠道购买？不购买/不知道排他，不能据此推导店铺客流。 | online: 线上配送；community: 社区商店；supermarket: 超市；pickup: 线上下单线下自提；none: 不购买；unknown: 不知道 | 
| travel-minutes | number / 可选 | 若考虑线下购买，为零食网点可接受的单程步行时间。单位分钟；不适用或不知道填null。 | 0–120 / 分钟/单程步行；可选题允许null | 
| reachable-streets | multiple / 必答 | 哪些街道属于您个人可到达范围？街道只是粗粒度自报，不是商业推荐、候选点或人口份额；不知道排他。 | xixing: 西兴；changhe: 长河；puyan: 浦沿；unknown: 不知道 | 
| traceability-importance | scale / 可选 | 生产日期和来源信息对您许可决定的重要性。1不重要，5非常重要；不知道/无决策参与填null。不是孩子口味分数。 | 1–5；可选题允许null | 
| purchase-barriers | multiple / 必答 | 目前阻碍购买或许可的因素？没有顾虑/不知道排他。 | allergen: 过敏与适用性未确认；rules: 学校/家庭规定未确认；price: 价位；freshness: 日期与储存；availability: 渠道不便；none: 没有顾虑；unknown: 不知道 | 
| needed-evidence | text / 可选 | 要做许可/购买决定还缺什么信息？允许认为题目无关。不得填写孩子未表达的偏好、私密身份或真实店址。 | 文本最多500字；可选题允许null | 


      [冻结原始完整问卷JSON](business-proof/child-snacks/questionnaire.json) · [无Key五层预设](business-proof/child-snacks/presets.json)。


      本轮受访者为假设成年照护者，不直接调查儿童。许可、购买与儿童本人口味分开，未采集的儿童原文用null。


CITY AGENT / 公开评审发布版 · 09

## 规则夹具工程示例：宠物零食完整问卷 · 1–9题
      猫/犬用辅助性奖励零食，不是主粮、药品或保健疗效；价格概念题统一为50克，10元/20元只为配对情景


| 稳定ID | 题型 | 完整问题 | 选项 / 单位 / 边界 | 
| --- | --- | --- | --- |

| pet-type | single / 必答 | 本次情景中家中拥有哪类宠物？资格仍是合成假设，不代表滨江比例。 | cat: 只有猫；dog: 只有犬；both: 猫和犬都有；unknown: 不知道/资格未确认 | 
| purchase-role | multiple / 必答 | 您参与家中宠物采购的哪些环节？无参与/不知道排他。 | purchaser: 实际购买；decision: 决定是否购买；shared: 共同参与采购；none: 不参与；unknown: 不知道 | 
| snack-boundary | single / 必答 | 本问卷只问辅助性奖励零食，明确不含日常主粮。您是否理解这一区别？不了解不能据此推导主粮需求。 | understood: 理解，只回答零食；needs-info: 需要先了解定义；unknown: 不知道 | 
| past-frequency | single / 必答 | 过去30天购买宠物零食次数（不含主粮）？没有记录请选择不知道。 | none: 0次；one-two: 1–2次；three-five: 3–5次；six-plus: 6次及以上；unknown: 不知道/无记录 | 
| past-snack-categories | multiple / 必答 | 过去30天购买哪些宠物零食？猫条/犬用条按明确适用物种区分；未购买/不知道排他，不含主粮。 | cat-creamy: 猫用猫条；dog-chew: 犬用磨牙零食；freeze-dried: 适用物种明确的冻干零食；training: 适用物种明确的训练奖励；none: 未购买；unknown: 不知道 | 
| purchase-intent | single / 必答 | 未来30天是否考虑为家中宠物购买零食（不含主粮）？ | yes: 考虑；maybe: 需进一步了解；no: 不考虑；unknown: 不知道 | 
| monthly-budget | number / 可选 | 未来30天家中宠物零食的计划总额，明确不考虑购买填0；不知道/暂未决定填null。不是主粮预算、个人收入或滨江均值。 | 0–2000 / CNY/一个情景家庭/未来30天/仅宠物零食；可选题允许null | 
| package-size | single / 必答 | 考虑购买时偏好的单包规格？价格题固定为50克，其他规格不直接比较价格。 | g15: 15克；g50: 50克；g100: 100克；none: 不购买；unknown: 不知道 | 
| price-per50g | single / 必答 | 只针对50克零食的考虑价位？区间左闭右开；不含主粮，未给定真实品牌或价格行情。 | under10: 大于0且小于10元/50克；ten-twenty: 10至小于20元/50克；twenty-forty: 20至小于40元/50克；forty-plus: 40元及以上/50克；none: 不购买；unknown: 不知道 | 


      [冻结原始完整问卷JSON](business-proof/pet-snacks/questionnaire.json) · [无Key五层预设](business-proof/pet-snacks/presets.json)。


      对象是宠物辅助零食，不是猫粮/狗粮主粮。规格统一为50克再比较价格；物种、采购角色和网上履约分别测量。


CITY AGENT / 公开评审发布版 · 10

## 规则夹具工程示例：宠物零食完整问卷 · 10–18题
      猫/犬用辅助性奖励零食，不是主粮、药品或保健疗效；价格概念题统一为50克，10元/20元只为配对情景


| 稳定ID | 题型 | 完整问题 | 选项 / 单位 / 边界 | 
| --- | --- | --- | --- |

| planned-channels | multiple / 必答 | 未来可能通过哪些渠道购买零食？不购买/不知道排他，不代表实际订单。 | online: 线上配送；pet-shop: 宠物店；veterinary: 有相关商品的宠物诊疗机构；community: 社区销售点；pickup: 线上下单线下自提；none: 不购买；unknown: 不知道 | 
| online-handoff | single / 必答 | 若线上下单，如何接收更适用？本轮不推断履约成本或销量。 | pickup: 线下自提；delivery: 配送；both: 两者都可；none: 不购买/不适用；unknown: 不知道 | 
| travel-minutes | number / 可选 | 为线下零食网点可接受的单程步行时间？仅配送/不购买/不知道填null。 | 0–120 / 分钟/单程步行；可选题允许null | 
| reachable-streets | multiple / 必答 | 您个人可到达的街道有哪些？只是粗粒度假设，不是推荐区域/真实订单密度；不知道排他。 | xixing: 西兴；changhe: 长河；puyan: 浦沿；unknown: 不知道 | 
| purchase-barriers | multiple / 必答 | 购买零食有哪些障碍？没有顾虑/不知道排他。 | suitability: 物种/个体适用性未确认；ingredients: 成分与安全资料；freshness: 日期与储存；price: 价位；traceability: 来源可追溯性；none: 没有顾虑；unknown: 不知道 | 
| price10-intent | single / 必答 | 仅在适用性和资料均确认的假设下，50克辅助零食10元/包是否考虑？价格为实验设定，不是行情；总体不考虑购买应选不考虑。 | yes: 考虑；maybe: 仍需了解；no: 不考虑；unknown: 不知道 | 
| price20-intent | single / 必答 | 假设与上一题商品和资料相同，仅50克价格改为20元/包是否考虑？同一答卷条件追问，不是随机控价实验；总体不考虑购买应选不考虑。 | yes: 考虑；maybe: 仍需了解；no: 不考虑；unknown: 不知道 | 
| traceability-importance | scale / 可选 | 商品来源资料对这次采购决定的重要性？1不重要，5非常重要；不知道填null。不是宠物健康诊断。 | 1–5；可选题允许null | 
| needed-evidence | text / 可选 | 决定购买还缺什么证据？可回答无关或不知道，不编造网点、真实订单、品牌功效或市场份额。 | 文本最多500字；可选题允许null | 


      [冻结原始完整问卷JSON](business-proof/pet-snacks/questionnaire.json) · [无Key五层预设](business-proof/pet-snacks/presets.json)。


      对象是宠物辅助零食，不是猫粮/狗粮主粮。规格统一为50克再比较价格；物种、采购角色和网上履约分别测量。


CITY AGENT / 公开评审发布版 · 11

## 规则夹具工程示例：小学照护者结果 · synthetic工程数表
    run ID：618aad82-7fef-46b1-8f38-1499e9f2c9e8
17题×12画像；结构有效12/12，登记跨题规则通过12/12。模型调用0；input/output Token各0；API费用¥0（不含本机计算）。执行耗时158.945ms，不含文件写入、页面渲染和录屏。


    
| 题ID | 非null分母 / 12；缺失 | 确定性结果（非市场偏好） | 
| --- | --- | --- |

| eligibility | 12/12；0 | 是（情景设定）=12；否，不应纳入此目标样本=0；不知道/资格未确认=0 | 
| purchase-role | 12/12；0 | 实际购买=6；允许或限制=3；与其他照护者共同决定=6；无参与=0；不知道=3 | 
| child-evidence | 12/12；0 | 未采集孩子本人口味=12；只有未经核验的照护者观察=0；不知道=0 | 
| past-frequency | 12/12；0 | 0次=3；1–3次=0；4–8次=6；9次及以上=0；不知道/无记录=3 | 
| past-categories | 12/12；0 | 乳制品零食=0；谷物/烘焙零食=6；水果类零食=6；糖果/巧克力=0；咸味膨化类=0；未购买=3；不知道=3 | 
| permission-factors | 12/12；0 | 成分/过敏提示=9；份量=0；生产日期与来源=0；价格=0；学校与家庭规定=9；不关心上述信息=0；不知道=3 | 
| child-own-taste | 0/12；12 | 逐份原文或null见附件 | 
| purchase-intent | 12/12；0 | 考虑=3；需进一步了解=3；不考虑=3；不知道=3 | 
| monthly-budget | 6/12；6 | 均值40.00；中位数40.00；CNY/一名选定小学生/未来30天 | 
| package-size | 12/12；0 | 10克=0；20克=6；50克=0；不购买=3；不知道=3 | 
| price-per20g | 12/12；0 | 大于0且小于3元/20克=0；3至小于6元/20克=6；6至小于10元/20克=0；10元及以上/20克=0；不购买=3；不知道=3 | 
| planned-channels | 12/12；0 | 线上配送=6；社区商店=0；超市=0；线上下单线下自提=6；不购买=3；不知道=3 | 
| travel-minutes | 6/12；6 | 均值15.00；中位数15.00；分钟/单程步行 | 
| reachable-streets | 12/12；0 | 西兴=4；长河=4；浦沿=1；不知道=3 | 
| traceability-importance | 9/12；3 | 均值4.33；中位数4.00；分 | 
| purchase-barriers | 12/12；0 | 过敏与适用性未确认=3；学校/家庭规定未确认=0；价位=3；日期与储存=6；渠道不便=0；没有顾虑=0；不知道=3 | 
| needed-evidence | 9/12；3 | 逐份原文或null见附件 | 


    每场景不购买3份、未知意向3份；预算明确0有3份、未知/未定null有6份。“不知道”选项计入非null答卷但在数表中单列；多选总数可以大于分母。数值统计不把null填0。


    [画像、Prompt与完整raw](business-proof/child-snacks/survey-run.json) · [独立跨题审计](business-proof/child-snacks/logic-audit.json) · [完整街道/预设分组统计](business-proof/child-snacks/statistics.json)。


    儿童本人口味12/12为null；不能把家长许可当作“滨江孩子爱吃谷物/水果”的结论。


CITY AGENT / 公开评审发布版 · 12

## 规则夹具工程示例：宠物零食结果 · synthetic工程数表
    run ID：0ccc5e41-4a46-45fe-8486-40f3f77d1b64
18题×12画像；结构有效12/12，登记跨题规则通过12/12。模型调用0；input/output Token各0；API费用¥0（不含本机计算）。执行耗时156.202ms，不含文件写入、页面渲染和录屏。


    
| 题ID | 非null分母 / 12；缺失 | 确定性结果（非市场偏好） | 
| --- | --- | --- |

| pet-type | 12/12；0 | 只有猫=6；只有犬=3；猫和犬都有=3；不知道/资格未确认=0 | 
| purchase-role | 12/12；0 | 实际购买=6；决定是否购买=3；共同参与采购=6；不参与=0；不知道=3 | 
| snack-boundary | 12/12；0 | 理解，只回答零食=9；需要先了解定义=0；不知道=3 | 
| past-frequency | 12/12；0 | 0次=3；1–2次=6；3–5次=0；6次及以上=0；不知道/无记录=3 | 
| past-snack-categories | 12/12；0 | 猫用猫条=3；犬用磨牙零食=2；适用物种明确的冻干零食=4；适用物种明确的训练奖励=3；未购买=3；不知道=3 | 
| purchase-intent | 12/12；0 | 考虑=3；需进一步了解=3；不考虑=3；不知道=3 | 
| monthly-budget | 6/12；6 | 均值60.00；中位数60.00；CNY/一个情景家庭/未来30天/仅宠物零食 | 
| package-size | 12/12；0 | 15克=0；50克=6；100克=0；不购买=3；不知道=3 | 
| price-per50g | 12/12；0 | 大于0且小于10元/50克=0；10至小于20元/50克=6；20至小于40元/50克=0；40元及以上/50克=0；不购买=3；不知道=3 | 
| planned-channels | 12/12；0 | 线上配送=6；宠物店=0；有相关商品的宠物诊疗机构=0；社区销售点=0；线上下单线下自提=6；不购买=3；不知道=3 | 
| online-handoff | 12/12；0 | 线下自提=0；配送=0；两者都可=6；不购买/不适用=3；不知道=3 | 
| travel-minutes | 6/12；6 | 均值15.00；中位数15.00；分钟/单程步行 | 
| reachable-streets | 12/12；0 | 西兴=4；长河=4；浦沿=1；不知道=3 | 
| purchase-barriers | 12/12；0 | 物种/个体适用性未确认=3；成分与安全资料=0；日期与储存=6；价位=3；来源可追溯性=0；没有顾虑=0；不知道=3 | 
| price10-intent | 12/12；0 | 考虑=3；仍需了解=3；不考虑=3；不知道=3 | 
| price20-intent | 12/12；0 | 考虑=0；仍需了解=6；不考虑=3；不知道=3 | 
| traceability-importance | 9/12；3 | 均值4.33；中位数4.00；分 | 
| needed-evidence | 9/12；3 | 逐份原文或null见附件 | 


    每场景不购买3份、未知意向3份；预算明确0有3份、未知/未定null有6份。“不知道”选项计入非null答卷但在数表中单列；多选总数可以大于分母。数值统计不把null填0。


    [画像、Prompt与完整raw](business-proof/pet-snacks/survey-run.json) · [独立跨题审计](business-proof/pet-snacks/logic-audit.json) · [完整街道/预设分组统计](business-proof/pet-snacks/statistics.json)。


    本轮猫/犬情景数量为人为覆盖，不是猫狗真实占比；10/20元追问不是随机价格试验，不能确定现实主营品类与价位。


CITY AGENT / 公开评审发布版 · 13

## 历史真实模型实验：独立口径与负结果
  旧里程碑真实实验用于证明模型问卷链路曾经运行，不证明这两套新业务问卷或五层人格有效。旧15题AI会员案例、原始参数、失败与SDK记账勘误保持原样。


  冻结模型：deepseek / deepseek-flash / https://api.deepseek.com。maxOutputTokens=3000；timeoutMs=90000；concurrency=1；retries=0；answerCache=false；temperature/providerSeed未设置；thinking disabled。参数声明不是独立底层权重认证。


  
| 实验 | 记录 | 解释 | 
| --- | --- | --- |

| 真实基准12×15 | 12/12有效；12调用；26.45秒 | 合成一般成年居民；不是家长/宠物新问卷 | 
| 真实基准usage与费用 | 24794输入 + 3922输出 = 28716Token；估算¥0.080964 | 历史用户单价CNY2/8每百万Token；非当前价格或账单 | 
| 当前49次居民实验 | 44有效、5无效；84,916输入 / 13,120输出；估算¥0.274792 | 不含早期尝试/研发角色；不可与新fixture合并算通过率 | 
| 重复五次的3画像 | 有效率5/5、1/5、3/5；仅1/3达到4/5诊断 | 不稳定性保留，不能宣称普遍一致 | 
| 独立19→29元价格条件 | 3人条件：1/3→2/3 | 小样本负向/反直觉结果；不是涨价促进真实销量 | 
| 早期14批 / 51调用 | SDK缓存输入与中断usage存在缺失；全量成本未知 | 保留原文与勘误，不回填0 | 
| 四角色自动开发 | 历史6次真实最终Gate均失败 | L4/L5仍另一分支推进，不冒充本题已成功交付 | 


  旧五层16题夹具存在两份“选择不购买却有正预算”反例（resident-005 / 009）。[旧16题完整raw与统计](historical/persona-proof/survey-run.json)与[原自证说明](methods/old-persona-proof.md)随包保留。本次以新policy/问卷/UUID建立新工程样例，未篡改或删除旧反例。本次工程规则通过不能覆盖历史模型无效答卷。


  [旧真实12人证据](historical/live-run.json) · [全部当前实验](historical/experiment-runs.json) · [早期尝试与记账勘误](historical/prior-attempts.json) · [历史成本范围](historical/metrics.json)。


  新增真实LLM首批测试轮见前页与live-proof：未通过、未启动均保留。30人完整率、异构稳健性、五层消融和真人/交易留出仍未执行，不能以夹具12/12代替。


CITY AGENT / 公开评审发布版 · 14

## 技术点、参数与安全边界
  
| 项 | 实现 / 本轮关键参数 | 
| --- | --- |

| 执行底座 | 本机DeepSeek Harness SDK 0.1.5-rc.3，锁文件安装，无全局dsh/GPU要求；公网浏览器直连不是Harness | 
| 模型身份 | 每人Provider/Base URL/Model ID独立；selector记录非权重指纹。新fixture modelId=fixture-no-model，无实际请求 | 
| 本次工程参数 | 固定count=12；seed=20261007；四情景轮转；无答案缓存/重试；显式fixturePolicyId；0付费调用 | 
| Prompt | system与逐人user原文/hash随附件冻结；人口、资格、五层假设与问卷各有血缘 | 
| 回答校验 | 五题型、题目/选项ID、必答、数值边界、空白文本、资格AND；raw到answers/summary重算 | 
| 独立业务逻辑 | 互斥选项；不购买→预算0/无渠道；未知→null；无儿童直接证据→口味null；猫犬品类约束；只检查登记规则 | 
| 安全修复 | Provider/Base URL变化清旧Key；规划入/出Unicode脱敏；已知凭据不能写公开元数据；严格预设导入 | 
| 导入与评分 | 校验sampling/structural/coherence/populationAudit不信任展示字段；独立verification版本，不改原raw/version | 
| 预算与成本 | 真实任务显式确认并设调用/Token预算；usage/单价缺失为null。工程API费用0不等于本机计算免费 | 


  Key仅在页面模型配置栏输入；本机加密存储仍需保护同机密钥文件。Pages Key仅当前内存会话，刷新清除；公开元数据不保存Key。跨域供应商可能拒绝浏览器调用，此时改走本机Harness，不关浏览器安全。


  复算器拒绝空审计假通过、缺失/重复答卷或伪造结构标志。规则合法不等于全面语义认证，prompt/raw一致也不认证真人身份。新业务完整proof另存IndexedDB，刷新后使用原规则复核，而非套用当前规则。


CITY AGENT / 公开评审发布版 · 15

## 验收门限、现实缺口与后续能力
  
| 层次 | 门限 | 状态 | 
| --- | --- | --- |

| 工程业务自证 | 两场景各12/12结构和显式逻辑；0请求；raw/统计/hash可复算；未知与不购买保留 | 本轮满足；只证明工程 | 
| 真实模型完整率 | 预登记10人冒烟→单批30人≥29有效，所有计划居民为分母且遵守预登记阈值 | 首批真实轮见前页；30人未执行，live API当前最多12 | 
| 内部语义与稳健性 | 盲评、措辞/题序/seed/重复/异构模型与简单基线，报告差异和失败 | 预登记工具完成；新五层贡献未验 | 
| 儿童口味与选址 | 独立儿童合意/監护授权、资格分母、候选点/客流/规则/预算试售 | needs-data；只做成年人情景 | 
| 宠物网点与价位 | 养宠及零食购买者分母、匿名订单密度、统一SKU规格、租金/履约/毛利/试售 | needs-data；不输出主粮比例 | 
| 现实外部效度 | 合法独立真人/交易留出；总体与分组误差及相对简单基线 | 未获得本地验证资料 | 
| 发布与申报 | 候选端到端验收后发布固定ref；正式入口与回执留档 | 用户已批准公开评审发布；待部署后核验，不移动旧Tag | 


  

### 明确作为规划提交的能力仿Chainlink的“现实桥”思路采用MCP数据适配，不要求使用区块链：来源/地区/时点绑定、候选版本、人工核验、失效/撤销与历史重放。只将可追溯外部观测映射到群体，不把生成答案回流成事实。


  居民/城市/项目记忆隔离，kata wiki/dream用于摘要和重估；dream不得改写事实或制造真实经历。有限自主接管需轮次/Token/工具权限与串话边界。家庭社交演化、IPF联合拟合均未实施，列为下一阶段。


  L4/L5自动开发与虚拟社会分别在独立worktree/branch推进；共享契约是冻结研究证据manifest，不让另一目标的失败或承诺混入本题成功指标。


CITY AGENT / 公开评审发布版 · 16

## 评委操作、安装与创新 / 业务价值
  

### 三分钟可完成的零费用操作
- 本候选打开调查页→“完整业务示例 · 零费用体验”。选择小学或宠物17/18题问卷。
- 点“运行完整业务自证 · 0 API费用”；回查12人、未知、分母、原始答卷与逻辑规则。
- 导出完整自证并刷新，通过历史恢复原规则与答卷。应用示例到草稿只创建无Key预设，不自动调用。
- 查看人口来源与旧真实实验；配置真实Key后另行显式预算确认。无Key也能完成上述流程。
  

### 本机Harness准备Git、Node22.22.3（项目实测；最低22.19.0）、npm下载网络。无需本地GPU、模型权重或全局dsh。随报告另交city-agent-review-source.zip：解压到新目录并检查SOURCE-SNAPSHOT.json字节清单，再执行下列命令。安装源码以本次独立发布记录的固定Git ref/源码快照为准；不把本地工作树当成已公开版本。

npm ci
npm run setup
npm run build
npm run doctor
npm run start:review
# http://127.0.0.1:4320/#research
  macOS本机已工程实测，Windows/Linux干净机器未验；网络/Chromium/共享库/端口异常详见[安装与故障指南](methods/judge-quickstart.md)。旧公开Tag只有npm start与4310，不具新增doctor/start:review。


  

### 创新点与业务价值① 把人口校准与情景覆盖分账，展示事实、推断、假设及生成结果的不同可信边界。② 将五层配置、资格、Prompt、raw与成本连接成可回查链。③ 让未知/不购买/矛盾/失败成为可见结果，而非补成成功。④ 将自然语言候选、业务证据缺口与跨题规则接入同一前测流程。

业务价值是减少遗漏资格/口径、改善问卷与补采优先级，支持可重复的假设压力测试。尚无真人准确率、ROI或销量增益证据，不承诺替代现实调研、直接推荐铺位或无人研发成功。


  [新版实际浏览器录屏（约4分钟，画面字幕）](demo-next.mp4)；录屏不输入Key、不假演实时模型调用。


CITY AGENT / 公开评审发布版 · 17

## 来源、附件与评审复算入口
  官方统计源见[人口来源清单](population-sources.json)；2020年鉴、2024/2025公报原PDF保留于旧公开材料。2024发布日期未核齐，维持未知。科学来源登记含访问范围、许可和不支持的推断：


- bfi2-author-2017 · [Big Five Inventory / BFI-2 — author materials and FAQ](https://www.ocf.berkeley.edu/~johnlab/bfi.html)
Author FAQ queried 2026-10-07; cites Soto and John 2017 BFI-2 research
- hexaco-author-materials · [HEXACO-PI-R materials, scale descriptions and inventory history](https://hexaco.org/hexaco-inventory)
Current author materials; history cites Lee and Ashton 2004 facet scales and Ashton and Lee 2009 short form
- ipip-author-public-domain · [International Personality Item Pool official website](https://www.ipip.ori.org/)
Project launched 1998; current official site queried 2026-10-07
- personality-heritability-vukasovic-2015 · [Heritability of personality: A meta-analysis of behavior genetic studies](https://pubmed.ncbi.nlm.nih.gov/25961374/)
Psychological Bulletin 141(4), 769–785; PMID 25961374
- park-generative-agents-2023-v2 · [Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442v2)
arXiv:2304.03442v2, revised 2023-08-06
- park-self-report-agents-2026-v3 · [LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals](https://arxiv.org/abs/2411.10109v3)
arXiv:2411.10109v3, revised 2026-06-28; earlier title Generative Agent Simulations of 1,000 People
- argyle-silicon-sampling-2023 · [Out of One, Many: Using Language Models to Simulate Human Samples](https://doi.org/10.1017/pan.2023.2)
Political Analysis 31(3), 337–351
- bisbee-synthetic-survey-risks-2024 · [Synthetic Replacements for Human Survey Data? The Perils of Large Language Models](https://doi.org/10.1017/pan.2024.5)
Political Analysis 32(4), 401–416
- ye-joint-population-synthesis-2017 · [Population Synthesis Based on Joint Distribution Inference Without Disaggregate Samples](https://www.jasss.org/20/4/16.html)
Journal of Artificial Societies and Social Simulation 20(4), 16
- binjiang-census-2020 · [2020年度统计年鉴 — 第七次人口普查人口、家庭户及教育表](https://www.hhtz.gov.cn/art/2021/11/30/art_1229574517_3974310.html)
2020 census reference date 2020-11-01; 2020 yearbook published 2021
- binjiang-communique-2024-persona-context · [2024年高新区（滨江）国民经济和社会发展统计公报](https://zjjcmspublic.oss-cn-hangzhou-zwynet-d01-a.internet.cloud.zj.gov.cn/jcms_files/jcms1/web2945/site/attach/0/956d1f5516ba4fd9b13c1efa6dc17ed4.pdf)
2024 preliminary statistics; no publication date inferred from PDF metadata or search recency
- binjiang-communique-2025-persona-context · [2025年高新区（滨江）国民经济和社会发展统计公报](https://www.hhtz.gov.cn/col/col1229574514/art/2026/art_d79bffcf95f24e619178dd3acfaee081.html)
2025 preliminary report; resident population estimated using 2025 1% population sample survey
  

### 附件索引[规则夹具自证总账](business-proof/business-proof.json) · [业务附件16项字节哈希](business-proof/manifest.json) · [本轮工程核验日志](verification.json) · [申报候选全包manifest](manifest.json)。

各场景含questionnaire、presets、survey-run、raw-responses、statistics、logic-audit与prompts；历史目录保留旧真实实验、usage与勘误。录屏仅展示实际UI操作，字幕是说明叠加，不是系统返回。


  材料生成不是正式比赛提交回执。公开评审版附件指向/submission-next，待部署后统一核验；离线ZIP的index.html可相对打开。旧Tag/旧submission与原15页候选保留；评审须对齐独立发布记录中的源码、Demo、材料与录屏版本。

