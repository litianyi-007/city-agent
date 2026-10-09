# 输出导航与容量反例：工程及独立审查

日期：2026-10-09。免费开发批，基线 `929635d1c805e7a9abe5fdb7d30b7dd41291a991`。

## 范围与证据类型

实现 grouped v4 的研究员/PM Schema 派生导航与内部 JSON 自检，免费预检/启动材料同源、凭据/来源版本保护。新增容量反例，不改变业务与硬门禁；设计见 [OUTPUT-ENVELOPE](OUTPUT-ENVELOPE.md)。外层开发 Agent 建平台，注入 roleCall 与测试自写 HTML 都是工程夹具，不是内部模型自主交付。

源码与测试只在 `city-agent-autonomous-production`。原目录、虚拟社会 worktree、main/tag/gh-pages、旧申报、public/submission 和旧实验均不修改。三份入口文档更新前全文以929635d留底于 [archive](archive/2026-10-09-before-output-envelope/)。

## 失败与修正账本

1. 模块首次13项形成前，11项中8过3败：实际 Zod Schema 带非枚举 `~standard` 适配器。采用仅根 data descriptor 的不观察例外；其余危险属性仍拒绝，最终纯13项全过。不修改 outputContractSnapshot 或旧 serialized hash。
2. 根接线首次 TypeScript 发现新回放测试误用不存在的诊断 `category`；改为实际 `kind: schema-structure`。项目没有 typecheck npm script，改用已有 `tsc --noEmit`。
3. 首轮9文件154项：85通过、69失败，44.871秒。新增 PM 完整指令9690 UTF-8字节使六种合成凭据长度的启动扫描超限，大多数在0调用拒绝。纯诊断定位13个 startup payload 中仅该指令超限。修复方向是精简新增冗余提示，保持完整扫描和全部历史代际；不提高上限或将失败测成通过。
4. 通用自检854→586字节，PM完整9422字节仍超限；第一次PM去重后9129字节仍超限。最终在新v4去重重复的PM说明，不改变旧v3或严格Schema；完整六长度启动检查通过。
5. 接线专项首轮90/94（147.194秒）：两条literal碰撞在精确命中前先触计算上限，仍0调用失败关闭；这类测试改用同长合成非碰撞Key隔离检测，默认六不同长度正例与原超限测试保留。feedback测试夹具在失败Gate仍返回proceed，被正确拒绝，改为夹具revise，不改变运行时PM规则。
6. 新validation版本漂移反例发现付费边界P2：产品结果持久化后修改validationContract，旧入口直到Verifier调用后才拒绝。补invoke入口及注册/持久化事件后的dispatch前完整冻结校验；漂移必须在下一工具/供应商执行前停止。该问题用注入夹具复现，没有新增真实费用或修改旧实验。
7. feedback夹具修正后定向19/20（8.783秒）：错误预期只有一次PM反馈，实际管线在失败/通过Gate各反馈一次。改为逐条核 `feedback-0/revise` 与 `feedback-1/proceed`，完整Schema/hash及共享返修1保持；追加注册保存漂移反例后最终定向21/21（10.306秒）。
8. 修补过程中的首次全量命令完成：1029/1033，4失败、0取消/skip，1116.039秒，失败对应上述两literal、validation漂移和feedback夹具；不把该次全量描述为全绿。最终修补另开全量命令，以下只在命令真正完成后填数。

## 最终验证

最终修补全量 `npm test`：**1034/1034通过**，0失败/取消/skip，1130.641秒，exit0（1031个顶层、含3个子测试）。完整本地18池SDK/Chromium演练也在其中，外部供应商请求0；不是新模型效果证据。此前1029/1033失败不覆盖或删除。

最终浏览器 `npx playwright test --config=docs/production/baseline.playwright.config.ts`：**65/65通过**，约1.7分钟，独立4421/临时数据。含六角色配置/复制、预检授权撤销、取消、旧结果、摄像头有界能力和分支内虚拟社会回归；不运行原目录服务。

最终 `npm run build` 与 `git diff --check` exit0；Vite约1.12秒。Zod第三方PURE注释有既有构建warning，构建成功，不把warning隐藏为执行失败或供应商响应。

本批新纯模块13、容量8和root专项21均在全量或独立复测中覆盖，不叠加成1034之外的良品分子。模型可靠率/返修节省/完整HTML真实闭环尚无新实测。

## 独立对抗审查

使用 specs-review 的分域非作者审查；docs/lessons 实际不存在，不虚构历史经验库。质量与安全/服务端由非作者交叉审查，作者不自评自己的实现为独立验收。早期轻测试无发现不覆盖后续实际P2：安全审查独立先复现单case1/1失败（1.077秒，2次dispatch≠1），随后核双边界修补并重新验证关闭。

独立安全/服务端：轻量31/31（6.765秒：pure13/startup5/capacity8/source5），凭据4/4（0.241秒）；P2修复后定向23/23（13.841秒，指定21项+正常v4/legacy两项），全部0skip。质量审查确认旧contracts去除纯新增块后与基线全字节一致、旧53 source顺序保留；另发现P3“API版本字段误称页面显示”，已准确改为API报告包含、当前页面仅摘要。最终无开放P1/P2，不将这些专项重复累加为全量数。

## 成本和体验

兼容性共享契约单独提交为 `ffb3482edda40585c783eb7343e2da8f431d3fb3`：仅production validation/preflight增加可选outputEnvelopeVersion与受保护的新协议字面量，无新必填字段或虚拟社会行为改动；供另一线独立审查后选择cherry-pick，不自动合并。1034工程结果属于完整本批组合，不宣称单独该共享commit完成生产新功能。

本批新增供应商/模型/Jev/Hopper请求0，模型Token与费用0；工程CPU耗时与合成usage不计模型Token，供应商账单无新增调用。没有HTML08真实运行或新良品率结论。

最终源码推送前限定公开变更路径扫描；常见secret格式/凭据字段检查与独立人工分类合成fixture结合，不承诺检测所有编码/隐写。三份留底已逐字节核对；申报稿、public、旧实验、Gate、Jev、原碰撞guard限额与冻结Tag的read-only范围复核保持原件。

本地入口 `http://127.0.0.1:4420/#production` → 新建自定义需求 → 离线单HTML/真实模式/LLM Verifier/单候选 → 显式分组验收 → 免费启动预检。预检API报告configuration应为 grouped v4 / output-envelope v1，当前页面摘要不显示协议版本；ready不是收费授权或最终Gate。当前公开Pages仍固定v6静态案例与材料，不因源码推送变后端。
