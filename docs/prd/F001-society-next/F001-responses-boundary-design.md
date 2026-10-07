# F001 / T27：Responses 有界候选设计

日期：2026-10-08。对应F001 v1.1、T27及已确认的发布后计划。用户“往后继续推进”授权继续离线实施；本记录不授权任何真实模型费用或默认生产激活。原设计/材料/失败证据保留。

## 目标与边界

把固定8事件的localhost探针推进为可测试的研究候选：完整问卷schema与真实system/user绑定，冻结完整wire预算；兼容分块、多delta、CRLF及合法生命周期差异，在EOF后独立校验终态、原包usage和SDK计数。工具、拒绝、失败、截断、重复/身份漂移、缺usage或网络异常均失败，不输出部分“成功”内容，不重试、补答或跨模型回退。

候选不会被API/UI默认导入，不能据fixture声明供应商关键字已支持。真实探测属于T28，需要新预算和能力预登记。

## 模块与调用

```mermaid
flowchart LR
  C[冻结答卷契约与Prompt] --> B[完整body持久预算预留]
  B --> H[真实DSH / 单次adapter]
  H --> R[localhost单请求relay]
  R --> U[固定官方Responses端点]
  U --> P[EOF / 语义流 / 原包usage]
  P --> V[relay及adapter分别验收]
  V --> D[decoder与SDK用量核对]
  D --> S[预算结算 / 返回冻结答卷]
```

本批测试把U替换为自有localhost或内存fetch；测试Key都是合成值。默认官方端点只存在于未激活候选模块，不会在本批调用。

- `responses-stream.mjs`及声明：纯增量字节状态机，字节/事件/深度上限，唯一JSON属性，身份/索引/文本/终态一致性；显式null与合法0用量分开。只接受已实现的文本研究子集，不称完整Responses协议实现。
- `responses-relay.ts`：固定DeepSeek/Flash/官方URL和冻结body，首attempt前占用，完整body+envelope须在reserve内，唯一转发且redirect/error/no-retry；原始流完整验证后才转发成功内容。
- 候选DSH adapter及wrapper：临时独立home、最小子环境、无host工具、无llm-retry，固定schema/body/Prompt/hash，单dispatch；parser通过前不yield内容；parent独立对照relay原文与SDK replay/usage。
- 新离线专测：两套17/18题正例、合法多delta/分块/CRLF/usage0/cache；缺用量/矛盾/拒绝/工具/截断/前序漂移/第二请求/取消/预算失败等负例；同一账本后续请求拒绝。

## 门限

1. 全部注册正负回归通过，真实DSH子进程≤1请求、工具0；无成功文本先于完整原文验收。
2. 缺/矛盾usage、网络失败或SDK原包不一致：全局停止，原reservation保留，绝不默认为0。
3. 预留包含schema及完整wire；存储/预算/模型/Prompt失败在上游之前拒绝。
4. 独立质量、安全、后端审查；全套单测、双构建与历史固定hash不回退。
5. 以上为工程候选，不将市场效度、供应商约束执行或T28真实调查标完成。
