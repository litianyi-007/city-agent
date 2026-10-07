# CAMERA-05：语义预检与覆盖责任配置

预登记：2026-10-07。本记录先于本轮付费请求保存并提交。只允许一个真实启动尝试；达到终态后不自动重复收费。旧 CAMERA-01～04 原字节与负结果不变，这不是同一固定配置成功率实验。

## 输入与职责

原话保持：开发一个梦幻的圣诞树，能通过摄像头获取手势，来控制圣诞树。

沿用 CAMERA-04 的完整验收：可见粒子树、星与雪；默认关闭、显式许可、停止释放；张掌散开、握拳聚合、横移旋转；无手/许可拒绝/设备或本地模型失败状态；不保存或上传帧、Key 留控制面。来源为用户本会话的功能测试请求、非商业工单，kind=illustrative，编号独立 CAMERA-05。把此前用户明确的映射作为初始结构化约束填写：cameraBusinessConstraints={openPalm:"scatter",closedFist:"gather",palmX:"rotate"}；不是启动后的人工干预，不通过题目关键词推断。

一次实际本地页面输入和启动，观察平台内部产品、研究、项目经理、测试、研发及 Verifier/Jev，而非外层手写生成场景。研发之前冻结角色 CSS、原需求、验证责任与版本/hash。输出仅严格 scene JSON；不执行模型生成 Node/shell。实体摄像头须用户主动操作，本次不授予实机许可。

## 固定配置与预算

- 六角色实际均 DeepSeek / https://api.deepseek.com / deepseek-flash；沿用本分支页面已配置的凭据，只读取 hasApiKey。输入/输出保守声明费率 0.30/1.20 USD 每百万 Token，不是供应商发票。
- Jev cascade：jev-1.13.0，最低分3、集中度0.5（不是准确率），输入0.042 USD/M、输出0、最多24个Jev请求，单个30秒；uncertain 或已验证派生算术漂移才升级一次独立 LLM。非法协议/未知费用/基础设施失败停止。
- 每阶段1候选；基础6阶段通常12～18次角色/决策请求；全局最多2次纠错/返修（共池），最坏10次阶段评价、最多30次已登记调用。为覆盖此上界，本轮 maxCalls=30，其余上限500000 Token、单次6000输出Token、总600秒、5 USD。
- 预计0.03～0.20 USD，预测而非实测；已授权首批15 USD内部硬额度中的一项。实际费用以真实usage账本为准，unknown不记0且阻止下一请求。按已声明最高1.20 USD/M口径，500000总Token约0.60 USD；供应商异常或超限返回仍如实记录，不能承诺供应商账单硬限。
- Prompt：HTML v7 / camera v6；Verifier phase ordinal v4 + compact-output-v1（300/400字符目标，宿主1000/1500不放宽）；语义预检v2、coverage-owners-v1、camera-test-semantics-v1。Jev request-layout-v2把完整rubric保存于每题共享state、questions引用它，去除同义重复而非裁剪原需求或提高32KB/64KB上限。
- Camera acceptance v2；mandatory scene behavior v2（修复背景渐变被误作初始可见粒子）；Jev candidate v3、全局返修v1、Harness 0.1.5-rc.3、固定资产版本不升级。
- Prompt 中固定资产使用版本、来源commit、数量、字节和完整清单hash；完整pins继续保存在call配置与交付manifest。去除静态事实重复，业务输入、拒绝原文与合法候选不裁剪；紧凑业务不变量保留相同要求。
- 真实启动前免费回归全部通过、提交干净源码、重建并重启自己的4420。准确 platformCommit、runtime hash、模型与输入快照保存于 run/evidence/manifest，不预造未知hash。

## 预先定义的判断

有界场景最小闭环通过需要：真实内部角色输出 → 语义/CSS预检 → Verifier阶段审查 → 研发前验收冻结 → 声明式场景 → 全部角色CSS + 强制背景基线/可见Canvas/真实几何/合成21点Gate → 项目经理按实际Gate批准 → 源码与证据落盘。无人工改生成产物、无模板回退、无降低冻结断言，纠错≤2。

原用户明确手势映射必须在 CSS 的 #gesture-map 文本冻结；platform mandatory 仅按配置自洽，不替代这个业务约束。全部层必须实际执行，不用责任表伪造通过。

通过仅称“最小真实有界场景闭环”，不称完整摄像头需求或稳定通用L5；visionModelVerified、physicalCameraVerified、fullRequirementVerified保持false。失败、取消、超时、截断和未知同样保留账本，不排除分母。不修改配置重试；平台缺陷需新版本新实验。
