# 自主软件生产申报材料索引

本批材料按用户给出的七项栏目组织，明确为三项模拟需求的工程演练，不冒充真实业务需求。材料包通过 `npm run production:package -- --record` 从本机服务生成，保留新批次的全部尝试、原始记录、源码、PDF 和实际浏览器录屏；只有冻结实现 commit 后才能运行导出，避免不明确的源码血缘。

| 栏目 | 入口与证据 | 当前申报限制 |
| --- | --- | --- |
| 基本信息 | 管线 Agent Delivery Studio；六角色；README 与 package PDF | 正式团队姓名待填写，不捏造成员 |
| 管线设计 | DESIGN 架构图、职责和门禁；冻结契约、Verifier 与反馈 | 限单 HTML；不是任意任务 DAG 或仓库平台 |
| 需求清单 | REQUIREMENTS 和 shared/production-benchmarks.ts | 用户明确没有真实需求，三项为 MOCK |
| 执行记录 | 每需求输入、候选、Prompt/hash、冻结测试、Gate、日志、源码、manifest | Mock 响应不是模型自主代码；源文件离线复现不等于在线服务 |
| 指标 | API /api/production/report 和材料包 JSON/PDF | Mock/真实/预测分列，未知不当零，未做人工实测对照 |
| 归因与改进 | 原始失败、工程反例与 NEXT-STEPS | 不混并旧六次不同配置的负结果 |
| L4 自评与推广 | EVALUATION、PDF 第七节、Jev 快速层及 AnyJev SDK 待办 | 无官方标准，不宣称官方认证或稳定通用 L5 |

显眼的公开入口为 https://litianyi-007.github.io/city-agent/production/；PDF 为该入口下的 submission/production-mock-submission.pdf。公开版仅可信固定 Mock 交互与证据回放，不能配置 Key、发起真实研发或运行 Harness 后端。用户本轮授权独立 production/ 子树，不覆盖原虚拟社会入口或旧附件。本机完整入口为 http://127.0.0.1:4420/#production，前提是按 RUNBOOK 启动并配置模型。

## 实测与预测

实际浏览器交互、工程测试、耗时和 Mock 零供应商调用可由记录复现。真实模型自主良品率与自主环节占比在未运行前为 unknown；fixture 不进入这些分母。预测人工工时按每项区间单列，不能以预测人日除以 Mock 秒数宣传增效。

## 参考概念

[LLM-as-a-Verifier](https://github.com/llm-as-a-verifier/llm-as-a-verifier) 的候选审查与细粒度反馈已用于本项目设计；实现是结构化序数 rubric，不复现原 score-token 概率算法，也不承诺绝对最佳或校准置信度。

[AnyJev](https://github.com/nokia-applied-research/AnyJev) 必须出现在材料的下一步方向中：后续用于类型化路由或重试建议，先评估模型 logprobs、独立标注集和校准效果，SDK 目前未接入。其读出等级与软件自动化 L4/L5 不是一套定义。

托管 [Jev](https://docs.typesafe.ai/api) 已列入本批实现，不能再作为仅规划功能。设置入口、固定版本、三维 Score/Noul/Choice 批量审查和不确定路由见 DESIGN。真实决策与夹具代码生成分列；固定合成池对照报告首候选/选中 Gate、弃权、Token、费用与全部失败，不能将小样本推广成稳定 L5。临时凭据曾在会话提供，这是须用户轮换的风险项；任何材料或录屏不得包含其内容。

## 评委追问与发布后的披露

[JUDGE-AUDIT-2026-10-07](https://github.com/litianyi-007/city-agent/blob/b899b0e4d7ae9b3cd91efa9a55969ab57c954215/docs/production/JUDGE-AUDIT-2026-10-07.md)逐项列出七栏缺口与产品对抗测试。本轮修复生成预览自导航外联、特殊凭据脱敏及输入镜像验收问题，新 Prompt/契约单列 v2，旧证据不改写。

全包真实 Jev 共 5 请求、输入 15027 / 输出 874 Token、按快照估算 0.000631134 USD，包含旧协议失败与混合失败；三项 Mock 生成费用为零，两者 scope 不混淆。v2 选择覆盖及选中通过均 2/3，仅选中条件通过为 2/2；不只选最后一个分母宣传成功。

历史 891fedc 视频展示旧 iframe，现已撤下该执行模式。保留历史视频不作为新版本安全验证；新截图与负例证据在当前工程测试中。六角色真实生成仍未实测、没有三项真实工单及同范围人工/无Verifier成本对照、正式团队成员与官方 L4 标准仍缺，必须保留这些硬缺口。
