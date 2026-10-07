# VE-02/03：三策略与审计账本批次

2026-10-07，独立 `feature/autonomous-production`。源码冻结 `01ab356`，仅新增生产study模块、CLI/测试和文档；没有修改原线服务/目录、旧实测、公开v5、冻结Tag或main。六份关键文档修改前按55bcb3e逐字[留底](archive/2026-10-07-before-verifier-study/)。

## 实际交付

- 独立baseline/单LLM/Jev cascade策略，复用生产strict schema/评分/一次升级语义；完整白名单输入/hash、无已有答案缓存、所有选择先于Oracle。
- 独立初始running manifest，模型/Oracle intent先落盘，原响应/usage先留证再判定；写失败/unknown/超限/取消停止，显式恢复不重放。
- 私有独占目录、连续hash-chain、event屏障后的commit-marker；无确认/截断/tamper失败关闭，不将可见终态误读为已确认成功。
- 整批/单次单调deadline＋AbortSignal；同步迟到已知usage保留但不选，异步未返回保留unknown，不虚构底层HTTP已清理。
- 固定18池免费CLI＋实际Chromium [原件演练](experiments/VERIFIER-MOCK-01/RESULT.md)与两条旧Phase-1意见[跨线交接](REVIEW-CONTRACT-HANDOFF.md)。没有新增生产API或读取真实Key。

## 对抗审查及修复

按specs-review进行独立质量、安全/服务端及历史教训检索；`docs/lessons/`不存在，已有HTML01/CAMERA05等失败作为边界提醒，不删除protected历史文档。以下问题均在冻结源码前修复：

1. 完整18池快照超过通用1 MiB事件上限：manifest独立8 MiB bound，不截断，不扩大provider请求容量。
2. decision结果可保留running而重复写：严格终态与intent血缘检查。
3. response原引用变化使落盘/解析分叉：同一深冻结observation；持久化hook改旧引用的反例通过。
4. Oracle非法passed丢分母：accepted的pass/fail/unknown完整相加；不健康执行不当业务拒绝。
5. 全新克隆无output目录：只在已核验production根下安全创建，仍拒symlink。
6. 立即Promise/同步fsync令timer饥饿：全程单调elapsed；同步返回超时仍记录known usage但不选。
7. 终态event目录fsync失败而visible completed被重开：确认marker必须后于event barrier，无marker拒成功；晚marker故障不授权重放。

独立最后复审无新增P1/P2阻断，8/8针对性回归通过。不是通用安全/断电认证；hash与marker不防同权限恶意重写，真实transport/Key脱敏/资源清理另验。

## 实际验证记录

| 证据层 | 结果 | 本机日志 |
| --- | --- | --- |
| 三模块专项 | 58/58，30.276秒；secret fixture等值构造后ledger26/26再验 | `output/production-html02/study-special-final.log`、`study-ledger-final.log` |
| 冻结源码完整Node | 589/589，506.819秒，失败/取消/skip0 | `output/production-html02/node-full-study-v2-final.log` |
| 独立浏览器 | 38/38，1.3分钟；含原调查/人口/问卷及生产配置/复制/Mock/取消 | `output/production-html02/browser-study-final.log` |
| 实际18池演练 | 131.547秒，54决策/54注入回调/36实际Oracle，290事件，0外部供应商请求 | [6份原件与结果](experiments/VERIFIER-MOCK-01/RESULT.md) |
| 静态验证 | tsc/diff/clean source构建通过，471文本源扫描0疑似 | `output/production-html02/build-study-source-clean.log` |

首轮完整工程回归在审查返修期间启动，582/583、508.156秒，一处旧“未确认intent允许open”期望与新v2契约不相容；保留 `output/production-html02/node-full-study-final.log`，不作为冻结成绩。修复后从干净01ab356重新完整589/589；没有把旧失败删掉，也不混为同配置稳定性实验。实际模型请求/收益本批未测，合成会计值和机器/外层成本分别标注。

独立原件审计：34来源与git show一致，4receipt SHA一致、581逐文件/聚合无缺；第217完成最后decision，第218才首Oracle。36实际产物16pass/20业务负例，各策略固定首选8pass/10fail/unknown0，不伪造Verifier选优。

归档后6份原件逐字比对与JSON秘密扫描通过，全部479文本源/归档扫描0疑似；原6份文档留底也与55bcb3e逐字一致。扫描只覆盖已声明字段/前缀，不声称识别所有opaque秘密。

## 后续顺序

VE-04：真实传输完整wire、身份/参数、unknown与取消、保守价格/Token/时限及预算冻结；之后才单独批准VE-05/06。HTML v10真实任务、实体相机、隔离容器和受控仓库各自验收。公开静态v5未更新，不以本分支推送等同公开Demo部署。
