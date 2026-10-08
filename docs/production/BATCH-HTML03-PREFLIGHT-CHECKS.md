# HTML-03 免费启动预检：实现、对抗审查与工程记录

2026-10-08；研发目录 `city-agent-autonomous-production`，分支 `feature/autonomous-production`。本批由 `bf53562dd073654f38b53dc2e69f26751aa4d42a` 继续，不改变冻结 Tag、main 或相邻虚拟社会 worktree。源码提交与 Pages 部署分开；公开入口目前仍是核验过的 v6。

## 本批实现

新增免费 `POST /api/production/runs/preflight` 与本地工作台“免费启动预检”。仅接收显式 `budgetAuthorized:false` 的 live／offline-single-html／llm-rubric；legacy 与 source-bound 分别报告，后者仍不是本次真实实验范围。

报告保存标准化输入、六角色公开模型/费率/Key已配置状态、source/build/boot、首次产品请求预算预留、正常及最坏调用包络和公开 SHA-256。永远 `paidAuthorized:false`、`finalGate:null`、`modelRequests:0`。缺配置、身份漂移、忙碌或保密碰撞失败关闭；没有付费 fallback。

`ready` 只说明采集时公开配置与第一次请求预留满足条件，不是整条链路可完成、完整业务覆盖、费用保证或被消费的启动令牌。Key 轮换不靠公开 hash 绑定；刷新配置立即使报告和旧预算勾选失效。修改输入/团队/限额、取消或卸载会中止旧请求，晚到的响应不可恢复报告。预检可在缺 Key/价格时列出阻塞项，不需要解密凭据。

付费管线只提取原有同值 `65536` 输入 Token 预留和同一费用算式为共享函数；预算停止、共享两次修复、JSON/Verifier/行为 Gate 不改。当前评测源码闭包增至 `verifier-study-source-v5`／51文件，新增两个准备模块；旧47/49集合不能作为当前付费执行来源。历史归档读取器未改，REAL-02 的旧 v3／47原证据不重标、不覆盖。

## 独立对抗审查与修复

三位外层开发代理交叉审查安全、后端、UI、当前闭包及历史兼容；作者不自审自己的实现。主代理再核对全部变更。这些代理不是平台内执行需求的六角色，不作为自主交付计数。

| 问题 | 修复与复验 |
| --- | --- |
| P2：异币种产品费率可被首次预算数值误标为任务币种 | 不隐式换算，返回 `null`／unknown；明确币种阻塞与 CNY 同币种测试 |
| P2：保存 Agent 后 GET 刷新延迟/失败，旧预算授权可能保留 | 在 await 前同步撤销报告和授权；新增延迟成功、延迟失败两条 UI 回归，禁止 POST paid runs |
| 无效公开快照可能被创建 schema 默认值补齐 | 对已存公开必需字段、唯一ID和六角色显式核对，不能靠创建默认值变为 ready |

独立审查复验后无开放 P1/P2。未改变题目专用分支、现成 Mock、最终 checks、门限或旧实验。

## 免费工程验证（与真实模型分列）

- 新纯契约/API 16项通过；成功及拒绝路径的 decrypt、secretAgents、redact、持久化、dispatch 被测试探针禁止，调用计数0，目录/账本不增。
- 独立 code-quality/server/source/credential/archive 37项通过；另一独立来源/历史材料交叉27项通过。属于重叠专项，不相加成总测试数。
- 第一轮全浏览器52项通过；最终完整 Node **793/793通过**，863891.886375ms、0失败/skip。日志为 `output/production-html03/node-full.tap`。
- 第二轮加入两条刷新反例后52通过／2失败：E2E 服务仍提供同步撤销修复前构建的 dist，反例真实捕获旧勾选保留；`output/production-html03/browser-final.log` 与失败截图/trace 保留。未降低断言或将失败抹成通过，须重建后再跑完整54项。
- 修复后重建（TS＋Vite＋构建stamp）通过，随后第三轮完整浏览器 **54/54通过**，约1.6分钟、0失败/skip，日志 `output/production-html03/browser-rebuilt-final.log`；含新增7项预检 UI 与原虚拟社会回归。构建日志为 `output/production-html03/build-final.log`。付费前仍须源码提交后的干净重建/重启身份，不能用开发中 dirty 构建冒充。
- 测试只使用合成凭据、拦截请求和受限浏览器，0外部模型请求、0供应商模型费用；工程机器、外层 Agent Token/人力成本未统计，不计为零。

秘密检查只覆盖本批拟提交文件，不读取真实 Key 本体。测试日志、依赖、运行数据库和加密凭据保持独立忽略目录；不迁移原项目数据。

## 实际体验与单次真实实验

按 [RUNBOOK](RUNBOOK.md) 构建并启动本分支，在 [本地工作台](http://127.0.0.1:4420/#production) 点击“新建自定义需求”，输入来源/验收，选择六角色及 LLM 序数评审，然后点“免费启动预检”。它不会自动勾选授权或启动任务。公开 [GitHub Pages](https://litianyi-007.github.io/city-agent/production/) 仍是固定案例与材料入口，不接收 Key，也没有 Harness 后端。

用户已批准 [HTML-03 单次方案](HTML03-NEXT-RUN-PROPOSAL.md)：仅一次1 USD声明价停止额度、24槽位、500000总Token、6000单次输出、600秒、两次共享修复、deepseek-flash、N=1、legacy LLM Verifier、不调用Jev。完成免费回归、审查、提交、干净构建/重启及相同输入预检后再启动；不自动追加第二次实验。

原需求、八项业务验收及预测费率在 [付费前预登记](experiments/HTML-03/PRE-REGISTRATION.md)。准备的 `finalGate:null` 不预造研发或测试输出；冻结检查仍由内部测试角色生成、预检与独立评审。机械合法与引用一致不证明完整业务语义覆盖：即使 completed，也须逐项核对原需求才可认证完整交付。真实 attempt、原始输出、费用、失败与 unknown 另行保存，免费测试不能替代真实效果。
