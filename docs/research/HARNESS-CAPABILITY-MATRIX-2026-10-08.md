# Responses 路线能力矩阵与最小离线 Harness slice

记录日期：2026-10-08（Asia/Shanghai）。对应[主线任务3](NEXT-ROUTE-ADVERSARIAL-REVIEW-2026-10-07.md)。本记录没有新增实网模型调用、读取凭据、安装或升级依赖。生产 `server/harness.ts` 及页面路由未修改。真实 API、具体模型/账号的约束执行能力仍待新授权；关闭账本的余量不构成授权。

## 最新追加：schema穿过真实DSH的离线切片

最小transport探针之后已完成[自有adapter wrapper](../../server/research/structured-harness-adapter.ts)及[Cordis plugin](../../server/research/structured-harness-adapter-plugin.mjs)，通过真实DSH子进程的`ctx.llm.registerAdapter`扩展缝发送完整17/18题schema。两套答卷保留显式null和合法0，运行时核对schema/body/raw response hash，经过独立decoder；19项定向测试通过，并由非作者复审。每个受控fixture最多一次localhost请求、工具执行0；14类失败流在发布内容前拒绝，第二次真实SDK调用被consumed guard阻止。

此实现只接收自有localhost fixture、固定8事件序列，不接任意endpoint/Key，不导入生产路由。它证明**schema已穿过DSH自定义adapter**，不证明原pi-ai profile透传已修复、供应商执行schema、通用Responses兼容性或实网预算见证通过。下面矩阵保留第一切片的原始观察；其中“尚未穿过DSH”只指原profile/直接pi-ai探针，不是本新增切片的状态。生产bounded adapter与真实关键字探测仍单独过门。

复现（Node≥22.19，已安装锁定依赖）：

```sh
node --import tsx --test tests/structured-harness-adapter.test.ts
```

## 第一切片结论（原始观察保留）

固定 DSH SDK **能够选择 Responses transport，但原有 pi-ai profile 封装不能传入原生输出 schema**。真实 SDK 子进程在 localhost fixture 上发出一次 `POST /v1/responses`，处理完整语义 SSE，工具调用/结果事件为0。尝试 profile 的 `text.format` 和 `samplingParams` 后，请求体仍没有 `text`。它们不应被当作配置成功。

相同固定依赖的底层 pi-ai 有 `onPayload` 扩展缝。直接调用它能把完整17题/18题的 keyed answer schema 原样送到 localhost，schema hash一致。这条测试绕过了 DSH 的 pi-ai profile 封装，**不能写成“schema已穿过Harness”**。fixture返回预置文本，不运行模型，也不执行 JSON Schema；一个故意不符合完整答卷 schema 的文本照样通过 transport，更说明 HTTP/SSE完成和 schema执行是不同证据。

目前任务3只完成官方事实核对、固定封装核对及最小 transport slice。生产可用的固定 schema adapter、跨 SDK/relay 的原文见证绑定及真实关键字探测仍未完成。

## 四层证据矩阵

`声明`表示官方登记；`源码确认`表示本机固定代码支持；`fixture`只表示本地字节或受控事件通过；`unknown`不外推为不支持或支持。

| 能力 | 官方声明 | 固定 SDK/封装 | localhost fixture | 真实 API |
| --- | --- | --- | --- | --- |
| DeepSeek Responses endpoint | 官方指南说明 Responses 格式及 API 根地址 | pi-ai协议表注册 `openai-responses`；DSH provider profile可选择 | 真DSH child发送 `POST /v1/responses` | unknown，未请求 |
| `text.format.type=json_schema`、`name`、`schema` | DeepSeek Responses接口登记，`name/schema`在该类型必填 | 高层Options/RunOptions无字段；profile schema和 `profileOptions` 不提供透传 | 尝试profile字段后 `body.text`缺失，构成封装阻碍证据 | unknown，未请求 |
| pi-ai `onPayload` | 属于客户端扩展缝，不是供应商能力声明 | pi-ai 0.85.1 类型/代码支持，实际发送前调用 | 直接pi-ai路线携带完整schema/hash；尚未穿过DSH封装 | unknown，未请求 |
| pi-ai `samplingParams` | 属于客户端原始body合并功能 | 底层Responses `buildParams`支持；DSH provider profile/请求转译没有它 | DSH尝试字段后没有schema；此探针未单测直接pi-ai samplingParams | unknown |
| `text.format.strict` | OpenAI Structured Outputs登记 `strict`及受限子集；所读DeepSeek Responses text.format条目没有登记strict字段 | pi-ai onPayload能构造字段，不证明DeepSeek识别 | 本fixture未发送strict，未探测 | unknown；不把OpenAI声明或Beta工具strict迁移为DeepSeek Responses支持 |
| SSE最终事件与文本 | DeepSeek指南列出completed/incomplete/failed及usage；无 `[DONE]` | pi-ai按Responses语义事件处理，DSH再转译 | completed可完成；no-terminal/incomplete不完成 | unknown |
| 每次调用请求≤1、自动重试0 | 本地运行策略，不是供应商元数据 | 显式provider `retryPolicy.maxRetries=0`；离线patch禁用 `llm-retry`；pi-ai请求 `maxRetries=0` | completed、HTTP500、no-terminal、incomplete均只观察1次请求 | 受预算实网adapter尚未实现/验证 |
| 工具执行0 | 本地执行策略 | 离线profile禁用shell/process/sandbox工具；请求没有工具定义；直接pi-ai设置 `tool_choice=none` | 上述受控文本fixture的tool call/result事件均0 | 非文本/恶意工具响应的硬拒绝仍需bounded adapter证明 |
| schema/body/raw绑定 | 本地证据契约 | 本探针记录候选schemaHash、观察schemaHash、精确body SHA-256和原始SSE SHA-256 | 直接pi-aischema相等；DSH observedSchemaHash=null | 不等于已接入生产relay或usage见证 |

DeepSeek的[Responses接口](https://api-docs.deepseek.com/zh-cn/api/create-response/)明确登记json_schema、名称及schema；[Responses指南](https://api-docs.deepseek.com/guides/responses_api/)声明format支持并列出SSE终止、usage口径及不支持的参数。OpenAI的[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)说明自己的 `text.format`、strict子集及拒绝/截断例外；该资料用于协议背景，不是DeepSeek能力证据。所有官方页面均已实际读取，检索摘要未单独作为结论来源。

## 新答卷 schema 的逐项状态

[新compiler](../../shared/answer-contract.ts)版本为 `resident-answer-object-1.0`：固定residentId；answers为按题ID展开的object；所有题ID进入required；可选题以明确null保留ID；不修改历史数组答卷。以下“可表达”仅指compiler产物，不证明供应商执行，独立schema oracle由任务4负责。

| 业务要求 | 当前JSON Schema表达 | 固定pi-ai透传 | DeepSeek Responses关键字执行 |
| --- | --- | --- | --- |
| 固定居民/全部题ID/拒绝额外属性 | object、properties、required、additionalProperties:false、residentId单值enum | fixture原样送达 | unknown，未逐关键字探测 |
| 单选 | string、enum | fixture原样送达 | unknown |
| 多选数组 | array、items、enum、minItems、maxItems | fixture原样送达 | unknown |
| 多选不重复 | uniqueItems:true | fixture原样送达 | unknown |
| 排他多选 | not + minItems:2 + contains + enum | fixture原样送达 | unknown；优先探测项，不能静默删除约束 |
| 整数等级题 | integer、minimum、maximum | fixture原样送达 | unknown |
| 数字题/合法0 | number、minimum、maximum；0与null有不同原始字节 | fixture原样送达 | unknown |
| 文本非空/长度 | string、minLength、maxLength、pattern；长度按Unicode code point | fixture原样送达 | unknown；供应商正则/Unicode实现未证实 |
| 可选题显式未知 | anyOf:[value,{type:null}]，题ID仍required | fixture原样送达 | unknown；不能借Beta工具anyOf声明代替Responsesnullable实测 |

DeepSeek Responses页面并未在所读条目逐一列举这组JSON Schema关键字的子集。Beta strict函数参数属于另一条候选协议。这里只声明官方已经存在Responses json_schema接口，不推断 `not/contains/uniqueItems` 或nullable已经可用。若真实探针报schema不支持，应记录原始失败并保持研究约束；不能删掉排他规则再称“完整问卷原生约束通过”。

## 最小slice的可复现边界

实现：[structured-capability.ts](../../server/research/structured-capability.ts)；验证：[structured-capability.test.ts](../../tests/structured-capability.test.ts)。此模块没有被应用路由导入。对外函数只接收schema、预置响应和fixture模式；没有任意endpoint、provider key、fallback model或retry参数。它自己启动 `127.0.0.1` fixture，使用固定虚构Key；子进程完整环境仅保留PATH/LANG和该虚构Key，使用临时独立Harness home，退出时关闭子进程并删除自己的临时目录。

探针的两种模式：

1. `harness-profile`：真正 `DeepSeekHarness` → `sdk-minimal` →固定pi-ai provider → localhost。明确512输出token、30秒期限、retryPolicy0，禁用llm-retry与host工具；`supportsDeveloperRole:false`保证fixture里的系统提示为system。故意尝试额外profile字段，记录它们未到达请求体。
2. `pi-on-payload`：固定pi-ai Responses adapter直接调用 →仅允许该fixture的fetch。fetch只允许一次请求、一个准确URL并拒绝redirect；onPayload只加入被冻结schema。它是adapter设计的可用底层缝，尚不构成DSH新adapter交付。

测试使用完整17题schema、完整18题schema；原始响应保留null和0字节。还覆盖HTTP500、SSE缺少终止事件、incomplete终止、输入超限。它不调用新decoder来“证明供应商遵守schema”，也不把SDK归一化usage当上游用量见证。已完成的受控fixture均观察单请求/零工具事件；未模拟的响应种类及进程/网络故障不能外推。

本次验证：10项离线探针测试通过；`tsc --noEmit`通过。请求body hash对接收到的原始bytes计算，UTF-8文本仅在完整拼接后严格解码，避免分块解码改变非ASCII字节。

复现（已安装依赖，不运行安装）：

```sh
node --import tsx --test tests/structured-capability.test.ts
```

## 下一步最小bounded adapter候选

保留DSH SDK的子进程、session和agent loop；在现有 `ctx.llm.registerAdapter` 扩展缝注册唯一研究路线。adapter只接收一次冻结答卷契约，用已证实的底层pi-ai onPayload插入固定schema，或发送固定Responses body。不要给调用方开放任意body merge、任意endpoint或可执行onPayload函数。固定route/model/API路径，限制为已预登记的relay地址；拒绝工具定义、工具输出、第二model step、redirect和自动重试。不能把待配置profile metadata变成已支持功能。

建议冻结并核对以下契约：

- invocationId、adapterVersion、model/protocol和单请求能力上限；schemaVersion及canonical schemaHash；task/rules/residentId绑定。
- SDK侧冻结原始prompt/schema、准确请求body bytes和bodyHash；relay侧独立复算准确bodyHash与schemaHash；body大小/schema成本进入预算reservation。
- 只接收一个正常completed文本输出；refusal、tool/function/custom输出、failed/incomplete、缺终止事件与原文/模型/schema漂移均失败；关闭调用，保留异常证据，禁止继续回合。
- 原始SSE terminal及usage单独见证，再与SDK总量比较。此部分依赖任务5，不由本探针的硬编码usage样本代替。

固定DSH SDK高层options只允许route/model/reasoning/maxTokens；profile的键集合及 `profileOptions` 明确限制了配置透传。扩大profile字段不等于调用底层onPayload。最小adapter因此需要真正连接 `llm` seam，而不是在请求旁边附一个“schema hash已配置”的metadata。

### retryPolicy遗漏风险

`@deepseek-ai/dsh-llm-pi-ai` provider类型写明：省略retryPolicy时normal模式默认5次重试。`sdk-minimal`还实际挂载 `llm-retry` 插件，因此原封装默认不能泛称单次请求。底层pi-ai和OpenAI HTTP SDK当前被显式设为0，不会消除DSH agent recovery层的默认5次策略。本探针明确配置0并禁用该插件；生产 `server/harness.ts`已有retryPolicy0，但其硬性单step保证不在本探针范围。后续固定adapter既应返回明确0策略，又应在relay/adapter边界拒绝第二请求。

## 固定依赖与源码快照

运行Node：22.22.3。DSH SDK、pi-ai wrapper：0.1.5-rc.3。底层pi-ai：0.85.1；其OpenAI SDK依赖：6.40.0。未升级或修改node_modules。

| 文件 | SHA-256 |
| --- | --- |
| `server/harness.ts`（未编辑） | `52b005ae3c831c2a25366bd7eb38e418066850d2f2b36cb06dba33216e8605ff` |
| `node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js` | `3e936345f36c1845ad07a66084a126cd0a9b511aa192501932874d7e09b9e7b8` |
| `node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js` | `1f787eb5cd3d0308e7a2563cdb2b8cc2c1fc153fe06b55d39439fb2446059483` |
| `node_modules/@earendil-works/pi-ai/dist/api/openai-responses.js` | `87085aa3c3c865fb51774bc13b669599461fd29e497fc6063bd6f5b9b5262d33` |
| `node_modules/@deepseek-ai/dsh-sdk-minimal/cordis.patch.yml` | `31805d5b233c33eabc57f4bac562b2d2db00e8a7bb1f205926f43e5f84749680` |

关键读点：SDK `lib/types/types.d.ts`第51行的高层options；SDK `lib/types/api.d.ts`的RunOptions；wrapper `lib/index.js`第978行起profile键、1659行起profileOptions、1867行streamSimple调用；底层pi-ai `api/openai-responses.js`第114行onPayload、第209行buildParams；`dist/types.d.ts`第73行onPayload与samplingParams；DSH `dsh-llm/lib/types/retry-policy.d.ts`默认5次；sdk-minimal patch第97行挂载llm-retry。这些是代码事实，不是由model catalog metadata推断的能力。
