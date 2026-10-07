# Verifier 协议诊断与紧凑输出 — 免费修复批次

范围：从 `f5f5c9d44d68eab6ebfe5698cc86d060cee8803a` 增量，仅 `feature/autonomous-production` 独立 worktree。主线、虚拟社会 worktree、冻结 Tag、公开 v5、申报原稿及 VERIFIER-REAL-01 原件不变。本批外部供应商请求 **0**；工程替身用量不计模型 Token 或费用，开发工具与机器成本 unknown。

## 实际实现

- [版本化输出契约](VERIFIER-OUTPUT-CONTRACT.md)：`verifier-phase-ordinal-v5`、compact v2、diagnostic v1、study strategy v2、source v3。语法、结构、ID、选择和分数失败分别留痕，不自动修补 JSON，不追加请求。
- 错误仅保存固定类别、hash、长度、位置和有限结构路径；原始 provider 文本、校验器动态消息、候选值和秘密不进入诊断。诊断常量的合法 Key 长度子串列入配置碰撞拒绝规则。
- Prompt 要求严格 JSON、正确转义及短标量理由；宿主仍保留原 1000/1500 字符理由上限、0–5 评分、最低 3 分和最高分选择规则。新版 Verifier 文本入口设 32,000 UTF8 字节上限；Jev 请求原单问题/总量 32,000/64,000 字节和评测逻辑 LLM Prompt 60,000 字节门限不变。新增重复 JSON 属性拒绝和响应字节上限是显式新版本收紧，不重新解释旧实验。
- 泛化边界检查包括等号、上下边界、空值、零/负值、舍入与状态变化；全坏池可弃权。实际 H02 含 100 的负例在注入 Verifier 5/5 后仍被 Chromium 硬 Gate 拒绝，不产生交付物。
- [Jev 兼容核对及公共原件免费回放](VERIFIER-JEV-COMPATIBILITY.md)：保留 ±0.005 与现有数值策略，3 条原响应重复核对均重现 2 drift / 1 uncertain。不称新模型质量、供应商缺陷或省费证明。

## 独立对抗审查

按 specs-review 的代码/安全/服务端视角进行外层开发 Agent 交叉审查；不是平台内部角色实验，亦不是安全认证。未发现 `docs/lessons/` 历史条目。

修复了公开诊断常量与合法凭据发生碰撞的 P2：完整固定字面量及所有长度至少 16 的子串均拒绝作为新凭据；专项遍历 16,003 个派生子串，接受数为 0。另一次针对新增路径/常量的独立核对覆盖 878 个子串。最终集成复核未发现未关闭 P1/P2：失败不触发候选再生成、诊断进入调用和复核记录、版本进入配置/冻结 hash、原行为 Gate 不变。

## 回归过程与保留的失败

1. 首轮完整 Node：**702/705**，645.157 秒。两条复杂重规划 Jev 请求因新版边界文字超过原单问题 32,000 字节上限而失败；另一个免费 native 控制面用例因运行期间源码发生变化按防漂移门禁停止。均为免费工程失败，不是模型实验，不删除记录。
2. 第一次压缩后，单独上下文回归仍为 12/13：返修链仍超过上限。随后把完整业务边界清单只保留在 coverage，另两项明确继承全部 coverage 约束。没有裁剪用户需求、候选或执行证据，没有增大上限。
3. 最终 CAMERA-07 单问题请求从 32,402 降为 31,283 UTF8 字节；研发材料保持完整。单独重规划/输出契约最终 **20/20**，40.474 秒。17 项 Prompt/18 池准备与 preflight 回归另通过。
4. 固定源码后重新运行完整回归：最终 **705/705，910.929 秒，零失败/取消/skip**；其中实际 SDK＋Chromium 的免费完整 18 池控制面用例通过，274.688 秒。测试运行期间不再改执行源码或 HEAD，避免把动态源码失效当成功。

本机忽略目录 `output/production-verifier-protocol-4F6UmF/` 保存 `node-full.log`、`context-after-fix.log`、`both-context-final.log`、`node-full-final.log`、`browser-full.log` 和构建/专项日志；不以覆盖首轮失败的方式保存终轮。

当前已完成的最终检查：TypeScript/Vite 构建通过；独立 4421 浏览器 **45/45，约 1.4 分钟**，包含原虚拟社会回归、生产配置/复制/取消与评测控制面。592 份 tracked/unignored 公共文本的已知密钥前缀扫描无命中；不读取私有运行配置，也不声称完备秘密检测。REAL-01 原包 SHA 和只读 inspector 再次通过，仍为 failed / 44 事件 / 11 决策 / 10 意图 / 0 Oracle，旧记录未变。

终轮日志 SHA256（日志保留在上述本机忽略目录；新设备可用下列免费命令重新验证，不能要求跨机器日志 hash 相同）：

| 日志 | SHA256 |
| --- | --- |
| 首轮 `node-full.log` | `35c53d76ece477c900cbb974db44917531fbdc9d2e60d39ddb6d361aaad23f1b` |
| 最终 `node-full-final.log` | `a5d7ede72c686eca13b2b4cbf0dc1e36b0af70a961190b516d767b215c413cef` |
| 最终 `browser-final.log` | `61a60f82d1c76e5204597d3525434a0a0a2187ca4eba3d65dc83a314400ee603` |
| 最终上下文 `both-context-final.log` | `c5ebc2fe28290c4f581352870ae6fa6017dacf6f3c12e44d09e827c473d1905f` |

## 无 Key 复现

从本分支按 [RUNBOOK](RUNBOOK.md) 安装 Node 22.19+ 与仓库锁定依赖/浏览器，然后运行：

```sh
npm test
npm run build
npx playwright test --config docs/production/baseline.playwright.config.ts
node --import tsx --test --test-concurrency=1 tests/production-verifier-diagnostics.test.ts tests/production-verifier-diagnostic-integration.test.ts tests/production-verifier-prompt-v2.test.ts tests/production-jev-real01-replay.test.ts
```

Jev 回放读取已公开、固定 SHA 的归档，只注入本地 fetch 替身；不加载页面密钥、不解压到任务目录、不连接供应商。原归档 hash、控制副本、旧 Prompt 与旧失败终态均保持不变。

## 下一步及口径

本批只证明解析/提示/硬 Gate/历史数值兼容的工程行为。新 Prompt 是否减少协议失败、选优是否更好或更便宜，仍需 **新冻结、新预登记、新明确预算授权** 的真实 A/B/C；旧一次授权已消费，不自动重跑。对照后再开展真实 HTML 软件交付，选优成功与实际产品 Gate 成功分别计数。容器仓库执行、实体相机与固定九次泛化实验仍各自验收。
