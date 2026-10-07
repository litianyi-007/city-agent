# Jev 语义与数值协议独立复核

日期：2026-10-07。范围：已结束的 CAMERA-06/07 前三个 Jev 评估、当前 `jev-candidate-v3` 数值校验和公开官方资料。外层研究 Agent 完成只读复核；本次没有模型请求、模型费用、代码修改或历史证据修改，不算平台内部交付。

结论：没有发现本地五级 Score/Confidence 公式的语义误读或联合 LP 数值错误。但每字段“最近舍入到两位小数、误差不超过±0.005”仍是本地版本化兼容假设，已查看的官方资料没有明确保证。不能仅据 `arithmetic-drift` 将供应商定性为计算错误；现有 v3 弃用异常决策、至多一次独立复核和最终业务硬 Gate 保持不变。

## 1. 一手来源及版本边界

| 来源 | 本次确认的事实 / 版本 |
| --- | --- |
| [TypeSafe Score](https://docs.typesafe.ai/primitives/score)、[HTTP API Score answer](https://docs.typesafe.ai/api#score-answer) | 等级是 criteria 数组从0开始的索引；score 是等级编号乘概率的加权均值。官方示例 `p=(0,.57,.43)` 对应 `score=1.43`。 |
| [TypeSafe Confidence](https://docs.typesafe.ai/confidence) | Score 用众数对应的概率加权绝对距离（MAD）相对均匀分布距离计算集中度；Choice 用最高概率相对均匀概率计算集中度。不是业务正确率或交付成功概率。 |
| [TypeSafe Models](https://docs.typesafe.ai/models) | 本批原响应均返回固定 `jev-1.13.0`。文档当前说明32k token的 state＋最长问题及64k token的整请求上限；平台32KB/64KB是保守字节预检，不冒充官方 token 数。 |
| [官方 JS SDK client](https://github.com/typesafe-ai/typesafe-sdk-js/blob/66880ccded6cb642dc1809620c2b108c33730214/src/client.ts)、[response types](https://github.com/typesafe-ai/typesafe-sdk-js/blob/66880ccded6cb642dc1809620c2b108c33730214/src/types.ts) | 固定 commit `66880ccded6cb642dc1809620c2b108c33730214`（v0.6.0）；client 解析 JSON 后返回，不在客户端重算或修正派生评分。这不是托管服务端实现的公开证明。 |
| [Jev 1.13 已知限制](https://docs.typesafe.ai/model-jaggedness/jev-1.13) | 页面标注2026-10-02复核，提醒数值精度、间接引用、多重判断与大量无关 state 的局限；建议原子问题和代码算术。这不等于官方已确认本批响应的内部原因。 |
| [AnyJev README](https://github.com/nokia-applied-research/AnyJev/blob/f82fe03bc0d01c9e340b4f8880b744e78ea6116d/README.md)、[result.py](https://github.com/nokia-applied-research/AnyJev/blob/f82fe03bc0d01c9e340b4f8880b744e78ea6116d/anyjev/result.py)、[等级说明](https://github.com/nokia-applied-research/AnyJev/blob/f82fe03bc0d01c9e340b4f8880b744e78ea6116d/docs/levels.md) | 固定 commit `f82fe03bc0d01c9e340b4f8880b744e78ea6116d`。项目明确独立于 TypeSafe/Jev；Decider 的 `Decision.confidence=max(probs)`，并非托管 Jev 的 MAD 语义。0.3.0 已移除 L1/L2，保留于0.2.0；未来采用须固定版本。 |

公开文档查阅于2026-10-07；这些网页不是历史运行时供应商文档的不可变快照。没有找到固定显示精度、最近舍入规则或 score/confidence 在概率序列化前后计算顺序的承诺，也没有读取托管服务端源码。

AnyJev 的同名字段不能直接用于反证或替换托管 Jev 协议；它的决策读出等级也不能与软件生产的 L4/L5 自动化等级混同。当前生产没有实施 AnyJev SDK。

## 2. 公式与原始记录核对

五级 Score：`μ=Σ(i×p_i)`；`C=max(0,1−Σ(p_i×|i−m|)/1.2)`，其中 m 是众数。当前客户端的五级分母1.2、零集中度截断、概率和=1以及联合可行域检查与该数学定义一致。

核对的原记录：

- [CAMERA-06 run.json](experiments/CAMERA-06/run.json)，平台 commit `e91a029f6f6053ef1afe260ff6f4557075ada776`。
- [CAMERA-07 run.json](experiments/CAMERA-07/run.json)，平台 commit `f30336381ed219b7738a5891e911da565aa1aaab`。

六次评估都只有一个候选，使用完整五级0～4 rubric；18项 Score 的显示概率均唯一众数为4。两次 product 评估是合法低分/低集中度的 `uncertain`；两次 research 和两次 think-design 评估触发六项 `score-concentration-drift`，不是 `score-mean-drift`。

| 运行 / 阶段 / 维度 | 返回 score / confidence | 显示概率复算均值 / 集中度 | 当前±0.005联合区间的正间隙 |
| --- | --- | --- | ---: |
| CAMERA-06 research / scope | 3.26 / .37 | 3.24 / .366667 | .005 |
| CAMERA-06 think-design / coverage | 3.30 / .39 | 3.27 / .391667 | .021 |
| CAMERA-07 research / consistency | 3.58 / .64 | 3.57 / .641667 | .001 |
| CAMERA-07 research / scope | 3.58 / .64 | 3.57 / .641667 | .001 |
| CAMERA-07 think-design / consistency | 3.47 / .57 | 3.48 / .566667 | .003 |
| CAMERA-07 think-design / scope | 3.42 / .53 | 3.44 / .533333 | .005 |

表中复算集中度为展示近似；比较使用原始 JSON 数值，不回写、不归一化供应商记录。上述唯一众数为4且 C>0 时，真实概率和为1必有 `μ=2.8+1.2C`。在 score/confidence 各±0.005的假设下，这六项自身派生区间已不相交，故拒绝不依赖 LP 数值求解的偶然误差。

全部18项返回 confidence 都接近显示概率按官方公式的复算值；部分 score 相差.01～.03。“score 使用隐藏概率、confidence 使用序列化概率”等处理顺序可作为待确认假说，但没有官方实现证据，不能当成根因结论。扩大容差追求通过也不能替代精度契约或独立业务验证。

独立纯内存复核覆盖了零集中度、并列众数及250组具有真实概率见证的舍入样例，未发现数学误拒。官方示例代码对并列众数取第一个最大值；当前校验允许任一可行众数。这不是本批异常原因，未来协议确认须明确 tie-break 边界。免费复核只是工程诊断，不是新增真实供应商效果样本。

## 3. 性价比：已测量的范围

仅统计 CAMERA-06/07 各自前三次已付费 Jev 请求及其升级，不混入 CAMERA-06 第四次本地容量拒绝：

| 指标 | 合计 |
| --- | ---: |
| 实际 Jev HTTP 请求 | 6 |
| Jev 输入 / 输出 Token | 44,364 / 972 |
| 按记录声明价格估算的 Jev 费用 | 0.001863288 USD |
| Jev provider duration 累加 | 5,480ms |
| 随后独立 LLM 复核 | 6次：2次 uncertain、4次算术异常升级 |

这六次级联没有省去 LLM 调用，增加了已知 Jev 费用与等待时间。duration 累加不是完整任务墙钟；声明价估算不是发票。CAMERA-06 整任务总用量/总费用仍 unknown，已知小计不能替代总额。

这些阶段来自两个不同工程配置的调优运行，不是固定配置的独立成功率实验；不能从“6/6升级”推导 Jev 普遍无效或供应商协议故障率，也不能把低单价直接表述成已证明的高性价比。

## 4. 下一步：最小可验证方案（计划，未实施）

1. 免费固化18项原响应的诊断重放，分别记录均值、集中度、显示精度假设及错误分类；不改旧运行的 failed 状态、原始响应和门限。
2. 在独立免费开发池试验原子判据与职责投影，保留全部业务约束、必要阻断信息和已验证平台责任，不能以删需求换低 Token。官方指南支持这一设计方向，不证明本项目一定获益。
3. 如研究“只从概率派生本地决策”，须新版本预登记精度与保守边界、离线对照及反例；供应商派生字段只作诊断，不能悄悄重算后冒充原 score/confidence。当前 v3 不采用该新策略。
4. 固定候选、独立 Oracle 和配置后比较单 LLM 与 Jev 级联：分别统计业务误判、合法弃权、协议失败、实际减少的 LLM 请求、总费率口径与墙钟。是否省费必须由完整对照证据回答。
5. AnyJev 如未来引入，单独适配字段语义、等级读出和运行成本，不作为本批托管 Jev 故障修复或软件 L4/L5 达标依据。

既有 [18池对照计划](VERIFIER-EVALUATION-PLAN.md) 仍为待建设、待冻结、待独立确认预算；本次没有建设18池、启动54个评审意图或开展供应商协调。当前门限仍为 Jev 最低3/4及集中度0.5、独立 LLM 最低3/5及最高分选择，最终冻结行为 Gate 不变。算术兼容也不等于业务达标或实体摄像头验证。
