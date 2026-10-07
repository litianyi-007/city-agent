# 原生 JSON 传输与 CAMERA-09 工程批次

2026-10-07。仅 production worktree/branch；原虚拟社会目录/服务、main、冻结 Tag、旧实测/视频/申报正文和用户 ZIP 不修改。

## 本批实现

- [原生 JSON 请求模式 v1](HARNESS-JSON-OUTPUT-V1.md)：保持已安装 SDK，可信用量代理只为显式 DeepSeek profile 添加 json_object；不修改 Prompt/输出/schema/Gate，不降级或隐藏重试。
- 新请求格式版本/政策进入验证和冻结血缘；wire-observed 仅证明可信代理实际请求的格式，不证明供应商遵从或业务通过。Mock 为 not-networked，injected 只有控制面意图且嵌套供应商格式剔除。
- 原 CAMERA-08 的失败原文/文件/hash 保持；新 [CAMERA-09 预登记](experiments/CAMERA-09/PRE-REGISTRATION.md) 限一次 1 USD，不先填成功或 unknown 费用为零。
- 九项 Jev 历史数值诊断免费回放，18 个真实 Score 以独立均值/集中度公式复算，精度区间和算术漂移分列；这是历史协议诊断，不是 Verifier 品质或节费实测。
- [v4 公共发布核验](PUBLICATION-V4-2026-10-07.md)记录 c7b4f2e 固定安装源、PDF/指南/八次账本读回，以及不变的根树 SHA。当前工程修复不自动更新已发布固定版本。

## 独立审核与修复

外层开发 Agent 的质量/服务端复审和安全复审，不是平台内部自主交付。两项 P2 已修：非法数组 role 必须发送前拒绝；injected 顶层/嵌套格式意图不一致。另补新四个长协议字段/版本的凭据子串拒绝，避免字面脱敏误改证据；min16 与 visible-token-v2 不降，不读取或迁移历史秘密，不承诺修复所有旧凭据状态。

独立 localhost 负例覆盖认证/路径先于解析、非法角色/工具/内容、格式冲突、单 POST、完整 model/messages 保留、取消后代理端口关闭；不请求外部模型或新权限。免费假供应商通过不能预先证明真实 DeepSeek 遵从。

## 回归全过程，不隐藏重跑

初轮新传输免费全量 **425/425**（67.631秒），浏览器 **38/38**（1.4分钟）。随后审核修补后的高并发重复 **424/425**（68.337秒）：摄像头注入链终态 completed，但调用数16而期望12，走了额外一次Gate返修；原临时账本已由测试正常清理，日志无该次Gate具体明细，根因仍 unknown。并发资源/时限仅为推断，不能冒充已定位。

同项单独运行所在摄像头套件 **12/12**（21.076秒），该项3.023秒且12调用；不降低期望或修改生产 Gate/超时。测试仅增加诊断失败消息，以便未来保留 Gate/repair/error。

补凭据反例后 concurrency=4 独立全量 **425/426**（81.528秒），摄像头项通过；旧 literal cancellation 在 runRole 拒绝后 1 秒内未确认 ServerResponse close，其他 AbortError/一次POST/unknown 断言已通过。该次没有 socket 时序日志，根因仍 unknown；不把不同失败合并为已定位生产缺陷。补只读诊断后，旧 literal 与新 native 取消各连续 10 次，共 **20/20**通过（16.711秒），上游 socket/response 在 abort 后3～4ms关闭且先于 runRole 返回，TypeScript通过；1秒门限及生产逻辑均未改。此前另一单独取消2/2也通过，不能用这些重跑倒改旧失败。

npm test 最终使用 Node 官方 test-concurrency=1，串行重型 SDK/Chromium 工程套件，不与 E2E同时运行。这是可复现工程调度，不放宽生产业务门禁、关闭断言或增加平台权限；串行通过也不证明并发缺陷不存在。

最终串行全量 **426/426**（264.880秒），日志 `output/production-camera05/node-json-output-serial-final.log`；TypeScript通过。重复后的浏览器 **38/38**（1.6分钟），日志 `browser-json-output-final.log`。这些通过不覆盖两次中间失败。通用Harness专项只依赖共享适配器和JSON.parse，生产严格解析另由生产专项覆盖，避免共享提交携带production模块依赖；该测试依赖拆分再单独重跑。

共享测试依赖拆分后的 Harness＋生产 JSON 专项 **15/15**（16.220秒），TypeScript通过，日志 `json-output-shared-decoupled.log`。通用适配器及独立专项 commit：`c88ad4fbcc222292812e92b799624532e7ad68e6`；另一线审查后自行选择 cherry-pick，本会话不跨线合并。

所有以上是免费工程证据，零管线供应商调用；外层 Codex 自身用量未纳入，不猜成零成本。生产接入、凭据元数据保护、调度和文档另独立提交。

## 后续边界

CAMERA-09 最多两次共享修复，只真实 Gate 可证明有界场景；用户外出期间不申请实体相机权限。完整摄像头、受控仓库容器、54次 Verifier 正式对照与九次稳定性实验各自独立，不因单次语法风险改善便宣称通用 L5/L4 或高性价比已被证明。
