# 虚拟调查结构化输出和未知知识处理的下一步方案

当前建议先完成离线结构化适配器和知识状态设计，再另行授权最小能力探测；不要直接再跑整轮居民调查。现行 DeepSeek 官方接口没有文档化的 `response_format: json_schema` 严格内容输出，JSON mode 不能保证多选数组。可研究保留 Harness SDK、增加固定自定义 LLM adapter，使用 Beta strict function arguments 作为纯答卷数据；这仍是待验证方案，不是本轮已交付能力。

## 最新真实失败揭示的两个独立问题

本轮原件为 `output/live-proof/f736fda5-2b12-4918-b843-1421e1c76454/`，不得重写或升级其结果。

| 场景 | 计划 | 启动 | 结构通过 | 结构及登记逻辑及资格联合通过 | 未启动 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 小学照护者 | 10 | 1 | 1 | 0 | 9 |
| 宠物零食 | 10 | 4 | 3 | 3 | 6 |

照护者第一份的 `reachable-streets` 为 `["puyan","unknown"]`，违反整题未知与具体街道互斥规则。宠物第四份的 `past-snack-categories` 为标量 `"unknown"` 而不是数组，违反题型结构。两者分别属于知识语义和传输结构问题，不能用单一 JSON mode 解决。

独立审计对十份计划记录逐项复核，会把未启动记录归为不通过；这不是十人实际作答失败。报告必须同时保留启动、未启动、结构、逻辑、资格及联合分母，不能把 `survey.metrics.valid` 等同于业务联合通过。

## 官方接口和本机 SDK 的支持边界

DeepSeek Chat Completions 文档的 `response_format.type` 仅列出 `text` 和 `json_object`；后者保证 JSON 语法，不保证我们的问卷 schema。指定 `tool_choice` 可以选择特定函数，但要求关闭 thinking。不能因为兼容 OpenAI 接口就推断同样支持 `json_schema`。[官方 Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/)

官方 strict 模式针对工具函数，要求 `/beta`、函数 `strict:true`，每个对象所有属性都在 `required` 且 `additionalProperties:false`。其支持数组、枚举及 `anyOf`，但不支持 `minItems/maxItems` 和字符串 `minLength/maxLength`。因此必须保留本地上下界、唯一性及跨题检查。文档未明确列出 `null` 类型支持，本项目大量 nullable 题不可未经探测就声称兼容。[官方 strict 工具指南](https://api-docs.deepseek.com/guides/tool_calls/)

项目本机安装 `@deepseek-ai/dsh-sdk-client`、`@deepseek-ai/dsh-llm-pi-ai` 均为 `0.1.5-rc.3`，只读检查发现：

- `dsh-sdk-client/lib/types/types.d.ts` 的 `DeepSeekHarnessOptions`、`api.d.ts` 的 `RunOptions` 没有 `response_format`、`tool_choice` 或 schema 入口。
- `dsh-llm/lib/types/types.d.ts` 的 `GenerateOptions` 有工具 schema，但没有内容 response format 或强制工具选择字段。
- `dsh-llm-pi-ai/lib/types/catalog.d.ts` 的 `compat.supportsStrictMode` 明确只指工具定义是否接受 `strict`，不是启用严格内容 schema 的开关。
- `dsh-llm-pi-ai/lib/index.js` 的 `profileOptions/streamWithSnapshot` 没有转发内容输出 schema、`onPayload` 或 `toolChoice`；其 `toolsOf` 只保留 name、description、parameters。底层 pi-ai 自身虽有 `onPayload/toolChoice/constrainedSampling` 能力，当前 Harness 封装没有直接公开，不能在页面随便加字段就认定生效。
- `server/research/single-request-relay.ts` 当前只接受六个固定 wire 字段，并禁止 tools、固定到非 Beta endpoint。任何新增 strict 路线必须新版本化，不能原地放宽旧实验契约。

Harness 官方提供 `LlmAdapter.stream()` 和 `registerAdapter()` 扩展缝；本机类型也可检查。这支持保留 Harness 自定义固定 transport，而不是全面替换底层或修改 `node_modules`。官方当前源码不等于本机安装版本，适配仍须锁定并测试 `0.1.5-rc.3`。[官方 adapter 指南](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/practice/llm-adapter.md)

## 推荐的最小适配方案

固定、版本化 `questionnaire-strict-beta` adapter，仅接受预登记问卷、官方域名、批准模型和一个数据收集函数 `submit_questionnaire`。函数没有外部执行实现，也不暴露 shell、MCP、文件或居民工具。adapter 只请求一次 provider，把唯一匹配的函数 arguments 原文送入 Harness 的普通文本流；不会把工具调用送回 agent loop 导致执行或第二模型回合。

这是拟议的数据传输映射，不是已证明 SDK 原生结构化输出。必须保存原始 provider packet、原始 arguments、schema/adapter/task/rules Hash、finish reason 和 usage，并明确 `ResponseRecord.raw` 是未改写的 arguments 字符串；不得对值做 scalar→array、替换 unknown、重排答案或补齐题目。多函数、错误函数、混合内容、截断、空内容、unknown usage 或网络失败均停止，不降级到 prompt-only，不自动重试。

问卷编译为受限 schema：每个 answer 的 `questionId` 用单项枚举，`value` 与该题严格绑定；整份仍经过既有 strict 答卷和跨题校验。答案数组不能仅用一个宽泛 `value:anyOf` 允许任意 questionId 对应任意题型。Beta 不支持的数组长度、去重、完整题数和业务条件仍由本地校验拒绝，不能偷偷削弱门限。

多选可研究 `anyOf` 三类数组分支：普通选项集合、只含 unknown 的集合、只含 none 的集合，从类型层拒绝普通选项与排他选项混合；重复 unknown、空数组和长度仍需本地拒绝。该组合在 Beta 的实际支持尚未探测，不作可用承诺。nullable 的保留必须作为前置能力门；若拒绝合法 null，应停止路线评估，不能把未知改成 0、空字符串或猜测偏好。

relay、预算和证据都需新版本：加入完全固定的 tools/tool_choice/endpoint 白名单、并发与第二请求拒绝，预算在请求前计入整个序列化 schema、消息、输出上限，继续 fail closed。禁止旧实验日志自动恢复、余款自动再跑或自动切模型。

## 未知和部分知识需要单独设计

当前 `unknown` 代表整题无法回答，与具体选项互斥；`none` 表示明确没有行为，不能与未知互换；`null` 表示允许缺失，不能记作零。部分已知信息不应硬塞进整题未知选项。

本轮照护者画像仅提供居住街道，没有真实出行路线。知道住在浦沿不等于证明能够到达整个浦沿、长河或西兴。建议未来新问卷版本把三个街道分别询问“确认可达、确认不可达、尚未确认”，或区分“已确认范围列表”和“其余范围未知”，并登记每项知识依据。未知不等于不可达，空已知列表不等于没有可达街道；此时样本应保持缺口，不能用于选址。

过去30天没有行为记忆或来源时，整题 `["unknown"]` 是正常答案；资格假设、五层人格、收入或年龄不能生成过去购买记录。未来意向可作为显式合成情景表达，但仍不是现实订单或市场偏好。`needed-evidence` 等开放题缺失也需要单独报告，不因结构有效就算研究内容充分。

可以保持当前问卷仅把规则发送得更明确，以便隔离 transport 改动；也可以另开知识状态问卷版本。两者不能混在同一对照实验中，不能事后修改本轮互斥规则使 `["puyan","unknown"]` 变为通过。不得要求非 unknown 比例达到某值来逼模型猜答案。

## 最小离线任务和 evaluation 门限

| 任务 | 验收门限 |
| --- | --- |
| 支持矩阵及 schema compiler | 每个17题及18题的 questionId/value 类型一一对应；禁止未知字段；支持与不支持字段显式列出，null 未确认不得标支持 |
| 本地 provider fixture 与 Harness 进程集成 | 唯一固定函数、arguments 原文逐字节进入最终答卷；每个 invocation 上游请求至多1，工具执行和额外模型回合均0 |
| 正负及边界回归 | 合法单选、多选、数字、量表、文本、unknown、none、null全部通过；标量多选、unknown混选、重复/缺题/错题ID、超界、错误函数/多函数/混合内容、截断及未知usage全部拒绝；回归100%通过 |
| 预算和安全 | schema计入请求前保守预留；并发第二次、redirect、retry、endpoint/model/schema漂移拒绝100%；Key公开导出泄漏0；错误不产生新请求 |
| 历史证据 | 两轮旧 raw 和报告 Hash 不变，已有失败仍失败；离线 fixture 不标记真实模型、真人或市场验证 |
| 知识状态设计 | none/unknown/null/部分未知逐项定义；住址不自动推出出行，资格不推出购买史；缺口可完整表达且不被计作真实偏好 |

以上是拟议下一批任务，不是已实现结果。离线测试不能证明 Beta 实际可用或真实模型质量。

离线门通过后，先另行确认小额、最多4个请求的能力探测授权，明确官方 `/beta`、固定模型、nullable、array/enum/anyOf 和单回合停止策略。探测失败就停，不回退重试。通过后再独立预登记两个场景各10个固定画像的新轮：每场联合通过10/10才写完成 smoke；首次失败停场、残余记 not-started，usage/成本不确定停全部。即使20/20通过，也只证明本轮工程与登记逻辑，不能认证人格效度或真实市场结论。真实效度仍需合法真人留出数据与业务观测验证。

本方案没有发起付费请求、读取 Key 或数据库，也未修改代码、旧材料或实验原件，未执行 Git 命令。
