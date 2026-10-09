# 免费完整业务容量见证：本批验证与独立审查

2026-10-09。目录 `city-agent-autonomous-production`，分支 `feature/autonomous-production`；本批开始 commit `5f07a406d7ca91d395933d31d19dc684d30fefcb`。冻结 Tag 仍指向 `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466`。只新增 tests 与 production 文档，不改运行时、Prompt、Gate、旧实验、申报主稿或 gh-pages；没有操作另一 worktree 的文件/服务。

## 实际完成

- [费用页见证设计](STATE-COVERAGE-ENGINEERING.md)：保留原八条输入，实际12项/219步/3×4，逐项最多20步。全部5金额×空/已有状态各自重填其它合法字段并逐次观察；空/空格描述、正常新增/清空、筛选恢复、小数、双边界、空分类、筛选删除与最后归零均落成实际数组。
- 手写可信页面仅在 `tests/fixtures/`，真实业务明细不含操作按钮，提示与双统计面向用户可见；不以隐藏摘要或通过文案压缩检查。没有进入 API、内部角色候选、生成项目或真实运行账本。
- 完整原要求/步骤、计划/组合hash和独立前态反例；另有36个行为缺陷 mutant，含只首次提示、沿用旧提示、隐藏明细/提示、首次破坏内容/条数/统计后恢复，要求受影响原 check 实际失败。
- [HTML09 待授权提案](HTML-09-PROPOSAL.md)只拟定一次六角色真实完整交付；原八条、24调用/500k Token/6000输出/600秒/2返修/拟1 USD不扩大。不预置手写夹具，不启动任务。

## 终版免费执行

Node 22.22.3，串行工程测试；没有启动默认4311服务。

```sh
node --import tsx --test --test-concurrency=1 \
  tests/production-expense-witness-contract.test.ts \
  tests/production-expense-witness-gate.test.ts \
  tests/production-state-capacity-layout.test.ts \
  tests/production-acceptance*.test.ts \
  tests/production-output-envelope.test.ts \
  tests/production-phase-readiness.test.ts
```

| 验证 | 实际结果 |
| --- | --- |
| 上述最终专项 | **267/267**，273484.425 ms，0失败/skip/cancel；不是新一轮全仓或65项UI回归 |
| 本批新测试 | 契约22项＋实际Gate40项，共62项，已包含在267内，不重复相加 |
| 正向完整实际Gate | 12项＋原强制页面加载项全部通过，4304.922 ms；这是手写工程夹具 |
| 完整反序Gate | 12项独立新页全部通过，4142.141 ms；不借上一个check状态 |
| 行为mutants | 36/36均被指定目标check拒绝；每个只执行目标＋伴随两项，不冒称12项×36全测 |
| 非作者独立复测 | 最终契约22/22，600.293 ms；9项精选实际Gate通过，25.045秒（full/reverse/可见与6种预期缺陷拒绝），不并入作者267 |
| TypeScript / 差异检查 | `tsc --noEmit`、`git diff --check`通过；源码未改Gate或schema |
| 业务来源 | 原HTML08文件SHA256 `41e97f5469241ad1e60e04af64e0425864c9466b0a133c5b200d90ab4ab7bb03`不变 |

此前探索版34/34通过后又增加了可见性、空态描述与瞬时缺陷等检查，因此早期成绩不能充作最终219步/36反例的结果。独立审查发现一处旧注释仍将空分类归在初态check，已修正为由check10承担；仅注释变化，不影响上述实际步骤。完整最终结果来自新的专项日志，不从旧结果追认。

## 审计附件与边界

[工程回执 JSON](engineering/expense-capacity-witness.json)保留实际正向Gate及36个变异的结果、步数、来源/hash、耗时、执行范围和未知口径。原TAP位于本地 `output/production-capacity-7I03md/targeted.tap`，SHA256 `d63e6987c1789b4eaf7d27b9a96ea07ad16f493bcbad3b515e8362cb3a02eae3`；本地完整日志未上传。回执解码的是Node TAP自身对反斜杠/井号的诊断转义，不涉及任何模型JSON修复。

冻结checks SHA256 `10168fa060063119a1f365759c6d074a41f708ec79a1edc7d1d9b97e674bc78f`，合成planHash `6afdf629800d610640014f2b3d0ee6b1f983b6039b240829c6fb60ec5fc27261`。这些是手写工程输入的一致性校验，不是独立签名、真实角色调用血缘或下一实验预置Gate。

两名非作者按代码质量、服务/安全与材料边界交叉审查，无未关闭P1/P2。查明fixture仅由test引用；五类弱checks仍可通过结构/步骤审计的机械边界有明确测试，不能宣传为运行时已自动识别语义漏测。有限反例不构成形式化完备，也不证明模型已找到同样布局。

`NEXT-STEPS.md`修改前全文已留底，备份与本批起始HEAD逐字相同，30208字节，SHA256 `2623ea2618cd1bd2d5efcae5bd26f6d8790c49bbac76b80c157b65406ddc0a61`。公开v7、旧原始运行、旧材料与冻结Tag保持各自历史事实。

## 模型、成本和后续交付

本批新增真实供应商请求/生产任务均0，应用模型Token/模型费用0；外层开发Agent Token/费用、机器成本和供应商最终账单unknown，不记为零。没有Jev/Hopper调用，不继承HTML08单次预算。

只读核对本分支页面公开配置：六角色均deepseek-flash、声明输入0.30/输出1.20 USD每百万Token、Key配置状态为有；没有读取或回显Key。服务库存24生产/2Jev基准/3研究，均无活动任务。提交后须干净构建，只重启本线已核实无任务的4420服务，并通过实际UI免费预检；新回执保留在本地独立目录，不能把ready当收费授权或最终Gate。

随后集中确认HTML09单次有限预算。若批准，内部角色自主生成实际验收、研发与返修，完整保存失败和未知；若未批准，只保留可复现工程部分。真实HTML最小闭环通过之后，再按安全执行器硬门限推进受控仓库，不跳到宿主直接执行生成脚本。
