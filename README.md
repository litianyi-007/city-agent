# city-agent

虚拟社会平台底座。一套共享模块支撑多条产品线；近期只做两条，并且共用同一底座。

当前阶段：**实现前文档，供第三方评审**。本仓库还没有系统实现。评审结论写回文档之前，不开始写产品代码。

## 两条近期轨道

1. **调研轨（Fork A）** — 滨江 AI 镜像社会问卷调研：公共数据 → 人群 → 抽样作答 → 分析，带验证与成本记录。命题简报划定这条轨道的用语和边界，不是整个产品的上限。
2. **L5 轨（Fork B）** — 有界能力的自主研发：一次运行内从书面规格走到可运行产物并通过 QualityGate，中途没有人工介入。第一刀是小型 Web 应用，不是游戏数字资产。

更长期的 MMO-AI 游戏基底只作为愿景，挂在 `extension_point` 上，不属于 Phase-1 交付。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/PRODUCT.md](docs/PRODUCT.md) | 愿景、双轨、假设、范围与非目标、成功标准、外部评审计划（含人口统计问题清单） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 共享底座与两叉、模块边界、接口契约、技术栈、已同意的取舍（ADR） |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 评审前事项、评审后的实现顺序、非目标、开放问题 |

建议阅读顺序：本文 → 产品 → 架构 → 路线。范围以 `docs/PRODUCT.md` 为准；模块契约以 `docs/ARCHITECTURE.md` 为准。两处冲突时先改文档再谈实现。

## 评审时请先看

- 调研轨的口径、抽样和结构自证：`docs/PRODUCT.md` 第 6.3 节。结论会变成 `ExternalDataAdapter` / `PopulationBuilder` / `EvalHarness` 的契约约束。
- 明确不做的清单：产品文档第 4.2 节，路线文档第 4 节。
- 尚未冻结、但已给窄默认的问题：`docs/ROADMAP.md` 第 5 节。
