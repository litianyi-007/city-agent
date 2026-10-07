# VERIFIER-MOCK-01：注入三策略＋实际 Oracle 演练

证据性质：免费工程演练，不是真实模型评估、业务需求交付或 Verifier/Jev 效益结论。未打开生产 Key/store，没有调用真实 Harness/供应商，Jev fetch 始终注入本地 Response。没有修改旧实验、公开 v5、main 或虚拟社会 worktree。

## 冻结与实际执行

- 源码：`01ab356b0934b2ecce16799504ff94c8879a60cd`，启动时 clean=true，34份声明来源 hash 前后不变。
- Node22.22.3、Chromium153.0.8010.12；执行器 `verifier-study-injected-v1`、策略v1、账本v2。
- Run：`c80c6905-cc8f-44cc-9638-f3437896c9b7`。
- Study：2026-10-07T13:04:02.566Z → 13:06:14.113Z，**131.547秒**；CLI前后浏览器预检等另见 receipt 时点。
- 18个原人工池、36候选；54/54盲决策、54注入调用意图（36 LLM＋18 Jev）、36/36实际 Oracle完成，未启动/取消/协议错误0。
- 290事件＋290确认 marker。最后决策第217条，首个 Oracle intent 第218条；全部盲决策完成后才运行 Oracle。没有已有答案缓存，每次调用/决策独立UUID。

Mock LLM 固定选首 ID且所有候选给合法同分；Mock Jev固定 uncertain，然后恰好升级一次同条件独立LLM。两者不读取源码判断业务、控制标签或 Oracle结果。因此三策略的相同结果是预期工程行为，不是模型准确率。

| 策略 | 计划/尝试 | 选中 | 独立Oracle通过 | 业务失败 | 未知 |
| --- | ---: | ---: | ---: | ---: | ---: |
| baseline | 18/18 | 18 | 8 | 10 | 0 |
| llm（注入） | 18/18 | 18 | 8 | 10 | 0 |
| jev-cascade（注入） | 18/18 | 18 | 8 | 10 | 0 |

36份实际 Oracle 的原始行为结果为16通过、20业务负例，执行环境均健康；上表是选择后的计数，不等于36候选结果。控制标签不填入盲评请求，也不替代实际判定；独立外层Agent核对真实checks/场景business谓词与聚合一致。它仍是外层作者构造的挑战集，不是18个真实需求或内部Agent生成的产品。

## 用量与费用口径

CLI纯本地钩子＋injected fetch：外部供应商HTTP **0**，实际供应商费用 **0 USD**。模型效果/实际模型usage为null；机器和外层开发工具成本unknown。

账本的5454输入/378输出Token和0.000076356 USD是**合成夹具会计值**，用于测试累计预算及unknown机制，不是模型实测账单、费用预测或省费收益。通用runner无法观测任意注入hook的实际HTTP，故summary该字段为null；receipt/provenance的0只来自这个已审查的纯本地CLI，二者范围不同。

## 原字节与复现

本目录保留6份原字节：`manifest.json`、`events.json`、`commit-markers.json`、`summary.json`、`provenance.json`、`receipt.json`。manifest/input不截断；事件/marker聚合与本机逐文件逐字匹配。

| 原件 | SHA-256 |
| --- | --- |
| manifest.json | `85e96d3bb52fd33343d326a0394db4a7be4de18bbce60e9917c6e852b9e02817` |
| events.json | `b21dd0f52d96af7a5fa5af7867fede8153ced345481551978c4ba443e80bca70` |
| commit-markers.json | `42a3fdd81a0999e6627d0a35c155cbf1a690ddf88aab6ba5fab9c325625d425d` |
| summary.json | `897c4a5b320153738efe49f3866c95d539170fbd767724a9daa3facc39fd6353` |

本机完整账本：`output/production-verifier-study-mock-N9m8Zy/ledger`，581文件（manifest＋290事件＋290marker）。marker绑定原目录hash，归档副本可离线审核，不是可在任意新路径 `open()` 的活跃账本；不得重算旧marker、自动移植或重放。新设备从固定源码依[合同](../../VERIFIER-STUDY-CONTRACT.md)运行CLI，会创建新目录/新UUID和新证据，而非恢复这个实验。

## 工程验证和下一门禁

同一冻结源码全量 Node **589/589，506.819秒**，独立4421/临时数据浏览器 **38/38，1.3分钟**；TypeScript、构建和diff检查通过。专项58/58，覆盖初始manifest/intent/响应/终态EIO、3个SIGKILL、unknown、无缓存、预算、取消、同步阻塞/定时器饥饿、晚响应和marker篡改；另独立审查8项修复回归通过。

下一步 VE-04 离线 wire/配置预检、真实 usage与取消观测、价格/最坏预留、顺序/参数/总预算冻结；另行确认后才执行 VE-05/06 真模型对照。不预登记 Jev 必优，不因本演练通过放宽真实验收。
