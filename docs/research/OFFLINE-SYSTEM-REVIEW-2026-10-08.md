# T29：全套离线取证与四路并行验收

日期：2026-10-08；分支`feature/virtual-society-next`；Node22.22.3。范围为虚拟社会主线的本地工程验证，不激活Responses生产路由、不调用实网模型、不读取真实Key/旧数据库、不安装依赖、不提交或重新发布。旧Tag、L4/L5分支、原申报材料和两份closed实验账本不变。

## 结论及可复现入口

最新四路并行验收全部通过：**504/504单测、19/19浏览器、122/122 Responses专项、Pages构建**。另行普通构建和TypeScript检查通过。179项固定历史原件及185项本次源码清单起止一致；实网模型请求和API费用均0。

```sh
npm run review:system:offline
npm run review:system:offline -- --load-check
npm run review:system:offline -- --load-check --local-full
```

依赖按现有lockfile已安装，使用Node≥22.19。命令只接收上述固定开关，不接受Key、URL、预算或任意命令。默认历史范围42项；`--local-full`依赖本机完整179项原件。本机完整产物：`output/offline-review/system-2GjQ4B/`，其中`report.json`为最终标记，另有四路各自stdout/stderr原始日志及历史起止证据。专项独立产物为`output/offline-review/responses-9U25st/`。

## 本次实测

| 项目 | 实际结果 | 时间口径 |
| --- | --- | --- |
| 四路总验收 | passed；4路exit0；无超时/取消/截断/启动失败/自有组孤儿 | 52,314.16ms，包含测试与起止校验，不含导出 |
| 单测 | 504/504；fail/cancelled/skipped/todo全部0 | TAP 28,129.84ms |
| 浏览器 | 19/19，独立临时SQLite，合成Key/localhost | 报告器51.0s |
| Responses专项 | 91 parser＋12 relay＋19真实DSH wrapper＝122/122 | 专项CLI 22,004.51ms，含审计，不含导出 |
| 本次新增取证专项 | 10 runtime＋7 source-seal＋1参数拒绝＝18/18；已包含于504 | 定向复验2,879.19ms |
| 历史/源码 | 179项固定历史SHA一致；185项fresh源码inventory一致 | 与上述总时间重叠，不相加 |
| 双构建/类型 | Pages和普通构建exit0，TypeScript exit0 | 构建警告原样保留，不记为模型运行时间 |

本次全套起止：`2026-10-07T18:12:08.000Z`至`2026-10-07T18:13:00.316Z`（北京时间10月8日02:12—02:13）。HEAD仍为`8ad592c0af4df77102f928dae42ab7411d903ef5`，报告记录的是该HEAD上的**未发布工作树字节快照**，不是新commit或新线上版本。源码inventory canonical SHA为`38cfdc3d5f71a79634846891e938fdd2ea9556eb00c0a6178e2fb40462c19eae`。每路日志另登记字节数和SHA-256。

落盘后另行复核8份日志的字节数/hash、当前185源码inventory及179项历史原件，全部匹配；不是仅凭CLI退出码宣称产物完整。

SQLite实验性提示、依赖pure annotation及Pages静态/动态import混用的构建警告已保存；这些不阻断本次构建，不假称零警告。测试内部usage与预算账本是合成数据，不是业务Token或供应商账单。

## 对抗审查推动的修复

使用`specs-review`独立交叉审核，作者与审查者分离；结束取证和进程管理分别复审，动态注入仅发生在自有临时合成项目/子进程，未改真实源码或历史原件。

| 优先级 | 审查发现 | 关闭证据 |
| --- | --- | --- |
| P1 | 启动时枚举一次，结束只重hash旧文件，新源码可能漏记或未登记执行 | [source-seal](../../server/research/offline-source-seal.ts)每次重新枚举；unit清单从before inventory派生；新增、隐藏路径、同大小改写、删除、symlink、类型/EIO回归通过 |
| P2 | 结束源码/历史校验抛错会丢掉已完成日志 | 两侧检查分别转静态`verification-failed`，仍保存原始两路日志及failed报告；不导出异常原文 |
| P2 | timeout只杀leader，leader先退可能取消KILL，遗留忽略TERM的child | 仅自有POSIX group执行TERM→grace→KILL；leader close也等待升级完成；缩短时限合成fixture实际确认同组child退出 |
| P2 | nonzero甚至zero leader退出，未触发timeout也可能遗留孤儿 | close时探测自有group；0/1退出均动态复验；发现孤儿会清理且`orphanedGroupDetected`使验收失败 |
| P2 | 字符串无限积累和分裂UTF8可能失真，截断摘要可能误通过 | 原始Buffer分路保存；默认两路合计16MiB帽，300B参数化边界回归；截断/超时/非零/重复或缺失TAP均拒绝 |

补充：预取消不spawn，运行中取消不序列化caller reason；父SIGINT/SIGTERM联动停止job。空test清单拒绝自动发现。附件先写、report最后写；合成report序列化失败实测不留下误导的pass标记。独立复审无剩余P1/P2阻断。

## 不删除失败记录，也不夸大通过结果

T27曾出现一次四路485/486，原工具输出截断，具体失败项和根因仍unknown；之后单独、三路均486/486。首次加日志的四路487/487（`system-rym9L6`，49,333.80ms）及当前加强后的504/504均通过。**这证明本次复验通过，不证明此前偶发失败根因已修复。**所有旧负记录与各轮目录保留；今后相同条件失败可通过完整落盘日志定位。

源码seal范围明确为6个固定根入口/配置及5个应用/测试目录，包含隐藏代码与声明的运行输入扩展；不认证node_modules、全部public资产、私有数据或.env的完整构建重现。起止字节一致也不是恶意并发修改的原子执行认证。

进程管理只覆盖自有POSIX job group；另外detached的浏览器组依赖注册job的正常收尾，不认证任意脱离进程树已清空。Windows全套runner fail-closed；父进程SIGKILL无法恢复取证。该验收不是干净Windows/Linux安装、真实Pages供应商CORS、供应商schema执行或真实消费者效度认证。

## 接续门限

T29工程门完成；F001仍doing，T28真实能力探测和研究验收独立。接下来先预登记能力探测并获取新授权，不续用旧预算；区分schema请求接受、本次答卷合规、关键字执行证据。通过对应门限后，再单独确认两场景10＋10及API/UI显式协议选择，不静默替换旧路径、删约束、重试或补样。详见[Responses候选报告](RESPONSES-BOUNDARY-2026-10-08.md)。
