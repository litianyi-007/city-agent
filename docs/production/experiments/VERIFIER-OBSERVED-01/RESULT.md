# VERIFIER-OBSERVED-01：原生适配链路的免费工程演练

来源：`loopback-engineering`，不是真实模型测量或内部六角色自主交付。冻结源码 `3a1bedfa8369f2032bb3b943b393dfbeaee3a456`、启动clean=true、39项源码SHA；预登记见[观测契约](../../VERIFIER-OBSERVED-TRANSPORT.md)。本次无API收费入口、无真实Key、无模板/答案缓存回填、无旧实验重写。

## 结果

| 项目 | 实测 |
| --- | --- |
| Run ID | `f5152c26-891f-458f-a63a-bcf414dc3200` |
| 执行版本 | `verifier-study-observed-v1`，单一common kernel |
| 开始/结束UTC | 2026-10-07 14:43:42.171 / 14:48:09.844 |
| Runner墙钟 | 267.672秒（包含源码检查、持久化、SDK/Oracle及清理） |
| 决策 | 18池×A/B/C＝54，全完成，not-started=0 |
| 调用意图 | 54＝36 LLM＋18 Jev，无重试 |
| 实际本地网络 | 36个loopback HTTP POST；fixture拒绝0 |
| Jev替身 | 18次内存fetch dispatch，**不是18个网络HTTP** |
| 实际外部供应商请求/费用 | 0 / 0 USD，仅限这次免费CLI |
| 实际Chromium Oracle | 36次完成且healthy，16业务通过、20预设业务负例 |
| 持久化 | 290事件＋对应确认marker＋初始manifest，terminal已确认 |
| 实际模型Token/质量/费效 | null / 未测 / 未测 |

兼容字段 `localFixtureHttpAttempts=54` 必须结合 `fixtureDispatchKind`，本批实际网络只有36 POST。`knownInputTokens=5454`、`knownOutputTokens=378`、`knownEstimatedCost≈0.001469556 USD` 全部是替身返回101/7和冻结声明价的模拟账本数字，不是实际模型Token或收费；机器/外层开发成本未测。响应身份LLM为unknown，内存Jev只声称替身协议字段1.13，不证明实际权重或供应商鉴权。

A/B/C各18次固定选首候选，实际Oracle每策略8通过/10业务失败/0unknown。B与C是事先设定的固定回复，C的18次uncertain均升级同一B prompt；三列相同是夹具政策的结果，**不能证明三策略模型准确率相同或Jev无效**。36候选实际16通过/20失败不是全通过；不以工程批次completed把坏产物算交付良品。

全部54个盲decision-result先于首个oracle-intent；每次intent先于dispatch，原响应和完整wire预期hash、plan/config/source/consent血缘独立保存。与 prior injected Mock相比，这次实际运行锁定Harness→本地SSE供应商、严格Jev→内存协议及真实Chromium，没有替代source/品牌守卫。工程guard和engineering-only同意不是收费用户授权。

## 原始文件与校验

`started.json` 与 `receipt.json` 从ignored原始目录逐字节复制；`run-ledger.tar.gz` 完整压缩原始run目录，未挑选事件或重新生成响应。

| 文件 | SHA-256 |
| --- | --- |
| [started.json](started.json) | `314421d4203ab953ae319ffec23efd6aa6a9f1c79ab2dc59855566f9ae352eb8` |
| [receipt.json](receipt.json) | `a5ae0395e3d6563dea6dd7720f0809e0a9da629dc7e1bfa1b672311df22e7c31` |
| [run-ledger.tar.gz](run-ledger.tar.gz) | `a1d171a2e9106327a0a4d758b5e32b3f1cdf0f159c514c538efa37ad8baed987` |

原始目录：`output/production-verifier-observed-UToSMf`。核验压缩包SHA后，仅解压到新的独立临时目录；包含的run只是manifest/event/marker JSON，不是可执行生成项目。Ledger v2确认marker绑定原始绝对目录scope：`VerifierStudyLedger.open()` 只适用于原scope，**不能直接open迁移后的临时目录**。在其他设备阅读归档时，核验本文包SHA、原始JSON/event/marker链及记录的directory scope/hash；这不把归档变为可恢复/继续运行的账本，不重写marker或放宽scope。当前独立审计是在原scope只读完成，归档迁移的统一导入工具另列后续任务。不要自动恢复或重放供应商调用。重新运行免费CLI会生成新run/plan/consent ID，不复用本次答案。

独立外层开发Agent的只读[审计记录](independent-audit.json)复算了全部来源、583原文件/290事件链、54请求、36Oracle及汇总；原件不含两把dummy凭据。审计是工程核验，不是第二轮模型实验。

## 后续

单独批准1 USD估算停止额度及Jev4096事后观测口径后，接入受控用户同意、boot/配置/凭据新鲜度并创建新收费freeze；真实18池效益账本单独编号。真实HTML/实体相机/隔离容器/固定配置泛化不由本工程结果替代。
