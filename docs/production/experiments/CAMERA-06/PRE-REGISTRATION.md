# CAMERA-06：无损 Harness 传输后的独立真实尝试

2026-10-07，预登记先于本轮真实调用保存和提交。独立编号 CAMERA-06，一次启动；不自动重跑，不改 CAMERA-01～05 原始证据。不同配置的六轮探索不作为固定配置稳定性实验。

## 输入与执行边界

原话：开发一个梦幻的圣诞树，能通过摄像头获取手势，来控制圣诞树。

来源：用户本会话提出的功能测试需求，2026-10-07；非业务工单。kind=illustrative。通过本地生产工作台实际填写并提交，调用平台内部六角色；外层开发不改产物、不替代内部研发、不回退模板。

验收：夜色中可见梦幻粒子圣诞树、星形顶饰与雪；摄像头默认关闭，点击开始才请求视频，关闭后释放资源。张掌散开、握拳聚合、掌心横向位置旋转，作用于实际几何。无手、权限拒绝、设备或本地模型不可用有清晰状态；按钮与键盘可回退但不计摄像头通过。不保存或上传帧，不接触模型 Key。平台合成 Gate 与真实视觉/实体设备验收分列。

启动时明确 cameraBusinessConstraints={openPalm:"scatter",closedFist:"gather",palmX:"rotate"}，不是生成后补写约束。业务映射由测试角色在 #gesture-map 冻结，平台强制 Gate 另验证实际几何/合成21点；责任表不是已通过证明。

只允许严格 scene JSON，可信本地渲染器与受限 Chromium 执行。不得执行模型生成的 Node/shell、联网安装依赖或申请实体相机。实体摄像头仍待用户主动操作。

## 固定配置

- 六角色 DeepSeek / https://api.deepseek.com / deepseek-flash，页面既有本分支配置，输入/输出声明费率 0.30/1.20 USD/M；不读取、迁移或回显 Key。
- Jev cascade：jev-1.13.0，门限3/集中度0.5，输入0.042 USD/M、输出0、24次上限、单次30秒。仅 uncertain 或可信派生算术异常升级一次独立 LLM；未知usage或致命错误停止。集中度不是准确率。
- 每阶段1候选，最多30条调用预算记录；全局最多2次阶段纠错/Gate返修，共用池。Token 总上限500000，每次输出6000，600秒，5 USD。估算0.03～0.20 USD，预测非实测；账本以实际usage为准，unknown不记零。本轮在用户已授权、高性价比首批15 USD内部额度内。
- HTML prompt v7 / camera prompt v6；acceptance camera v2；mandatory behavior v2；Verifier phase ordinal v4 / compact-output-v1；语义预检v2、coverage-owners-v1、camera-test-semantics-v1；Jev candidate v3 / request-layout-v2；全局返修v1。
- DeepSeek Harness 0.1.5-rc.3 不升级；新增 harness-literal-prompt-v1 无损传输：system/user 原字节不再作为 SDK 模板递归解析。已用实际 SDK＋本地 fake provider 免费验证原字面占位符、不改变 system 权限、usage和取消；免费通过不是本轮真实成功。
- 使用 CAMERA-05 实际选中产品、研究、计划原文的9项合法 checks 免费完整返修测试：角色请求最大39071 B / 60000，Jev单题25793 B / 32000，总体28455 B / 64000。原上下文/候选不截断、不提高上限。更长真实输出仍按现有上限拒绝。
- 运行源码需先免费回归、提交、干净构建；准确 source commit、运行时/hash、输入/模型/Prompt/验收、工具事件及成本保存于 run/evidence/manifest，不预填未知值。工作台单次预算消费与共享账本投影属于控制面修复，不修改 Gate 或原实验记录。

## 预定义结果

最小真实有界场景闭环必须实际通过：产品→研究→项目经理→测试语义/CSS预检与独立候选审查→研发前冻结→研发 scene JSON→全部角色 CSS 与强制 Canvas/几何/合成手势 Gate→项目经理按真实 Gate 批准→交付证据落盘。无人工产物修改、无放宽断言、全局返修≤2。

通过只能称有界场景闭环，不称完整摄像头需求、稳定通用L5或官方L4。visionModelVerified、physicalCameraVerified、fullRequirementVerified 保持 false。所有失败/取消/超时/截断/未知都保留；已知小计、总账未知、Harness意图和实际HTTP分别报告。若有平台缺陷，先保留该尝试，免费复现修复，再另开版本/实验，不能覆盖本轮为成功。
