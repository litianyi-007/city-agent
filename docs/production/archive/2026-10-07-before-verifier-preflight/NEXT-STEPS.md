# 自主软件生产任务清单

当前切片 VE-02/03 已实现：[注入执行器与独立账本](VERIFIER-STUDY-CONTRACT.md)，免费测试覆盖持久化先于调用、相同输入新调用、迟到结果不可改终态和全部决策先于 Oracle。下一顺序为 VE-04 真实 transport/配置/预算冻结，再做 VE-05/06 收费对照；不自动启动54意图评测。旧 Phase-1 的两条意见[交接](REVIEW-CONTRACT-HANDOFF.md)给虚拟社会线，本线未改其目录。本次[留底](archive/2026-10-07-before-verifier-study/NEXT-STEPS.md)。

最新增量：VE-01免费[18池/36候选准备](VERIFIER-CHALLENGE-CORPUS.md)已完成，统一实际Oracle36/36标签一致、116.390秒、0模型请求，原件见[VERIFIER-PREP-01](experiments/VERIFIER-PREP-01/RESULT.md)。三DEV池仍不计正式集。下一免费任务VE-02/03：三策略study adapter与预算/intent/unknown/取消/重启注入验证；其后VE-04整批配置冻结与新预算。没有自动启动54意图收费批次，真实HTML v10、实体相机与容器各自单独验收。本次[留底](archive/2026-10-07-before-verifier-corpus/NEXT-STEPS.md)。

## 申报后当前状态与执行顺序

用户已完成申报。最新进度、任务与evaluation门限见 [申报后开发清单](POST-SUBMISSION-PLAN.md)。六角色配置、Verifier/Jev、冻结验收、预算/取消与三个工程Mock已实现；CAMERA-09首次真实有界场景Gate通过，01～09不同配置探索/完整摄像头需求分别统计，不称稳定成功率。

公共首屏、紧凑输出/语义预检、原生JSON、09真实场景闭环及v5发布已完成。HTML-01已真实执行并失败；下一顺序为免费修补HTML执行事实/返修评审上下文/启动身份 → 新版本HTML真实探索 → 用户主动实体摄像头验收 → Verifier同条件效益对照 → 容器及受控仓库 → 固定配置泛化实验。三DEV池免费Oracle准备与正式18池/收费模型对照分列。本分支六角色Key已由用户配置，不迁移别线；新增真实执行先冻结该实验与预算。[HTML01结果](experiments/HTML-01/RESULT.md)、[v5发布](PUBLICATION-V5-2026-10-07.md)，[本次更新前留底](archive/2026-10-07-before-html01/NEXT-STEPS.md)。

上述免费修补已480/38项通过，HTML02按新预登记/干净boot实际探索一次并在研究JSON阶段失败；原始结果见[HTML02](experiments/HTML-02/RESULT.md)。本批推进[语法诊断/反馈](BATCH-HTML02-CHECKS.md)和[仓库准备契约](REPOSITORY-PREPARATION.md)，不自动追加付费或启用系统容器。接下来的免费重点是Verifier正式候选/Oracle与执行器契约；新真实任务、实体相机、收费效益实验及容器准备按各自预算/权限确认，不以Mock冒充。本次[旧文留底](archive/2026-10-07-before-html02/NEXT-STEPS.md)。

下文第一批框架保留作为任务背景；修改前原文 [留底](archive/2026-10-07-before-onboarding/NEXT-STEPS.md)。本批优先免费工程验证和独立production静态入口，不把演练记为自主交付。

第一批围绕单 HTML 可运行切片推进，不等待任意仓库平台。用户已批准三个模拟需求和高性价比调用方向；本分支仍需页面配置新的模型与 Key。

## 第一批

| ID | 任务 | 完成证据 |
| --- | --- | --- |
| AP-01 | 固定六角色职责、三个模拟需求、执行范围与验收 | DESIGN、REQUIREMENTS 和独立输入快照 |
| AP-02 | 独立配置、复制、脱敏；API、前端、预览、E2E 和数据统一隔离 | 配置/API/浏览器回归 |
| AP-03 | 产品扩展、项目经理计划、测试契约预检与冻结 | 原始角色输出、选择器预检与 hash |
| AP-04 | 所有可替换角色输出经 Verifier 审查和候选选优 | N=1/N=2、全部坏候选与非法评分反例 |
| AP-05 | 研发、实际浏览器 Gate、反馈与最多两次返修 | 每轮 Gate 及不得修改冻结检查的测试 |
| AP-06 | 逐请求证据、usage/费用、预算、取消和重启 | 原文/hash、unknown、限额与恢复测试 |
| AP-07 | 三项 MOCK 完整执行与材料包 | 源码、输入、阶段结果、Gate、日志、预测区间 |
| AP-08 | 新配置下真实模型实验 | 页面配置完成后启动；工程夹具不代替该证据 |
| AP-09 | 托管 Jev 设置、三维选优和不确定升级 | 单候选/双候选/错误/unknown/取消/密钥轮换工程反例；与真实研发分列 |
| AP-10 | 三组固定合成池真实 Jev 对照 | 外呼前冻结配置和候选 hash；全部失败、弃权、Gate 与额外费用；不泛化 |

初次真实批次采用每项 5 USD、三项合计 15 USD 的内部保守限额。用户允许无硬总额但要求性价比，并非要求无限重试。每项同时有调用、Token、时限及两次返修上限。金额取配置价格估算，不等于供应商账单。

## 后续任务

- 验证容器或等效隔离，完成路径、秘密、网络、资源与取消攻击测试；在此之前拒绝生成 Node/shell 的宿主执行。
- 扩展受控模板和仓库功能添加、Bug 修复，交付 base commit、patch、lockfile 和可复现构建。
- 固定配置预登记三类任务各三次，独立任务目录，报告全部尝试；配置变化新起实验版本。
- 将本批三组合成池对照扩展为有独立标注及代表性的候选集；加入无 Verifier/LLM/Jev cascade 的同条件成本对照，避免把低供应商价格直接称为已实测高性价比。
- 评估 AnyJev 的低风险 typed decision adapter；取得模型能力和独立标注集后才做校准。
- 补真实业务需求来源与正式 L4 参考线；公开服务或外部部署另行授权。

虚拟社会线继续负责人口、人群、调查、现实桥和记忆；本线不修改其 worktree，不合并分支。Hopper/grok-4.7 只是可选外层评审，不是内部团队验收证据。
