# HTML-03：费用记录页单次真实探索结果

## 1. 结论与体验入口

2026-10-08，按用户批准的**仅一次、1 USD 声明价限额**，在[本地生产工作台](http://127.0.0.1:4420/#production)实际输入[预登记](PRE-REGISTRATION.md)的费用记录页需求、来源及八项业务验收，完成免费预检后通过页面启动。真实运行 `271a1ada-37ed-4b28-b5ab-b7cbdc910e97` **failed**：测试角色三份候选均超过每项20步的既有上限，共享两次自动纠错耗尽后停止，没有交付 HTML。

本次属于用户授权自拟需求上的真实模型调用，`kind=illustrative`、`mode=live`；不是实际业务工单，也不是 Mock 响应。没有 demoCaseId、外层预填 checks、现成源码、手改模型候选、模板回退或临时放宽 Gate。产品、研究及首次项目规划获独立 LLM 评审接受，不能替代完整需求交付。**没有冻结验收、研发调用或浏览器 Gate，因此八项业务行为均未获最终执行认证。**

本地运行列表可选择 `HTML-03` 查看原始输出、事件、两次返修和失败附件；无需再启动任务。跨设备可按[评委安装指南](../../REVIEWER-GUIDE.md)安装生产分支，并运行下面的只读证据测试，无 Key、不产生模型费用。公开 [GitHub Pages](https://litianyi-007.github.io/city-agent/production/)仍是已发布 v6 的可信固定案例及材料入口，不是新需求的在线 Harness 后端；推送本次源码/证据不等同发布新 Pages。

## 2. 固定来源与免费预检

付费前预登记、源码和测试已提交并推送为 `2c69fcb721aa84f6a065b9441494834dbf4192fb`，随后干净重建并重启本分支服务。运行及启动前 metadata 绑定同一身份：

| 项目 | 原始记录 |
| --- | --- |
| source commit | `2c69fcb721aa84f6a065b9441494834dbf4192fb` |
| build 时间（UTC） | `2026-10-08T04:44:45.768Z` |
| 进程启动（UTC） | `2026-10-08T04:45:10.186Z` |
| bootId | `f29bf2e6-e86a-4969-941c-b9f8e982da5a` |
| sourceFingerprint | `2fc08e7e134f1fc1f6f7226ee6a7d2f2a545ed0b52c7e3eecf9cb099c0b22935` |
| buildFingerprint | `2e3d8c0fb99ae8ba87fa915f0ae43734acd94d9f1cbbb1e25da382170ed663f8` |
| source/build 状态 | clean，ready=true，issues=[] |
| 免费预检 reportHash | `fbab32afd35595c707748335719a3375199d3e804aa1eb47d4b15e7c49d68712` |

[launch-preflight.json](launch-preflight.json)在付费前保存，`ready=true`、`paidAuthorized=false`、`modelRequests=0`、`finalGate=null`。第一次请求安全预留71,536 Token／0.0268608 USD；正常12／最坏24逻辑调用包络，不是完成保证。最坏 Token 包络高于500,000总限额，报告已提示；实际运行未到该额度。公开报告 hash 不是付费授权或被消费的启动令牌。磁盘身份与后续 freshness 校验不冒称已加载模块字节证明、独立签名或安全沙箱。

六角色均为页面实际选择的 DeepSeek `deepseek-flash`、`https://api.deepseek.com`，输入/输出声明价0.30/1.20 USD每百万 Token；`hasApiKey=true` 仅是脱敏状态。Key不进入公开原件、Prompt或此文。N=1，`llm-rubric`、legacy 实现证据政策，**未调用 Jev**。Prompt `production-html-v10`、Verifier `verifier-phase-ordinal-v5`，其余版本、角色 ID及预算见原件，未猜测 temperature、seed 或账单折扣。

## 3. 实际链路、结构缺陷与覆盖缺口

创建于 `2026-10-08T04:47:58.936Z`，失败终态事件 `2026-10-08T04:49:03.930Z`；原记录耗时 **64,951 ms（64.951秒）**。实际9个逻辑 Harness 调用与9次观测 HTTP POST：

`产品 → 产品Verifier → 研究 → 研究Verifier → 项目规划 → 规划Verifier → 测试 → 测试返修1 → 测试返修2 → 失败`

三次真实独立 Verifier 接受分数分别为5、5、4；测试阶段另三条 `abstain` 是宿主结构拒绝，没有额外 Verifier 模型调用。两次返修均为冻结前 `acceptance` 的 `stage-regeneration`，不是研发后修复。`interventions=[]` 表示账本记录的中途人工介入为0，不据此宣称系统已有通用 L4/L5 可靠性。

三份 Tester 原文均为完整、可解析的 JSON。按当前未放宽的 schema 静态重放，拒绝均为 `steps > 20`，不是 JSON 语法错误、费用耗尽或浏览器失败：

| 候选 | 各项实际步数 | 超限检查索引（从0计） |
| --- | --- | --- |
| 初次 | 14,20,21,17,14,21,19,19,21 | 2,5,8 |
| 返修1 | 17,20,21,18,21,21,20,18,23,23 | 2,4,5,8,9 |
| 返修2 | 17,20,20,17,15,24,19,19,22 | 5,8 |

每轮 Prompt及同源 schema 均明确最多12项、每项20步。两轮反馈正确绑定前次 call/candidate ID与完整原文 SHA，保留完整结构错误；原文摘要限制为2,000字符，所有超限项均在摘要之外。因此不是“错误被完全丢失”。虽有超限索引，但缺少各项实际步数及超限项完整内容，可能影响重新组织；这是工程推断，不证明模型内部失败的唯一原因。

独立对抗审查还发现更深的业务缺口：三份候选在“已有有效记录”状态下均只检查五种非法金额中的两种，未覆盖原要求的五种×空/已有两态；第三份成功添加后清空描述，后续两次非法金额操作没有重新填写合法描述，拒绝可能由空描述造成，不能隔离金额规则。**即使机械压到20步，也不能追认为完整需求通过。** 研究/项目规划知道数量约束，但未明确逐项 setup、操作和断言的容量分配；规划 Verifier 自身也指出预算职责不足。

本次仅产出失败 `delivery-manifest.json` 与 `evidence.json`，`gateHistory=[]`、没有 frozenContract、Gate、index.html 或预览。旧 HTML-01/02、CAMERA 和 Verifier 实验、申报原稿及冻结 Tag 均保留，配置不同的探索不合并成同一稳定成功率实验。

## 4. 用量、费用与原字节

9条预算记录、9次实际 HTTP POST，全部200及完整 usage；Jev0、未知请求0。**57,698输入／14,718输出＝72,416 Token**，声明价估算 **0.034971 USD**，公式 `(57698×0.30 + 14718×1.20)/1000000`。供应商账单、外层开发 Agent Token／人工和机器成本均 unknown，不能记为零；未执行的研发/Gate不是虚构的零成本成功阶段。1 USD约束后续调用启动，不是供应商收费硬上限；没有追加第二次真实实验。

以下五份为 API 导出及付费前 metadata/preflight 的原字节，与本地下载一致，不修补旧内容：

| 原档 | SHA-256 |
| --- | --- |
| [run.json](run.json) | `6d655a48107a0f0837c4f38809c391f61f8e43c09817d154a0f4b97795f507dc` |
| [evidence.json](evidence.json) | `ab388d64af1f8018a263f57a67473385aa7da6549c6cb284a5aab6d4a882614c` |
| [delivery-manifest.json](delivery-manifest.json) | `f5dd37ade31acfea6165b2705b03e132bf92743ae8e64ce10f366bc2394a8c14` |
| [platform-metadata.json](platform-metadata.json) | `e6c32011452e576575a4a1da07305a5c6144b247a3a2bb15b0ddc444820682e7` |
| [launch-preflight.json](launch-preflight.json) | `5ceecc7191a4a8b9082d2b99195fd67ee1552be3b55384b762b0aa85db8807e0` |

付费前免费工程 **793/793 Node＋重建后54/54浏览器通过**，包含虚拟社会回归及预检权限/延迟响应反例；完整失败与重建过程见[BATCH-HTML03-PREFLIGHT-CHECKS](../../BATCH-HTML03-PREFLIGHT-CHECKS.md)。这些是平台工程结果，不是本次真实自主交付成功。

只读历史核验（Node22.19+，先按指南 `npm ci`）：

```sh
npx tsx --test tests/production-html03-evidence.test.ts
```

实测后的只读证据验证：新增历史测试 **7/7通过**（主代理复跑448.743ms）；既有 HTML01/02、预检、来源、凭据代际及归档兼容专项 **51/51通过**（12.502秒），TS与diff检查通过。两组是专项，不追认为新的完整800项全回归，也不替代付费前793/54项工程结果。对原件、费用及文档进行非作者交叉审查，修正了“反馈缺少超限定位”的措辞：原反馈已有索引，缺的是实际步数和超限项正文。

该测试仅读取原件、核对 hash、解析结构和核算账本，不外呼模型、不启动浏览器、不执行候选代码、不生成替代答案。复制或下载到外部环境不继承平台隔离；本次没有可执行 HTML 附件。

## 5. 下一步：先免费改进，不沿用剩余额度

在新的源码版本实现通用容量诊断：检查总数、逐项实际步数、超限索引与上限、原文 SHA；研究/PM/tester使用同源容量事实，明确独立 setup 和全部断言预算。Tester仍须自主重生成完整候选，不由宿主删步、拆改已产出 checks、自动修 JSON、增加返修或放宽12/20门限。负例要求只改变被测变量，其它输入合法，覆盖审核与机械合法分列。

用三份原件做免费反馈重放、边界/秘密隔离回归并独立审查；可以静态设计12组内的覆盖，但不能把外层设计充作内部 Agent 的新交付。上述改进在本结果提交时仍是下一任务，不混入 source2c69 的失败归因。下一次真实运行需新编号、固定配置和新单次预算批准，本次剩余额度不构成续跑授权。
