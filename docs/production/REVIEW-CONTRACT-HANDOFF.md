# 两条旧 Phase-1 文档意见的跨线交接

日期：2026-10-07。本文件只写入 `feature/autonomous-production`；没有编辑原 `city-agent` 或 `city-agent-virtual-society` worktree，不自动 cherry-pick 或改共享历史。

评审引用的 ARCHITECTURE.md:377/242 对应旧阶段原文，不对应现在106行的 Demo 架构。生产冻结基线的原文在 `docs/archive/2026-09-23-before-demo/ARCHITECTURE.md`，保留不重写。两条意见的原则合理，但不能据此宣布当前实现已经复现这两个漏洞。

| 意见 | 本生产线核对与落实 | 虚拟社会线下一验证 |
| --- | --- | --- |
| Manifest 与报告同事务会丢中断记录 | 当前生产 API 已在 pipeline.start 前 addRun/save。新 study 独立持久化 running manifest，再记 intent；最终报告失败不回滚它。SIGKILL、EIO、恢复均有独立工程反例。 | 核对当前调查建 run 的真实事务边界；在首次模型请求前独立 commit running manifest，最终状态/报告可同事务。硬退出与报告写失败也必须留痕，不仅更新文档。 |
| 稳定性重复不能复用已有答案 | 本 study 无答案/选择缓存，全新 run/decision/call ID，bypass 且每轮重新调用；不以输出不同作为新调用证明。 | 区分探索缓存和稳定性实验。重复轮次 fresh session、禁用应用层答案缓存并记录 cache hit/miss/bypass；若计划要求5轮，必须有5轮独立请求证据，不能只引用参数声明。 |

给虚拟社会线的最小合同：

- 创建研究运行之前冻结问卷、人口/画像、模型与预算 hash；独立提交 status=running 和 start time。
- 模型调用前独立提交 request intent；失败、取消、超时、unknown 和 pending 都属于启动分母。
- 最终状态与报告可以原子提交，不能与首次 manifest 初始化绑定同一可回滚事务。
- 稳定性 run 保存 experimentId/repetitionId/freshSession/cachePolicy=bypass；禁止读取此前回答，不自动重复付费请求。
- 增加“报告提交失败”“进程硬退出”“预请求落盘失败”“重复5轮 independent dispatch”反例；由该线在自己的分支实现、回归和审查。

本批生产实现见[执行合同](VERIFIER-STUDY-CONTRACT.md)。这不是把生产工程结果转移为人口模型或调查稳定性已验收的声明。
