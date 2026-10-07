# 下一次真实 Verifier 对照 — 待确认提案

2026-10-08。**本文件不是预算授权、不是已启动实验、不是冻结 manifest。** REAL-01 一次授权已经消费；当前免费协议修复不追加收费请求。取得新授权后，才在 clean commit、重新构建/启动的本线页面核对配置并 prepare，另建预登记、冻结 plan 与独立同意记录。

## 建议保持的对照范围

- 相同公开 18 池、相同候选字节及行为 Oracle，A 首候选 / B 独立 LLM / C Jev 加一次规定的 LLM 升级；不把题目改得容易通过。
- 使用新版 ordinal v5 / compact v2 / diagnostic v1 / study strategy v2 / source v3。新提示质量未知，不能与 REAL-01 的不完整结果合并成重复稳定性样本。
- 全部 54 盲决策先于 36 候选的实际 Oracle；各策略新会话、不读答案缓存、不使用其它策略答案或 Oracle 来选优。
- 最多 36 LLM＋18 Jev，零重试。Jev uncertain / 已定义 arithmetic-drift 可按原政策升级一次；其它协议失败保留全记录并停止，不改门禁或自动再开实验。

## 模型、时间及估算额度

建议沿用用户选择的页面配置，但启动前必须核对实际公开元数据；不迁移 Key 或从文档取 Key：

| 项目 | 提议 |
| --- | --- |
| Verifier | DeepSeek `deepseek-flash`，`https://api.deepseek.com`；声明输入/输出 0.30/1.20 USD 每百万 Token |
| Jev | `jev-1.13.0`；声明输入/输出 0.042/0 USD 每百万 Token；minConfidence 0.5、minScore 3 |
| 次数 | 最多 54 次供应商调用意图；A 不调用模型，C 的费用包含 Jev 与实际升级 LLM |
| 时间 | 30 分钟触发取消并等待清理；LLM/Oracle 单次 120 秒，Jev 单次 30 秒 |
| 输出 | LLM 请求 max_tokens 4096；Jev 4096 仅响应后观测停止阈值，不是供应商输出硬上限 |
| 声明价停止额度 | 达到 1 USD 后不开始后续调用；不是供应商账单硬上限 |

按原输入工程预留 LLM 61,440 / Jev 65,536 Token、各 4096 观测输出计算，计划输入预留 3,391,488、输出观测额度 221,184，声明价工程预留 **0.890044416 USD**。这不是预测实际账单、不是 Jev 输出上限保证；unknown usage 不按零计算。页面价格为声明价，启动时若模型/费率或能力不同，重新报告差异后确认，不静默替换。

## 预先固定的价值判定

延续 [REAL-01 预登记](experiments/VERIFIER-REAL-01/PRE-REGISTRATION.md)的公平口径：好选中/18、坏放行/18、全坏池正确弃权，辅报 precision/coverage；全部取消、失败、未启动、截断和 unknown 单列。

仅在 usage 与实际 Oracle 完整，C 好选中不低于 B、坏放行不高于 B，且 C **总**声明价费用低于 B 时，才称“本样本高性价比”。否则如实报告权衡或未显示优势，不预设 Jev 胜利。completed 不等于模型提升或产品自主交付；对照之后另行验收真实 HTML 软件需求。

本次三策略的固定候选顺序仍未随机，模型温度/top_p/seed 未显式设置；有限调优语料不是独立未见验证，不称普遍可靠或稳定 L5。
