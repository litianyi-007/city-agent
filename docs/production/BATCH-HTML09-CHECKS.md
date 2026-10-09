# HTML09 与免费原文引用修复批次

日期：2026-10-09。仅 `feature/autonomous-production` / `city-agent-autonomous-production`。先在干净c74源码运行一次已授权HTML09，再做免费平台修复，不能将后者算入原实验成功或使用本次剩余额度再跑。

## 实际完成

- [HTML09原件/结果](experiments/HTML-09/RESULT.md)：9真实HTTP、73,573 Token、69.090秒、声明价估算0.0340338 USD；failed，PM进入验收计划，三次同条quote标点错误，2次共享返修耗尽，无tester/研发/冻结/Gate。17份原件原字节归档，三份raw仍严格拒绝。
- [grouped v6源引用诊断](ACCEPTANCE-SOURCE-DIAGNOSTICS.md)：坏条目零基索引/source/hash，不返回正确引用，反馈前重算原始call/材料/实际schema绑定；所有旧提示导出、Schema、12×20和2次共享额度保持。新optional共享字段不迁移历史，研究源集56项/v10。
- [当前进度](CURRENT-PROGRESS.md)/[任务清单](NEXT-STEPS.md)更新前完整留底；[HTML10](HTML-10-PROPOSAL.md)仅是待新授权的单次提案，无启动/费用许可。

## 免费工程验证

以下全部不使用真实模型、Jev或Hopper。角色/Verifier候选和usage都是注入夹具，即使真实Chromium执行手写HTML，也不是内部真实自主交付。

| 命令/范围 | 结果 |
| --- | --- |
| `npm test` 启动时的完整glob（含新增纯诊断18） | 1169/1169，1,224,022.218625 ms，0fail/skip/cancel；`full-engineering.tap` |
| 新纯诊断18 + 编排13 + HTML09证据5 + 启动保护5 | 41/41，22,998.770917 ms，0fail/skip/cancel；`output/production-html09/source-final-recheck.tap` |
| 分组编排/预检、阶段准入、固定源和凭据兼容 | 128/128，170,064.252916 ms，0fail/skip/cancel；`compatibility-recheck.tap` |
| 隔离端口4421浏览器全量（含虚拟社会既有功能） | 65/65，CLI报告1.7m；`browser-regression.log` |
| `npx tsc --noEmit`、`git diff --check` | 通过；无生成项目Node/shell执行 |

新编排13项含两个真实受控Chromium路径：一/两次坏引用后重新生成完整合法计划→原tester→冻结→研发→行为Gate；持续三坏计划9次注入调用/2修复即停，九类call/raw/diagnostic/反馈篡改在下一模型派发前停止，引用修复不补充后续Gate修复预算。纯诊断含资源边界、Proxy/getter零执行、不泄漏引文及HTML09三raw原字节回放。

全量启动时shell glob不含随后新建的编排13项和HTML09证据5项，已由最终41项专项全部补测；当前不同工程测试共1187项，不重复把128/41相邻回归加进分子。完整18池SDK/真实Chromium本地回环也通过（265,488.479209ms，0外部供应商请求），不是真实模型质量证据。[机器可读计数与原日志SHA](engineering/source-diagnostics-checks.json)分别记录完整glob、补测及浏览器范围；工程日志为本地原始产物，独立克隆可按测试命令复现，不要求共享作者private store或browser profile。最终干净构建/重启/零费用页面预检在提交后收尾，不提前写成通过。

## 失败及审查闭环

1. 首次接线将startup import换新却保留旧循环变量，tsc/非作者审查捕获；改为实际SOURCE_BOUND完整提示，拒绝遗漏新尾部。
2. 新提示最初901-byte使原完整守卫六种凭据长度扫描超限。首次151回归70pass/80fail/1cancel（48,134.451ms），未冒充通过；仅把新增提示精简至179-byte，旧8114-byte计划不动、当前8294-byte，原100000扫描阈值和六长度全文检查不变。最终兼容回归通过。
3. 原档费用断言用double重组出现0.0340338与0.034033799999999996差异，首41项40pass/1fail；换整数美分计算，原run/账本金额不改，复测41/41。归档路径措辞也修正：预登记原提案在c74，实验目录运行后建立。
4. 非作者code-quality/server、security/service/evidence与历史经验搜索按 `specs-review` 执行。`docs/lessons/`不存在，未虚构经验。当前无未解决P1/P2；一个reviewer独立纯诊断/原档23/23（505.097ms），另一个独立新编排/原档18/18（21.104s）及此前28/28/tsc/diff-check。各自观察与作者全量结果分开。
5. HTML09原件secret-pattern扫描和两张平台截图检查通过；不归档Key、主密钥、数据库或browser profile。免费UI driver只允许回环GET/HEAD及preflight POST，阻止任务写操作/外联、不勾收费授权，并逐字段比对预期输入；ready不授权收费。

这些hash与绑定拒绝不提供对抗恶意宿主一致重写全部账本的密码学真实性证明，也不承诺任意代码完全安全。原运行没有模型可调用的编辑控制面/Gate工具。

## 成本、发布和下一步

本批新增收费仅HTML09九次，声明价估算0.0340338 USD；所有后续工程免费，不新增真实实验。unknown供应商账单、外层Agent Token/费用、机器/浏览器成本不填零。失败阶段不同，不把本次低于HTML08的时间/费用称为v5增效；N=1不能证明多候选选优、稳定性或高性价比。

仅普通提交/推送生产分支；共享契约小修改独立提交 `8b528138700fbd11d362cb7664ba81cd41be3495`，依赖已有生产契约及acceptancePlanSchema，供另一线先检查依赖/兼容后决定是否cherry-pick，不自动合并。公开v7固定包/视频/PDF与gh-pages不更新；源码新证据不等于Pages提供实时后端。原目录、虚拟社会服务、main和冻结Tag不修改。体验仍为本分支本地 `http://127.0.0.1:4420/#production`；公开入口仍只展示固定案例/安装引导/旧材料。

下一步只有新有限授权后运行HTML10，不自动复用本次预算。最小真实HTML闭环未通过之前不宣称稳定L5；容器/等效隔离门限通过后才扩展受控仓库，固定三类九次实验另预登记/预算。
