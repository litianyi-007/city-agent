# 启动前对抗审查：环境故障不能触发付费返修

日期：2026-10-07。发生于 CAMERA-03 启动前；没有新的真实模型费用，没有改写 CAMERA-01/02。

## 独立复现

审查 Agent 用进程内 mock 让 `chromium.launch` 抛出 `Executable doesn't exist`，Tester 预检用明确标记的控制侧工程注入通过，以观察实际默认 `runGate` 的环境异常路径。独立临时目录、无真实 Key/HTTP。

修补前终态 failed，但发生 3 次 Chromium launch、3 次研发角色调用记录、20 条角色记录、2 次全局返修。两条原因都明确指向“Chromium 运行环境/缺少 Playwright”。旧 Gate 将环境异常包装为普通 passed:false，管线因而误当业务质量问题。硬 Gate 没有被放宽、全局上限未失效，但会在真实运行中浪费后续模型费用。这是已复现的 P2，而不是从失败文案猜测根因。

另一项 P2 是项目经理重生成收到过期剩余额度；已改为每次尝试从控制面刷新 `remainingRepairs`/`repairBudget`。独立注入观察的新值与账本一致：2→1→0。Gate 输入副本被恶意 adapter 篡改的反例也被拒绝，原冻结快照保留。这些均是免费控制逻辑证据，不是实际模型能力证据。

## 修补设计

向后兼容可选 `failureKind: infrastructure | timeout`。字段只由可信执行器设置，不从生成 DOM、测试名称或 summary 字符串推断。

- `infrastructure`：可信 Chromium 启动/上下文等环境初始化异常；保留 Gate 失败记录，生产管线直接停止，不再调用项目经理或消费返修额度。
- `timeout`：执行器整体时间上限耗尽，释放资源并停止；不能据此断言一定是平台故障或一定是模型缺陷。
- 普通页面 JS/DOM/业务结果断言失败仍为质量失败，可在原冻结 Gate 和共享额度内返修。单条断言等待失败不是自动环境故障。
- 用户取消保持 Abort 路径，不能变成质量重试。camera 的 CSS Gate 包装和独立场景行为 Gate 必须保留控制面分类，硬件/视觉/full 验收状态不变。

共享 `server/types.ts`/`server/gate.ts` 修改独立提交，供虚拟社会线自行审查后 cherry-pick；本会话不编辑或合并另一 worktree。生产特有消费逻辑、包装器和 UI 放在生产提交。源码会改变，因此 CAMERA-03 记录新的平台 commit；业务 acceptance 与 mandatory checks 版本、最低分数、可信渲染资产均不变。

## 验证与剩余边界

启动 CAMERA-03 前须免费复现修补后的默认 HTML Gate launch 失败与 camera 包装传播，断言保留 Gate、没有后续角色请求、返修为 0、没有源码交付；再跑完整回归。旧记录缺少 failureKind 时不重新分类，不从文本改写历史。

可信环境分类不是完整故障诊断或 OS 沙箱。浏览器执行依然有时间/heap 等限制；生成 Node/shell 与任意仓库执行仍未开放。最终质量通过依然需要实际独立浏览器行为 Gate，不能用故障分类或 Verifier 好评替代。

最终独立实测反例：launch 故障保留 history=1、研发记录=1、返修=0、feedback=0、无 source；camera CSS 继承与 mandatory 初始化故障标记正确，后者浏览器已释放。真实 Chromium 的单条不存在元素等待失败没有故障标记，仍为质量失败；总时限与错误文字伪造反例同样符合设计。四项定向测试 4/4，零 HTTP/费用。最终全量 Node 279/279、浏览器 22/22；专项与全量重叠，不累计。

共享源修补 commit：`f6af27c5dbd421a204f5bb4b76e85218f2469332`，仅 `server/types.ts` 与 `server/gate.ts`。该 commit 提供可选分类，不自动改变其他消费者的返修策略；另一线如采用须自己核对消费逻辑。本生产管线独立实施“分类后停止”，另一 worktree 与运行服务未改。
