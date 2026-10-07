# VE-04：完整请求预检与待批准费用提案

版本：`verifier-wire-loopback-v1` / `verifier-study-free-proposal-v1`。本批实现可运行的免费准备入口，不在生产页面增加假收费按钮，也不将本地假供应商回答计作真实模型效果。原始[18池捕获与提案](experiments/VERIFIER-WIRE-01/RESULT.md)和[独立审查](BATCH-VERIFIER-PREFLIGHT-CHECKS.md)分列。

## 实现与复现

`prepare-production-verifier-study.ts` 仅 GET 本分支 `127.0.0.1:4420` 的公开 Agent/Jev 设置，不访问秘密 getter、不解密 Key。每池使用独立 SDK 会话、固定假凭据和临时 loopback 假供应商，捕获锁定 Harness 实际完整请求。它不提供 live/fetch/Key/endpoint override、收费授权、自动重试或恢复入口。

在本 worktree、Node 22.19+、锁定依赖和本地服务启动后运行：

```sh
node --import tsx --test --test-concurrency=1 tests/production-verifier-wire-preflight.test.ts tests/production-verifier-study-preflight.test.ts
node --import tsx scripts/prepare-production-verifier-study.ts
```

公开配置要求恰好一个启用的 Verifier、明确 Provider/Base URL/Model ID/费率及完整 Jev 配置；缺字段或显式 undefined 拒绝，不套创建默认值。当前只验证明确 DeepSeek JSON-object 路径，其他 Provider 不偷偷替换。Base URL 必须精确规范化 HTTPS、不含凭据/查询/片段。实际网络目标始终 loopback，公开上游 URL 仅编码到本地路径以保留 SDK 的域名兼容推断；官方 DeepSeek URL 与该路径的内存请求形状有等值回归。

完整 system/user、全部候选、原始 wire/body/canonical hash、模型参数、来源文件 hash 与新会话 ID 均保留。禁止截断、额外秘密字段、伪布尔标志、重复 JSON 键、额外填充和字节伪报；返回提案深拷贝冻结。初始 running 记录、每池 intent 单独 fsync 后再调用；配置/源码各检查点不一致即停止，捕获与原意图保留，不重放。检查点一致不等于全程原子快照，也不观察同一 hasApiKey 状态下的密钥轮换。

## 待批准配置，而非已收费冻结

| 项目 | 本次建议 |
| --- | --- |
| B及C独立复核 | 页面当前 Verifier：`deepseek` / `https://api.deepseek.com` / `deepseek-flash`，同配置同 Prompt |
| SDK | Harness `0.1.5-rc.3`，工具禁用、retry=0、每次最多1 POST |
| 请求输出 | `max_tokens:4096`，`thinking:disabled`、`response_format:json_object`，不改页面生产任务默认值 |
| 不支持参数 | temperature/top_p/seed 未传；供应商默认值 unknown，不虚构已冻结采样值 |
| Jev | 当前 `jev-1.13.0`、最低3/4、集中度0.5、timeout30秒、输入0.042 USD/M、免费输出 |
| 数量 | A零评审；B最多18 LLM；C最多18 Jev＋18独立LLM；总最多54意图/拟定54 POST |
| 时限 | LLM120秒、Jev30秒、Oracle120秒、整批30分钟；到期保留 not-started，不保证全跑完 |
| 请求额度 | 1 USD整批声明价估算额度；不扩大旧六角色单任务预算 |

价格按当前页面显式配置计算。DeepSeek 输入0.30/输出1.20 USD/M对应官网峰时非缓存保守口径；不预猜缓存命中，正式执行前再核价。[官方定价](https://api-docs.deepseek.com/quick_start/pricing/)

Jev官网的64k请求/32k state＋最长问题是 **Token** 限制，输出免费；仓库64,000/32,000 UTF-8字节限制是更严格的本地预检，不是官方字节限额、精确 Tokenizer 或计费保证。[TypeSafe Models](https://docs.typesafe.ai/models)

### 预算依据与真实边界

完整 wire UTF-8字节＋1024仅作为工程输入预留代理。全部本地请求符合锁定 Harness 的65,536上下文：预提议LLM输入上限61,440＋输出4,096；没有因厂商更大窗口而放松本地SDK。

按36 LLM的61,440输入/4,096输出和18 Jev的65,536输入预留，声明价工程估算为 **0.890044416 USD**。逐池完整字节代理加总为 **0.496148640 USD**，最大单池0.029940072；这两者都是估算，不是实测费用、必然账单上界或已证明节省。

Jev接口未提供 vendor max-output参数，输出Token预先保证仍未知；免费输出不等于0 Token。[官方请求协议](https://api.typesafe.ai/openapi.json) 下一切片须明确区分输入预留、LLM输出限额和Jev响应后停止阈值。若采用Jev输出4,096的观测停止阈值，超限/缺失usage都停止后续调用，但不能声称已在请求前保证其输出Token不超限；需要新的真实适配器契约及用户认可，不暗改旧注入runner预算语义。

提案固定 `readyForPaidExecution:false`、`authorization:null`。尚需：真实study adapter及实际HTTP计数、Token/收费口径确认、本评估独立预算授权。hasApiKey只代表配置存在，认证及远程响应身份仍unknown。固定模型名称不证明底层权重冻结；本地fake usage不是远程usage。

## 对照与停止规则

保留18池源码候选顺序：mixed首位4好/4坏；双好/双坏内部**未随机**、seed=null。这是明确的提案取舍，不声称完成原v3的候选随机方案，也不偷偷改请求builder。未来随机化必须新版本、完整permutation和原字节hash留底。

三个策略固定交错，全部盲决策完成后才执行实际Oracle。B与C复核使用相同完整 Prompt，不带Jev原始意见、控制标签或先前答案；应用层答案缓存绕过。最多一次升级、无候选返修。unknown/非法usage、致命协议错误、取消/超时、预算超限、持久化失败或hash漂移都停止，所有启动/未启动分别报告，不补分。

预登记效果判据：逐池报告好选择、错选、弃权、协议错误、未知；只在同冻结集完整用量下，C总估算费用低于B才称该集上更省费。不得先假定Jev优于LLM。18池是人工挑战集，不是18个真实业务需求、不生成候选、不代表六角色自主交付或稳定通用L5。

## 本批及下一批

本批只新增免费SDK封装/完整wire证据和待批提案；旧实验/申报稿/公开v5不变。下一批先完成真实adapter的免费受控传输、秘密脱敏、每类预留、取消/半截/unknown/重启反例，再集中确认1 USD/30分钟/模型配置和Jev观测停止策略。得到确认并重新冻结干净配置后，才执行VE-05/06；不自动追加、重跑或把旧CAMERA/HTML授权当本实验授权。
