# Verifier控制面与可迁移只读核验 — 本批检查

范围：从 `17e47fa366b23ec81b59954b6391acd6cf3220a8` 增量；仅 `feature/autonomous-production` 的独立worktree，源码契约 `verifier-study-source-v2`。不修改 main、虚拟社会worktree、冻结Tag、旧实验原件、公开v5或已提交申报稿。

## 本批实现

- 独立公共schema和React评测入口；默认免费、准备与启动分开、真实双风险确认、过期/异步迟到/active-only轮询/取消/unknown显示。
- 同一原生study内核的控制面；boot、源码、公开配置和私有加密凭据代次绑定；先独立持久化授权消费、全冻结plan与running，再允许dispatch。
- 单活动任务、与普通生产/Jev基准互斥；最多16未消费准备及1000本机历史条目，不静默丢弃记录。
- 重启不自动重试；终态独立确认marker防止目录同步失败后误认成功。
- 只读gzip/tar核验器：限定压缩/展开大小、条目/文件/元数据、路径/链接/PAX/AppleDouble、原字节hash及事件/marker/lineage。原Ledger.open的目录scope约束保持不变；不解压、不修复、不续跑。

## 独立对抗审查

按代码质量、安全/服务端、历史经验三个视角审查（外层开发Agent，不是内部模型效果实验）。`docs/lessons/` 未发现历史条目；上一批真实原件和新反例用于复核。

已修复的重点：

1. 公开配置用同一strict规范化再比hash，避免对象属性顺序造成误判。
2. 新运行目录在dispatch前同步父目录，授权内保存全冻结plan并绑定hash，而不只保存一个摘要引用。
3. terminal文件写完但目录同步失败时，重启不得当作成功；新增确认marker和故障/篡改反例。
4. 免费或拒绝请求不调用旧error redactor来解密真实Key；使用固定公开错误。
5. 新凭据拒绝公开契约碰撞；旧凭据与公开值/属性的碰撞仅重加密已公开候选做比较，不解密Key，包含引号/反斜线/Unicode反例。不是任意编码秘密的完备扫描承诺。
6. source-v2覆盖新增控制面、固定夹具、API、boot/provenance、环境、只读核验与共享契约；保留旧冻结版本。
7. 原tar清单隐藏macOS元数据；补充1746原生headers口径，不重打原包。[补充核验](experiments/VERIFIER-OBSERVED-01/ARCHIVE-INSPECTION-ADDENDUM.md)。

## 验证记录

构建、专项及最终全量结果在本批冻结后追加；不得以旧640/38或第一次部分运行代替新增代码验证。已单列UI新7项mock浏览器用例（13.2秒）、archive+旧ledger38项（6.372秒）、固定错误/代次/旧boot兼容等免费反例。

冻结前最终专项62/62（30.138秒，明确排除另跑的full-native用例）、TypeScript与Vite构建通过；独立安全/服务端最终19/19（26.726秒），没有未关闭P0/P1/P2。新增源码冻结后仍需完整工程/浏览器与native回归，不把上述分项当作全套证明。

首次冻结 `f93dbd2` 的完整Node回归为645/672（926.288秒）：27项旧API用例在启动时被macOS `/var` 系统临时目录别名拒绝，包含研究API子进程用例；不是人口证据缺损或真实模型失败。完整浏览器45/45（约1.5分钟），原生18池工程内核用例通过（293.972秒）。日志保留在本分支忽略的 `output/production-html02/verifier-control-node-final.log`，不覆盖失败记录。

修复只转换Darwin实际解析到固定 `/private/var`、`/private/tmp` 的系统前缀，其余路径保持字面值；在初始化Store读取密钥/写入状态之前检查所有既有祖先。控制器原no-symlink规则未放松。补充标准系统别名、自定义祖先/叶子、现有study链接及悬空链接反例；修复后另跑回归，旧真实准备作废，新clean源码重新prepare。此时真实付费调用仍为0。

修复源码 `eb8302295a7ea53090dc49b88c1efd3d027daea6`：完整Node **676/676**（906.263秒，零skip/取消），完整浏览器 **45/45**（约1.5分钟），TypeScript/Vite构建通过。全18池原生控制面用例通过（290.482秒）；定向旧API27项、路径边界7项另通过。独立路径安全审查无未关闭P0/P1/P2。所有日志在 `output/production-html02/verifier-control-*-path-fixed.log`，未覆盖第一次失败日志。

此前通过实际页面启动的免费演练：控制面ID `e6214c9f-3063-4afd-a17c-fbc02502e19f`、原生ID `8c42fd10-ed6d-401e-b37c-1ab699aafa46`、源码 `f93dbd2`，317.938秒，54决策、54调用意图（36本机HTTP＋18内存Jev）、36实际Oracle、290事件、外部请求0。5454/378 Token及0.001469556USD均为夹具模拟账目，不是实际模型消耗。独立只读归档核验通过，包SHA256 `d18da1d95aa0e47e0a7a05d5ba7451824fe20dd2b1d2ef76be54b9b9a897d9e8`；1164原生headers=581 ledgerJSON＋1目录＋582PAX，无AppleDouble。不计真实质量或自主交付成功。

[该页面免费演练的可迁移原件与receipt](experiments/VERIFIER-CONTROL-ENGINEERING-01/RESULT.md)已独立打包，供无Key核验；不代替首次真实实验。

实际收费之前独立核对预登记：补正已有arithmetic-drift升级分支的文义及固定超时/默认采样口径，初稿留底；预先登记Jev“质量不下降且完整总费用较低”的本样本价值判定，不改运行策略。后续仅文档补正commit，执行源码46文件hash与 `eb83022` 相同，再从clean HEAD构建/重启并重新prepare。

开发期间初次credential generation测试使用了不存在的Jev `threshold` 字段而失败；更正为实际支持的timeout设置，未放宽协议。初次tsc因公共pricing可空类型不匹配失败，改用strict公共schema规范化。

三次未完成的免费native尝试均保留，不计成功：实现中源码变化导致source guard停止；旧170秒测试等待上限导致取消；独立审查误用negative测试名称过滤而纳入native、被后续源码变化停止。没有外部供应商请求/模型费用，模拟usage和不完整Oracle不作模型效益。最终600秒工程用例等待原生清理，不放宽真实预算或Oracle。

## 真实实验

用户随后明确批准 **一次**完整18池A/B/C、54调用/零重试、1USD声明价估算停止额度及Jev输出仅事后观测边界。先完成免费回归、clean源码与构建freeze；按[预登记](experiments/VERIFIER-REAL-01/PRE-REGISTRATION.md)另启实验，不把此前免费数据标为真实模型。

真实结果、费用未知/失败及非启动决策将独立归档。若模型/Prompt/Gate/工具改变，需要新实验版本，不在本轮中途调门禁、重试收费或把旧失败覆盖成功。

本次唯一授权已实际从页面执行并结束：`VERIFIER-REAL-01`，10真实dispatch（7LLM＋3Jev）、11已尝试/43未启动决策、0Oracle，内核43.874秒、73,632/2,505 Token、声明价估算0.017598132USD。H04非法JSON触发protocol门禁，保留失败原件且无重试；不是选优成功或自主交付。供应商账单仍unknown。独立费用/链路审计复算一致；[结果、18池明细、归因与跨设备核验](experiments/VERIFIER-REAL-01/RESULT.md)。

同池H01–H03 C全部升级、估算费用比B增加15.6606%，不能拿C三次与B四次比较宣称节省；实际质量unknown。H02模型理由与含100边界存在静态矛盾，非本次执行Oracle；Jev偏差仅归为冻结协议兼容假设冲突，不断言供应商内部缺陷。后续先免费诊断/紧凑输出/边界反例，再另行确认新付费实验。

最终材料只读复核通过：两个包SHA与受限归档结构、4控制副本原字节及JSON值hash标记、46项源码与工程/真实commit一致；真实费用、H04语法位置/hash及H02静态反例吻合，没有材料P1/P2矛盾。690份所选公共文本的已知密钥前缀扫描无命中（不是所有未知秘密的完备检测），全staged前缀扫描无命中。最终提交只含本线源码/测试及公开证据/文档，不包含状态库、加密密钥、原目录修改或旧申报附件更新。
