# 虚拟社会主线：本批交接报告（历史记录）

> 历史阶段公开副本：主体记录2026-10-07的188单测/14浏览器及五层初批工程阶段，不代表最新发布或实测状态。原文已完整留底于Git忽略的`output/review-drafts/pre-source-publication/`，这里只移除个人本机路径并明确时间范围，不回写答卷、旧评分或费用。后续真实API调查与当前发布状态见[本轮真实测试与发布审查](LIVE-REVIEW-2026-10-07.md)；合成居民不是真人研究。

日期：2026-10-07。状态：工程实现与验证，待用户验收；未合并 main、未推送 GitHub、未更新公开 Demo/申报 PDF，也未新增付费模型实验。旧里程碑截止时间、Tag、材料、原始答卷和负结果不变。

## 先看入口和材料

本批独立worktree名：`city-agent-virtual-society`，分支 `feature/virtual-society-next`，基线 `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466`。代码尚未新commit，不能让外部评委按这个本地分支安装；验收后须固定并发布新ref。

本机新版本入口：`http://127.0.0.1:4320/#research`；人群入口 `/#residents`。专用 `.city-agent-review/` 不复制旧Key/数据库，第一次真实调用需在新实例页面重新填写连接；仅打开页面或使用模拟模式不会付费。

公开旧版：[Demo](https://litianyi-007.github.io/city-agent/) / [申报材料](https://litianyi-007.github.io/city-agent/submission/index.html) / [冻结Release](https://github.com/litianyi-007/city-agent/releases/tag/submission-milestone-2026-10-07)。这些不含本批新五层能力，不能把本机工程通过称为公网已发布。

下表统一使用仓库根目录相对位置；`output/`是本机历史留底，不随源码公开：

| 产物 | 相对位置 |
| --- | --- |
| 五层方法、科学与滨江适配 | `docs/research/RESIDENT-CONSTRUCTION-METHOD.md` |
| 12项在线原始来源、13项背景观测、未知清单 | `data/research/persona-source-register.json` |
| 16题问卷、4份五层预设 | `data/research/persona-proof-questionnaire.json`、`data/research/persona-proof-presets.json` |
| 问卷/结果自证和反例说明 | `docs/research/PERSONA-PROOF.md` |
| 新自证原始答卷、Prompt、报告、manifest | `output/persona-proof/abfe1fd7-e1aa-4aba-a7ea-207088e9f14d/` |
| 评委安装、三模式和故障排查 | `docs/guides/JUDGE-QUICKSTART.md`；页面 `public/review-guide.html` |
| 任务/evaluation门限及统一后续 | `docs/SOCIETY-NEXT.md`、`docs/research/EVALUATION-NEXT.md` |
| 工程测试和交互实查 | `docs/prd/F001-society-next/F001-society-next-test.md`、`F001-society-next-ux.md` |
| 独立材料—实现审查 | `docs/prd/F001-society-next/F001-society-next-research.md` |
| 原README/架构与基线留底 | `docs/archive/2026-10-07-before-society-next/` |

`output/`产物被Git忽略，留在本机并可复现；尚未作为新申报附件发布。原milestone ZIP继续在 `output/milestones/submission-milestone-2026-10-07.zip`，未重打包。

## 两个重点的本批结果

五层保留为人格、成长、教育、当前家庭、社会分工/收入五条独立轴。第一层采用Big Five概念维度，不采用DNA固定类型：0–100为情景刻度，无真人量表/本地常模；未知不默认50。主要照护有单选摘要，经历支持单亲/双亲/祖辈等不同时期多选、迁居/大家庭及自定义；单身不等于独居，学历不推收入，区年人均可支配收入不赋成个人月薪。所有五层统一标assumption，人口锚点与资格独立。

新建/编辑/复制/重启保存、五层Prompt/画像/预设血缘、新2.1与旧2.0兼容均有工程测试。四类资格预设保留，新增五种生活情景探索组合，不把它们写成滨江真实类别/占比。官方2020/2024/2025资料按原表年份和分母分别保存，没有自动激活2025人口包或生成职业/人格/宠物联合分布。

自证为12个画像×16题、4预设×各3人、seed=20261007，五题型齐全。原运行耗时约141.56ms（执行器范围，不含渲染/持久化/导出），模型请求0，Token0，API费用0，不含本机计算成本。12/12只表示结构与已登记规则通过。生成器未读取persona决定消费答案，不能证明五层人格贡献。

原答卷保留两条明确跨题反例：resident-005不购买却预算321.91元，resident-009不购买却预算183.21元；未登记跨题规则，所以原评分仍为valid。一个必答1–5量表也未提供独立unknown，任意用户自由文字预写偏好尚无自动语义审查。材料公开这些缺口，不称“真实偏好/语义全通过”。

## 本批同时补齐的工程

自然语言候选规划：选产品/研究员连接、显式费用确认、一次Harness请求、90秒与输出6000Token上限、取消、严格schema和脱敏证据；只产生待用户应用的候选问卷，不自动执行居民。业务观测预检：导入JSON，检查来源、时点、单位、资格分母、过期/冲突/引用；不访问其中URL、自动认证来源或发布人口包。

离线完整率计划冻结模型/参数/版本及全计划ID，保留失败/未启动分母，复算Prompt、答卷、统计、Token与CNY费用；unknown不能填零。plan时间和live标签仍是自报，不认证模型账单或不可伪造预登记。规则30/30永远不升级真实30人门限。

额外修复模型原文/encoded Key旁路：公用脱敏覆盖literal/JSON/Unicode/对象键/partial/error；执行器不再展开整个返回对象当usage，运行前拒绝误粘的已知凭据。无需新依赖，未读取另一worktree配置；不承诺识别任意编码或隐蔽重组。

最终工程验证：188/188单测、14/14浏览器、本机/Pages构建、只读自检与实际启动通过。另在真实dist-pages/375px验证新建保存刷新复制、两类运行导入导出、业务needs-data、规划限本机与指南200；无新模型/外网请求/控制台错误，最后关闭4182测试服务。4320本机review服务保留供用户体验，不在公网监听。规格工作流把工程验证、用户验收和发布分开，因此本Feature仍doing，不擅自标项目完成。

## 当时建议的验收顺序（历史；当前以新计划为准）

1. 在本机4320打开人群预设，新建自定义居民，试五层、多段成长经历、自定义人格、复制与刷新；确认是不是你期望的“典型情景”，而非已恢复真实人口。
2. 导入16题自证问卷，选自己配置的情景预设，先模拟运行并导出；检查原文、历史/草稿差异和限制。当前尚无一键导入整个工程包。
3. 确认允许的新实验模型、项目与整批费用硬上限后，先做10人真实冒烟，再实现预算受控30人cohort，目标≥29/30。当前真实API仍最多12人，不能现在声称30人已验收。
4. 先登记采购/家庭/职业/跨题规则、未知/适用出口及独立盲评，再做重测/题序/措辞/异构模型；旧真实实验不能代替新五层验证。
5. 两个开店场景继续补合法资格分母、学校/候选点客流成本、匿名订单/SKU/规格/试售与现实留出。资料不足时只给研究假设和补采计划，不能给可信选址/主营比例/盈利保证。
6. 验收后固定新commit/ref、发布GitHub/Pages和新材料附录；跨OS、真实供应商CORS、L4/L5集成另验。旧Tag不移动。

现实桥MCP、映射绑定、居民长期记忆、wiki/dream与有限自主接管仍是远期，不因本批画像/证据契约而视为已实施。全部合并待办和门限统一见S01–S17，避免重复或互相矛盾的阶段清单。
