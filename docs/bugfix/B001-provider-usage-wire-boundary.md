# B001：受预算请求的供应商用量与实际wire绑定

日期：2026-10-08。级别：P1。范围：新实验的 `runBoundedHarness` / 单请求relay及实验脚本CORS结算；不泛称普通页面和所有 `runRole` 调用已经得到原包见证。旧真实实验、材料、计划与关闭账本均保持原件。

## 根因及独立反例

固定SDK把缺失usage规范化为0/0；仅检查数字字段无法区分“供应商确实报告零”与“没有供应商用量”。本地真实SDK→HTTP fixture已复现缺usage仍正常完成文本；旧判断可能释放预留。供应商完整用量与SDK计数必须独立核对。

首次修复后的三位只读审查者又发现：relay只比Prompt长度而未比内容；首次坏JSON后能继续请求且不计拒绝；嵌套字段允许额外100KB内容而预算只计算messages；CORS只保留两个计数、不校验total/cache。上述反例均使用虚构Key和localhost，无实网费用。

## 已实施修复

- `provider-usage-witness.ts`检查完整非负安全整数、总和、缓存读写及辅助token；流式还需完整UTF-8、SSE事件与DONE。缺失、部分、污染、矛盾、截断和网络失败不能被默认零覆盖。
- `single-request-relay.ts` 2.0在读body前消费唯一invocation attempt；冻结system/user、模型、输出上限和完整body；严格嵌套白名单、完整输入bytes预算、冻结/实际转发hash；转发冻结序列化，不容许修正后重试、第二请求、重定向或工具。
- `bounded-harness.ts`只有唯一attempt/forward、无拒绝、body hash一致及供应商完整usage与SDK完整prompt计数一致才settle known；否则保留全额reservation并halt。缓存input口径为完整prompt，不重复加缓存。
- 实验脚本的浏览器JSON结算复用完整用量解析器，不保留任意raw usage对象。该测试仅JSON/guard离线反例，不声称供应商实网CORS已通过。
- 历史无冻结Prompt的relay调用在监听之前明确拒绝；不修改历史脚本或重开旧账本。新实验还需要独立授权及版本化计划。

## 回归与独立复核

测试：`tests/provider-usage-witness.test.ts`、`single-request-relay.test.ts`、`bounded-harness.test.ts`、`browser-provider-usage.test.ts`及原budget测试。包含真实SDK本地HTTP、合法零/正数/缓存、缺失/部分/负数/错总量、逐字节中文/emoji、socket失败、Prompt替换、nested注入、坏JSON后重试、完整body超预留等。

非作者复核：21/21离线安全测试通过；额外四种独立攻击（等长Prompt替换、首坏JSON后修正、预算内100KB嵌套字段、完整body差1byte超限）全部上游0请求，后续修正均拒绝。初始三份改前留底与既有git对象一致；后续新诊断另作只读投影，不回写历史成绩。完整工程验证见[本批报告](../research/OFFLINE-NEXT-2026-10-08.md)。

## 明确余项

Responses schema路线需要自己的终止、usage及完整body预算见证，不能拿Chat Completions witness直接认证。普通Harness/UI的normalized SDK计数仍不是供应商原包证明；其改版另立兼容性切片。人格/消费者/市场效度不由这个预算修复认证。
