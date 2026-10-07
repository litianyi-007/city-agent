# VE-02/03：独立选择策略与先行账本

版本：`verifier-study-injected-v1` / `verifier-study-strategy-v1` / `verifier-study-ledger-v2`。本切片实现免费、可注入的工程执行器；没有真实模型默认 transport、API 入口、生产配置/Key 读取或自动续跑。它不是收费评估的冻结配置，也不替代六角色真实交付。无确认 marker 的早期临时 v1 账本保留原件，不静默迁移或当正式结果。

## 执行与审计顺序

`独立 manifest(running) → run-start → decision-start → call-intent → call-result → decision-result`。

全部计划的 A/B/C 决策完成后，才执行 `oracle-intent → oracle-result`；最后追加 `run-end`。最终报告写入失败不会回滚初始 manifest 或已经落盘的调用。运行、决策、调用和 Oracle 使用全新 UUID，显式 `cachePolicy:bypass`。相同输入重复实验仍独立调用；不要求答案文本不同，也不保证供应商内部 KV/prefix 缓存关闭。供应商前缀缓存不是应用层已有答案复用。

控制面只接受固定挑战池 ID，从当前准备模块生成完整白名单请求，不接受外部改写的候选/验收副本。输入、配置、候选、LLM 逻辑请求、Jev 请求和 Oracle 对象有 hash 绑定；回调收到深拷贝冻结快照。响应也先深拷贝冻结，再用同一份原件落盘、计费与解析，防止“持久化答案 A、实际解析答案 B”。这是防御性完整性检查，不是恶意同权限进程的安全沙箱。

## 三策略

| 策略 | 规则 | 工程调用上限/池 |
| --- | --- | ---: |
| baseline | 全部候选先过严格结构契约，选预声明首个；不拿 Oracle 当答案。 | 0 |
| llm | 当前生产完整评分契约、全部候选 ID、最低3分且最高分、允许合法弃权。 | 1 LLM |
| jev-cascade | trusted Jev adapter；accepted 选、rejected 弃权，仅 uncertain 或可信 arithmetic-drift 升级与 B 相同的独立 LLM。 | 1 Jev＋最多1 LLM |

非法候选/协议、unknown usage、致命错误、取消或预算不足停止整轮。主池所有候选必须结构合法，不静默过滤坏候选；业务全坏池仍可弃权。一次独立复核不再复核自身。损坏 Jev 分数、原始意见、Oracle 结果、控制标签和其他策略的答案均不进入复核 Prompt。没有候选生成、修补、模板回退或关键词专用生产逻辑。

## 存储与恢复

`VerifierStudyLedger.create()` 独占创建新目录；manifest 单独写入并 fsync，然后追加事件。文件 `0600`，目录 `0700`；拒绝路径穿越、symlink/hardlink、外来文件、非 JSON/Proxy/accessor、常见秘密字段及可识别凭据文本。8 MiB manifest / 1 MiB 单事件 / 64 MiB 总量 / 2048事件是新本地账本限制，不增加 LLM/Jev 请求边界，不截断快照。

事件有连续 sequence、previousHash/contentHash 与运行/决策/调用血缘检查。每次 append 在返回前 fsync 文件、目录；初始目录的父目录 entry 也 fsync。事件和目录同步成功后才写 hash 绑定的 commit-marker，重开不得将只有可见文件、没有确认 marker 的终态读成成功。读取发现截断、未确认尾部、序号缺口或 hash 改动失败关闭，保留原件，不跳过缺损事件。hash-chain/marker 是完整性与程序同步确认检查，不是签名或防恶意重写证明。没有 OS/磁盘故障矩阵，不能把三个进程 SIGKILL 测试称为断电安全认证。

marker 只确认此前事件屏障成功，不证明 append 已返回给调用方；marker 自身晚同步故障后即使原件可读，也不得自动重放调用。未确认尾部需要显式人工审计，而不是自动删尾补标记。

`open()` 只读校验；`recoverInterrupted()` 必须显式调用，仅将未完成意图记为 interrupted/unknown，不调用任何模型或 Oracle、不生成成功报告、不自动重放收费操作。截断文件需要人工审计，不能自动修掉再重跑。写盘失败的实例立即停止新调用；即便文件已写但目录 fsync 失败，也不能因此获得调用授权。

账本不读取密钥，也不可能识别所有任意 opaque secrets。未来接入真实 transport 前须完成精确配置 Key 脱敏与秘密扫描；本切片的 raw fixture response 不得直接复用为公开真实响应策略。

## 用量、预算与取消

调用前检查累积已知用量＋最坏单次预留、调用数和整批限额；记录预留之后才 dispatch。响应先落盘，再核验实际用量是否超过单次预留或整批额度，最后一次超限也失败。unknown、非法数值或混币种停止；已知小计保留，不把缺失记零。当前预算是注入测试参数，不是收费模型费率测量或供应商账单硬上限。

整批时限、每调用/Oracle 超时与 AbortSignal 已实现；单调时钟检查避免立即完成的 Promise 和同步 fsync 阻塞定时器而绕过预算。忽略信号的注入回调会被 race 截止，之后不启动新调用；其底层资源释放和未返回的迟到响应费用仍 unknown，迟到结果不改写终态。同步阻塞后才返回的已知响应保留原文/usage，但超过 deadline 不用于选择。真实 transport 取消/进程释放须在 VE-04 单独验证，不能用本测试证明已停止 HTTP。

摘要固定保留 planned / attempted / not-started、accepted / abstained / errors，以及选中产物 Oracle pass / fail / unknown；三者总和等于 accepted。Oracle callback 完成不等于健康有效业务判定。`callbackIntents` 不是 HTTP 次数；通用注入 runner 的实际 HTTP 为 null。Mock CLI 的钩子已知为纯本地函数和 injected fetch，因而可以单独报告外部供应商请求0、实际供应商费用0；其合成 Token/费用字段不能作为模型效果或节省证据。

## 免费复现

在本分支独立 worktree，Node 22.19+、安装锁定依赖及 Playwright Chromium 后：

```sh
node --import tsx --test --test-concurrency=1 tests/production-verifier-study-ledger.test.ts tests/production-verifier-study-strategy.test.ts tests/production-verifier-study.test.ts
node --import tsx scripts/run-production-verifier-study-mock.ts
```

第二条使用18固定人工池、54决策、最多54纯注入调用，再跑36实际受限 Chromium Oracle；产物在独立 `output/production-verifier-study-mock-*/`，包含先行账本、快照、逐事件原文、摘要和来源 hash。没有 Key 设置步骤，不用本地生产服务，也不改旧实验。Mock 的 LLM 固定选首 ID、Jev 固定 uncertain 后升级一次，所以即使三策略得到相同成绩，也不是模型能力结论。

## 下一门禁

VE-04：冻结模型/端点/参数、完整 wire 预检、真实 usage/HTTP 观测和取消，计算保守预留、随机顺序和费用，再单独取得本评估预算。VE-05/06 才运行真实 A/B/C、逐池对照与成本归因。当前没有开始这些收费评测；HTML v10真实任务、实体相机、容器及受控仓库仍各有独立验收。
