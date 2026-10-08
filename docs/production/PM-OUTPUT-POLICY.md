# 分阶段 PM 输出协议：grouped v2

2026-10-08，免费工程切片。依据 [HTML-05 原件与结果](experiments/HTML-05/RESULT.md)，改进新配置，不修改旧失败或生成产物。旧通用业务提示要求在 `acceptance/constraints` 记录默认值，但普通 PM 与验收计划均没有这些字段；这是可复现的协议矛盾，不是已证明的模型失败因果。

## 新配置与兼容范围

只对显式 `acceptanceStrategy=planned-groups-v1` 生效，Prompt 为 `production-html-grouped-v2`。策略名字和实际计划、分组、验收 Schema 不变。没有 opt-in 的 HTML v11、camera v7、旧 grouped v1 提示与原实验保持字节相同。旧运行不迁移，不根据新诊断追认旧答案通过。

| 阶段 | 实际闭合根对象 | 合法设计默认值记录位置 |
| --- | --- | --- |
| think-design、feedback-N | decision、summary、tasks、risks | summary、tasks[].description、risks[] |
| acceptance-plan | version、obligations、groups | obligations[].scenario/expected、groups[].checks[].setup/exercise/assertions |

`pmOutputPolicy`（`production-pm-output-policy-v1`）从本次实际 Zod input JSON Schema 派生允许/必需字段、闭合规则和完整 `outputContractHash`。默认值路径必须真实存在且为字符串；不能借用 quote、ID、version 编造用户原话或控制面身份。根字段导航不代替嵌套 tasks 项、数量/长度/枚举、真实原话绑定、业务覆盖与最终 Gate。

新分组提示唯一替换旧默认值记录句，不追加相互矛盾的覆盖指令。决策依据只写 summary，不新增 decision_note、解释性元数据或空额外字段。完整对象闭合后不得再追加 tasks；仍严格完整解析，不提取可解析前缀、不剥离未知字段、不修 JSON。

## 拒绝诊断与返修血缘

`roleSchemaDiagnostic`（`production-role-schema-diagnostics-v1`）仅解释 PM 结构拒绝：固定 issue code、由实际 Schema 导航得到的安全 path、未知键数量、总 issue 数与最多八条定位。未知键名、原 Zod message、任意 provider path 不进入诊断；数组索引折叠为 `[]`，未知路径退回最近合法容器。原文仍作为明确不可信、已脱敏的有界拒绝片段另行保留。

诊断绑定真实 role、phase、callId、candidateId、已脱敏完整原文 SHA-256 与完整输出契约 hash。下一 PM 请求前重新核对拒绝源、片段、截断标志、拒绝原因，并从原文/实际 Schema 重算诊断；篡改或删除诊断失败关闭。语法错误继续走 JSON 诊断 v2，不伪装成结构问题。diagnostic 为 undefined 不能证明候选合法或业务通过。

合法候选可能被独立 Verifier 质量弃权。此时生成调用没有协议 error；返修核对实际同阶段、同候选 Oracle 调用的严格原响应，以及持久化弃权 reason/scores，不虚造 generation error。非法 Verifier、传输失败、unknown usage、取消、超时仍停止，不能用质量返修隐式重试。

诊断处理先限 256KiB UTF-8、10000 个 JSON 节点、深度16；超限只输出固定资源事实，不执行诊断的 Schema/refinement。它是诊断边界，不是供应商响应硬上界或新验收容量。实际候选仍先经过原严格 parser/Schema，Gate 与运行资源边界没有放宽。

## 不变的硬门限与安全边界

- 一次候选生成对应真实的新 call/candidate，旧非法答案保留。宿主不代模型修补。
- 阶段纠错、规划 revise、Gate 返修共用最多两次预算。合法候选质量弃权仍可按同预算再生成。
- 分组最多3组、总2–12项、每项1–20步，最终完整结构/语义/CSS/独立 Verifier 后才冻结。Oracle 接受不证明真实执行通过。
- 包络仍16初始/28最坏调用；实际用户 maxCalls 不自动增大。未知费用不记零。
- Agent 与 Jev 共用新协议字面量及所有 ≥16 字符子串凭据保护；旧加密凭据先对实际机器策略及每份完整新固定提示逐一碰撞检查，0请求失败关闭。原100000扫描工作量界限不变，不解密导出 Key。
- 只读历史原件与源码测试不产生模型请求；没有新增容器、任意仓库执行或线上 Harness 服务。

## 验证与后续

[本批工程/审查记录](BATCH-PM-OUTPUT-POLICY-CHECKS.md)分别记录工程、真实模型和费用口径。真实 HTML05 三份 PM 原文只读重放：两个额外字段依旧严格拒绝，第三份尾随 JSON 依旧解析失败；新诊断不回写旧反馈。

下一步先核对状态/负例的实际 setup、操作和断言步数，补完整分组闭环的可执行覆盖契约。研究/PM 文字声称“14步”不证明实际容量。本批没有新真实模型任务，不能宣称格式成功率、交付良品率或节费已改善。新配置实测需另预登记输入、版本、独立预算；HTML05 一次授权不续用。
