# VERIFIER-REAL-02 预登记

2026-10-08，第一次 prepare/供应商调用前登记。用户已明确回复“批准”[新一次实验提案](../../VERIFIER-NEXT-RUN-PROPOSAL.md)：仅本次完整 18 池 A/B/C，最多54调用、零重试、30分钟取消触发、1 USD声明价停止额度，接受估算不是账单硬上限及 Jev 输出仅事后观测的边界。REAL-01 原授权和失败原件不复用、不回写；失败后不自动重跑。

## 源码、配置与范围

工程已验证源码为 `7345fdaaca5d5f9f89d68911781e1715141fc979`（705/705 Node、45/45浏览器、TypeScript/Vite通过）。本预登记单独提交，不改执行源码；运行前重新构建/启动，核对47项source hash与该修复提交相同。控制面独立保存实际 clean HEAD、boot、构建、公开配置、全冻结 plan/hash和一次同意；不以本文件代替运行 manifest。

版本：ordinal `verifier-phase-ordinal-v5`、compact v2、diagnostic v1、study strategy v2、source v3、observed v1、control v1。重复对象键和32,000 UTF8字节响应限制是新版收紧；提示增加通用边界证据，宿主最低分3/最高分、Jev ±0.005、请求上下限与行为 Gate 不改。旧实验仅作归因背景，不合并为同冻结配置重复样本。

- Verifier：页面现有启用 Agent `cc18586a-8d6b-4c19-950f-308034a0c0b1`，DeepSeek官方地址 `https://api.deepseek.com`，`deepseek-flash`，声明输入/输出0.30/1.20 USD每百万Token。
- Jev：页面现有启用 `jev-1.13.0`，声明输入/输出0.042/0 USD每百万Token，minConfidence0.5/minScore3、30秒单次；配置maxRequests24，本实验至多18 Jev意图。
- Key只由本分支加密控制面提供，不读取、打印、迁移到文档/Prompt/产物。hasApiKey仅证明配置存在，不单独证明鉴权有效。
- 固定18池 H01–H12/C13–C18，A首候选/B独立LLM/C typed Jev及规定升级；候选源码/场景与原行为Oracle不更改，不生成或人工修补新代码。
- 三策略固定顺序baseline、llm、jev-cascade；候选顺序未随机，seed=null。模型温度/top_p/seed未显式指定，供应商默认/unknown，不声称确定性。

## 有界调用和停止规则

54盲决策，至多36 LLM＋18 Jev调用意图，零重试。A无模型调用；C uncertain或具有完整可信诊断、完整usage且无部分选择的arithmetic-drift时，按照现有冻结规则升级一次同一B请求；升级不是重试Jev，不把Jev意见、其它策略答案或Oracle注入B。

声明价达到1 USD停止后续调用；30分钟触发取消并等待清理。LLM/Oracle单次120秒，Jev30秒。输入工程预留LLM61,440/Jev65,536 Token，LLM请求max_tokens4096；Jev4096是响应后观测阈值，供应商输出硬上限unknown。计划输入预留3,391,488、输出观测额度221,184、声明价工程预留0.890044416 USD，不作为实际账单预测或硬保证。

全部54盲决策先于36候选实际隔离Chromium Oracle；每次独立会话、cache=bypass。协议错误、源码/配置/凭据代次漂移、预算、取消或unknown usage按已实现策略停止/失败关闭，不在结果出来后放宽门禁。消费同意、全plan和running先独立持久化，失败/中断不消失；重启不自动重发收费请求。

## 结果与价值判定（结果前固定）

每策略按18计划池报告 attempted/accepted/abstained/errors/not-started；好选中/18、坏放行/18、全坏池正确弃权为主，precision/coverage为辅。取消、失败、截断、unknown均单列；供应商HTTP观察、Token、完整/未知声明价、Jev直接决策及升级费分开，账单unknown不填零。

仅当usage与实际Oracle完整，C好选中不低于B、坏放行不高于B，且C总声明价费用低于B，才称“本样本高性价比”。C总费用包括全部Jev和升级LLM；不比较不同池数量的费用，不预定Jev胜利。任一前提不满足，报告质量/费用权衡或没有显示优势。

completed只表示该固定评估流程完成，不是软件良品、模型提升、通用L4/L5或实体摄像头通过。候选来自有限调优挑战集，不是未见泛化样本；首次完整对照不能证明稳定性。研究者静态标签不能补作本次Oracle。最终报告与原始证据另建文件，旧负结果保留。
