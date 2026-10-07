# CAMERA-09：原生 JSON 传输的独立真实探索

2026-10-07，先于真实启动提交。沿用 CAMERA-08 的完整用户输入、来源、背景、业务验收、illustrative/high 和 scatter/gather/rotate 硬约束，仅将需求编号改为 CAMERA-09。原始 01～08 档案不修改；不同配置探索不合并为稳定性成功率实验。

## 唯一配置变化与冻结

保持 Harness/插件 0.1.5-rc.3、HTML prompt v8、camera prompt v7、planning-loop-v1、review-context-v1、literal transport、验收语义 v2、固定运行时/资产/Gate 和 Jev 门限。新增 `harness-json-output-v1` / `deepseek-json-object-other-prompt-only`：明确 DeepSeek Chat 请求仅增加 `response_format:{type:'json_object'}`；生产所有角色仍返回原对象 schema。SDK→可信 localhost 用量代理→官方供应商，原模型、提示和其他配置不变。

该模式不是 JSON Schema 或业务正确性保证。响应原样保存，非法/空/截断 JSON 严格拒绝；400 不降级或重发；不人工转义或修复答案，不增加隐藏调用。Mock/注入不能冒充 wire-observed。请求格式版本/政策进入 validation、config、冻结验收 hash 与 manifest。

开始前需完成最终免费回归和独立安全/质量复审，将实现与本预登记提交为干净 commit，重新构建并重启本分支 4420 服务，读取 metadata 确认服务与干净构建均为该 commit、固定资产就绪。实际 commit/hash/时间以启动的原始 metadata 和 run.json 为准，不预写未知值。不更改其他研发线服务。最终免费 Node426/426（264.880秒）、浏览器38/38（1.6分钟）、类型校验通过；共享测试依赖拆分后的专项15/15（16.220秒）。完整中间失败及诊断见[工程批次](../../BATCH-JSON-OUTPUT-CHECKS.md)，不隐藏重跑或放宽生产门禁。

## 限额与成本口径

六角色均 DeepSeek / https://api.deepseek.com / deepseek-flash，声明估算输入 0.30、输出 1.20 USD/百万 Token；仅检查页面 hasApiKey，不回显 Key。Jev jev-1.13.0、门限 3/.5、输入 .042/输出 0 USD/百万 Token、每运行最多 24 次/单请求 30 秒，原 uncertain 与派生算术漂移各自最多一次独立 LLM 规则不变。

一次新任务，1 候选/阶段，最多 30 条调用、500000 Token、6000 输出 Token/调用、600 秒、1 USD，规划修订/角色纠错/Gate 返修共用最多 2 次。预测约 .03～.25 USD，非实测/账单承诺。原批次 15 USD 保守包络内加入此次 1 USD 上限仍有余量；05/06 用量未知不当零，旧任务按各自完整上限计预算包络。只启动一次，不以相同配置自动重跑；不启动 54 次 Verifier 对照或九次稳定性实验。

## 预登记判据

六角色真实调用与独立候选审查，PM 批准后由测试角色生成合法验收，研发前冻结，研发生成严格 scene JSON，预先冻结 CSS 与可信 Canvas/几何/合成 21 点 Gate 全部通过，PM 据实际结果交付，证据/成本可追溯，才能称最小真实有界场景闭环。无模板回退、外层改产物或临时降低断言；预算、unknown、取消和超时均停止并留账。规划 revise 路径只有真实运行实际走到才计实测，不能借夹具通过宣称。

场景 Gate 即便通过，真实视觉、物理摄像头和完整用户需求仍分别为未验证，不进入完整良品分子；所有真实终态进入分母。用户外出期间不申请相机/麦克风权限，实机验收待用户主动操作。失败保留原输出、返修、原始请求意图/HTTP、费用与原因，不将此探索或九个小样本当普遍 L5/L4 认证。
