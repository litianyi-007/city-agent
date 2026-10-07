# VE-04 观测适配器与工程演练契约

版本：`verifier-study-observed-v1` / `verifier-study-transport-v1` / `verifier-study-observed-policy-v1` / `verifier-study-source-v1`。这是新配置，不继承 VERIFIER-WIRE-01 的待批提案或旧任务额度。

## 本批实施

复用 `verifier-study.ts` 的单一执行内核，保留 `runInjectedVerifierStudy` 旧版本与来源口径；新增 `runObservedVerifierStudy`，只接受可信工厂生成的冻结 plan 与 transport。用户不能通过提供回调、复制对象或来源标签把 Mock 变成真实供应商运行。

LLM 调用现有锁定 DeepSeek Harness SDK `0.1.5-rc.3`，禁工具、零重试、独立会话、原生 JSON；Jev 通过现有严格协议适配器，固定官方地址、禁止重定向。实际输入限定为18池原始请求白名单；不新增题目分支、不生成/返修候选，不改变最终 Oracle。

控制面必须独立提供两把 Key 与同步 source/授权 guard；缺 guard 默认拒绝。Key 不读取旧 store/env、不在计划/日志/导出保存；同时脱敏两把 Key 和多层 JSON 转义，属性脱敏重名拒绝，秘密与公共契约碰撞在调用前拒绝。冻结计划/同意采用 private identity 品牌、完整哈希及一次消费，取消或重启不自动重放。真正收费入口尚未暴露到 API/页面，本模块构造不代表用户已授权收费。

实际 source checker 固定模块自身仓库根、生产基线血缘、HEAD 和39项运行相关源码 SHA；没有调用者选择路径，每次 dispatch/响应后/终态前核验。真实来源要求生产分支和冻结/当前均 clean；独立评委 clone 可改目录名、在基线后继 detached commit 只读跑工程检查，不允许由此收费。它不认证已安装 node_modules、浏览器二进制、已缓存TS模块或宿主完整状态，也不是操作系统原子快照；不能当安全沙箱。实际收费入口还需独立 boot/构建新鲜度校验。

`running` manifest 独立落盘先于调用，intent 先于 dispatch，响应/失败 usage 先于选优和预算结论；所有 A/B/C 盲决策先于全部实际 Chromium Oracle。恢复只能显式登记 interrupted/unknown，不重复付费请求。

## 分引擎预算（新冻结版本）

| 项目 | LLM | Jev |
| --- | --- | --- |
| 每次输入工程预留 | 61,440 Token | 65,536 Token |
| 输出 | 请求 `max_tokens=4096`，响应仍检验 | 4,096 是观测后停止门限，供应商硬上限 unknown |
| 本地 deadline | 最多120秒 | 最多30秒，不增加冻结页设置 |
| 声明价（USD / 百万 Token） | 输入0.30 / 输出1.20 | 输入0.042 / 输出0 |

全批最多54调用意图（36 LLM＋18 Jev）、输入3,391,488、观测输出221,184、声明价估算1 USD停止额度、30分钟取消触发。允许缩小，不允许通过此版本扩大。最保守工程预留总估算 `.890044416 USD`，不是供应商计费硬上界。价格变更需要新配置；缺失 usage/HTTP 为 unknown，停止后续调用。末次超限也失败、保留真实观测；Jev 输出免费不等于输出不计 Token。

取消后等待原生 transport/reader/SDK 清理再提交终态，不 race 丢失已知费用。30分钟是请求停止门限，清理可能使总墙钟更长。请求 dispatch 观测不证明远端收到、处理或计费；供应商内部行为不可据此计数。

## 发现并修复的封装缺口

旧 Jev body reader 的 abort listener 启动首次 `cancel()` 后，第二次 `cancel()` 可能提前返回，底层异步 cancel 尚未结束。新的 reader relay 跟踪并等待首次 Promise；25 ms transport 反例与40 ms整个 runner反例验证清理后才终态，没有修改旧实验或声称旧版已验证。

旧单 Key sanitizer 可能在第二把 Key 形成属性重名时覆盖原值。新封装在原始 Jev JSON 与单 Key处理之前检查重名，并 fail-closed；保留已知 usage/count 和脱敏原文，不输出可供选择的答案。

## 免费端到端演练预登记

仅运行可信 CLI `scripts/run-production-verifier-study-engineering.ts`，无参数、无 `--live`、无配置/Key读取、无外部供应商调用。固定 synthetic credentials，不从真实页面复制。18池×A/B/C；LLM 固定首候选，Jev固定 uncertain 并升级同一 B prompt。这些是夹具政策，不是模型判断。

预期最多36个实际 loopback HTTP POST、18个内存 Jev fetch dispatch、54个调用意图、36个实际 Chromium Oracle。`localFixtureHttpAttempts` 为兼容字段，必须结合 `fixtureDispatchKind`：两类加总只是54 adapter dispatch，不能写成54个网络HTTP。API外部供应商计数0、费用0仅限这次免费 CLI；实际模型 Token、模型效益、机器/外层开发成本 unknown/null。

验收：完整 wire 与冻结预期一致；全部盲决策先于 Oracle；完成/错误/未启动全留存；没有模板/标签答案回填；账本能够完整重新打开核验；清理/取消/预算反例回归通过。工程结果不用于“Jev 更便宜/更准确”的效果分子，也不作为六角色自主交付成功。

运行（本 worktree，Node22.19+，现有独立依赖）：

```sh
cd /Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production
npx tsx scripts/run-production-verifier-study-engineering.ts
```

每次创建独立 `output/production-verifier-observed-*`，保留 started、完整独立账本和 receipt；重复执行是新的免费实验，不读答案缓存。旧材料/v5/虚拟社会目录不更新。

## 收费实验前的集中确认

需要另行确认：完整18池 A/B/C、当前页 Verifier/Jev 的实际公开配置与声明价、1 USD估算停止额度、30分钟取消触发、最多54意图/零重试、LLM4096请求输出、Jev4096仅事后观测、候选未随机/seed=null、计费硬上界未保证。之后创建新的 clean源码＋plan哈希、实际控制面用户同意；不会自动把本工程 CLI 升级为收费模式。

下一切片为批准后收费启动入口、配置/凭据轮换失效和授权持久化，再 VE-05/06 模型效益对照与归因。实体相机、HTML v10真交付、容器与未见任务仍分别验收。
