# 自动化软件生产基线审查

审查基线为 `submission-milestone-2026-10-07`，commit `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466`。本轮只做准备和回归；以下缺口尚未修复，不将旧实验或夹具认作新产品交付。

## 已实现能力及证据边界

已有四角色 Agent 的创建、编辑、复制、启停和独立模型连接配置；本机 Key 加密保存，公开接口不回传原文。四角色选择和凭证在任务创建时冻结，后续修改不影响旧任务。实现位置为 [store](../../server/store.ts)、[types](../../server/types.ts) 和 [App](../../src/App.tsx)。

[编排器](../../server/orchestrator.ts) 在研发前生成规格与测试，保存验收哈希；浏览器失败最多两次返修，单次任务最多 12 次模型调用、15 分钟，角色调用最多 180 秒。[Harness](../../server/harness.ts) 锁定 0.1.5-rc.3，禁用主机工具，只返回文本或 JSON。[Gate](../../server/gate.ts) 在 Chromium 中执行单 HTML，拦截外部请求，使用独立页面并支持取消。这不是受控仓库构建执行器或任意代码安全沙箱。

[执行证据](../../server/execution-evidence.ts) 区分模板、注入适配器、真实 SDK 传输和真实浏览器验证。配置 selector 不认证远端实际模型身份；Gate 只覆盖冻结断言，不证明业务需求完备或通用 L5。

现有虚拟社会能力和边界以[里程碑](../MILESTONE-SUBMISSION-2026-10-07.md)及[审查补齐](../research/AUDIT-FIXES-2026-10-07.md)为准。旧 PRODUCT、ARCHITECTURE、TASKS、EVALUATION 中包含历史描述，不能脱离顶部增量提示，将曾经的“未接执行器”当成当前状态。居民实测与软件交付分账；现实桥、长期记忆、wiki/dream 仍是规划。

## 六次真实尝试的失败

来源为 [delivery-attempts](../../public/submission/delivery-attempts.json)。六次状态均为 failed，其中三次返回浏览器 Gate；准确结论是六次都未取得最终 Gate 通过，不能说六次都实际执行了终验。

| 运行 ID 前缀 | 可观察失败 | 后续应检查 |
| --- | --- | --- |
| 35c35a57 | 研究员配置 `deepseek-pro` 被 HTTP 400 拒绝；研发未执行 | 模型连接与配置预检，不能静默换型号 |
| c2525e0f | 合成问卷统计被标为 fact，并引用问卷运行 ID；来源检查拒绝 | 论断和来源类别契约 |
| 892574e7 | 研发输出 max-tokens，未进入 Gate | 输出预算、完整性和失败原文 |
| d1ae748e | 初版存在隐藏题目、缺统计锚点和无效分组等问题；第一次返修随后截断 | 实现业务覆盖与输出完整性；不能把初版 Gate 当成返修已测 |
| 920beabd | 整体与分组重复题卡导致选择器多匹配，部分预期统计也不匹配 | 唯一作用域、DOM 和数据契约 |
| d628361c | 测试要求嵌套题卡；最终页面还缺 data-choice-id，全部组未提供所需题卡 | 测试契约冲突与研发缺口分别处理 |

最后一次的[断言](../../public/submission/delivery-acceptance.json)、[Gate](../../public/submission/delivery-gate.json)、[运行](../../public/submission/delivery-run.json)和[清单](../../public/submission/delivery-manifest.json)保留原样。其 7 次调用、两次返修、166.971 秒、输入 126089 / 输出 28666 Token 是旧运行数据，费用为 unknown。验收 checks 的本地 SHA-256 复算与登记 hash 相符；哈希一致不是独立模型审计。

当前编排器已添加反斜杠和嵌套重复题卡预检，最后历史实验却仍包含被禁止选择器。这项修订晚于该实验，不能称已经真实验证有效。六次之间有工程修订，不构成统一配置成功率实验。

## 后续生产线的主要缺口

| 优先级 | 缺口 | 影响 |
| --- | --- | --- |
| P0 | 编排、输入及前端仍依赖人口、商品和规则模拟 | 任意软件任务可能被带入调查上下文，须独立生产契约 |
| P0 | 不具备仓库文件操作、构建和测试的受控执行器 | 扩展到 Node/shell 前必须验证隔离环境 |
| P0 | 字符串包含断言不是精确数值比较 | `12` 可能匹配 `112`，不能充分验证统计或业务结果 |
| P0 | 角色输出在格式重试、返修时覆盖 stage.output | 无法仅据该字段恢复每次请求原文，须逐调用账本 |
| P0 | 缺金额硬上限及完整逐模型费用口径 | 调用数/超时不能替代总费用预算；未知不能记零 |
| P0 | 工程 Agent 更换 Provider/Base URL 时仍可保留旧 Key | 不应把旧凭证隐式发送给新端点；居民预设已有清除规则，工程角色尚需对齐 |
| P1 | manifest 缺统一实验版本、代码 commit、Prompt hash 等 | 难以区分修订批次与复现实验 |
| P1 | 重启将执行中任务标为 interrupted，不具明确续跑协议 | 恢复时不能自动重复付费调用或执行操作 |
| P1 | Vite/API Origin/测试端口分散固定 | 需统一配置，不能只修改 PORT 或 Vite 端口 |

以上为代码审查发现或范围限制，不代表这些缺口已被利用或已完成修复。业务功能和执行器方案应在完整需求到达后定稿。

## 本轮基线回归

2026-10-07 北京时间，使用已安装的 Node 22.22.3，在新 worktree 安装独立依赖。默认 shell 的 Node 20.15.0 未用作验证环境。安装使用 `npm ci --ignore-scripts --no-audit --no-fund`，不改变锁文件或全局 Node 设置。

| 检查 | 本轮实际结果 |
| --- | --- |
| npm test | 109/109，通过；总时长约 11.26 秒 |
| npm run build | TypeScript 与 Vite 通过；Vite 构建约 1.12 秒 |
| npm run build:pages | TypeScript 与 Pages 构建通过；Vite 构建约 0.88 秒，没有发布 |
| 独立 Playwright 基线配置 | 5/5，通过；约 17.6 秒，端口 4421 |
| npm audit --audit-level=low | 0 项已知告警；不等于完整安全审计 |

锁文件 SHA-256：`e278b75c619b286a72fb8c545863080a5112627669a9fec9202473bb2d92938e`。构建有第三方 PURE 注释告警，Pages 另有动态/静态导入重叠提示；测试有 SQLite experimental 与颜色环境告警，均未导致失败。

浏览器数据和结果使用新目录下唯一的 `.city-agent-preparation-*` 目录，不复用原项目数据库或 Key。测试中的模型服务是本地替身，界面运行是明确模板/规则演示。新增真实供应商 LLM 请求为 0；外层 Codex 的开发成本未统计，不能把本节当成系统业务成本账单。

核对时原目录 Git 状态与 tracked diff 和创建前一致；新 worktree 的 src/server/shared/tests/data/public、锁文件及原关键文档与冻结基线无差异。新增 Markdown 相对文件链接检查无失效项，待提交内容的常见凭证模式扫描未命中，测试端口 4421 已无监听。本轮仅新增准备文档、分支工作规则和准备回归配置，未保持 Demo 服务运行。
