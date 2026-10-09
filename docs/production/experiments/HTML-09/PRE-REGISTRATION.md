# HTML09：grouped v5 单次真实交付提案（未授权，未运行）

2026-10-09。[HTML08](experiments/HTML-08/RESULT.md)一次授权已消费，结果保留 failed。随后免费完成 [阶段依赖修复](PHASE-READINESS.md)和 [八条业务容量/行为见证](STATE-COVERAGE-ENGINEERING.md)；不把手写工程证据算真实交付，不自动开始新收费任务。

## 原需求、冻结与禁止事项

沿用 [HTML08 输入](experiments/HTML-08/input-snapshot.json) 的完整 brief、八条 acceptance 及末尾执行约束。原文件字节 SHA256 `41e97f5469241ad1e60e04af64e0425864c9466b0a133c5b200d90ab4ab7bb03`；原业务材料 JSON SHA256 `73f5f08b0ea999fe52adfcc8d56b837026365d81c7e993be586a7c1cff56565f`。新编号/来源/背景反映 HTML09，不能改业务或继承原 `budgetAuthorized:true`。

配置为 grouped v5 / phase-readiness-v1 / source-v9，仍 output-envelope-v1、PM policy-v1、步骤审计-v1、完整评审投影-v1、公共碰撞 guard-v2、启动同源 guard-v1。真实执行前记录干净 commit/build/boot、实际模型/费率、免费预检报告和明确新授权。

手写见证只用于外层平台测试；**不预置测试/HTML、不传入模型 Prompt、不复制旧答案、不让外层手改产物**。内部测试角色仍须自主生成实际 checks，完整 Verifier 对原要求做覆盖审核，结构/语义/CSS/来源校验后冻结；研发/返修不能改 Gate。静态评分高、PM proceed 或步骤计数都不是最终交付。

## 拟定单次收费边界

| 项目 | 拟定值 |
| --- | --- |
| 六角色 | 产品、研究员、项目经理、研发、测试、Verifier；沿用本分支页面 `deepseek-flash`，启动前核实际配置，不迁移/回显 Key |
| 费率口径 | 声明价输入0.30 / 输出1.20 USD每百万Token；不是供应商实时报价或账单证明 |
| 运行模式 | live / offline-single-html / LLM Verifier / 单候选 / legacy / planned-groups-v1；不调用Jev/Hopper |
| 原硬门限 | 12 checks，每项20步；最多3组；最多2次共享返修，不临时增配额或降低断言 |
| 限额 | 最多24逻辑调用、500000总Token、每次6000输出、600秒停止触发 |
| 估算费用停止 | 达1 USD停止后续调用；unknown usage立即停止。不是供应商账单硬上限，不保证取消已发请求无尾部费用 |
| 调用包络 | 最多3组时16初始/28含返修；24硬限保留，可能提前终止；工程容量见证不抹掉这一风险 |
| 预测 | 粗略0.04–0.35 USD，仅基于旧尝试及上下文长度的预测，不是实测/保证/省费证据；实际免费预检给保守包络 |
| 次数 | 只允许一次实际本地前端提交；0调用拒绝、失败、取消、超时均入账，剩余额度不是第二次许可 |

申请授权前先完成免费工程/独立审查，干净构建和实际 UI 免费预检。未授权仅可预检，不勾收费同意、不POST任务、不调用角色。授权后点击前持久化意图，记录一次提交和原始调用/输出/Verifier/修复/冻结/Gate/Token/费用；中途平台改动另开实验版本，旧实验保留。

只有无人工改产物、无模板回退、无门限放宽的实际冻结行为 Gate 通过，才称“最小真实 HTML 闭环通过”，不称稳定通用L5。新的收费授权由用户决定，本文件本身不构成授权。
