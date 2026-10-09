# HTML08 后续修复与 v7 实际发布回执

2026-10-09。开发、提交与测试只在 `city-agent-autonomous-production` / `feature/autonomous-production`；没有操作另一条虚拟社会研发线的工作目录或服务。

## 评委入口

- [体验入口](https://litianyi-007.github.io/city-agent/production/)：当前静态入口，三个固定可信 Mock 可实际操作。
- [本次固定版本入口](https://litianyi-007.github.io/city-agent/production/reviews/fb1bd5ac241a07a894364e5b624c9e75989e01c3/index.html)：避免以后入口指针更新改变本次展示。
- [19 页 PDF](https://litianyi-007.github.io/city-agent/production/reviews/fb1bd5ac241a07a894364e5b624c9e75989e01c3/submission/production-mock-submission.pdf)、[材料 ZIP](https://litianyi-007.github.io/city-agent/production/reviews/fb1bd5ac241a07a894364e5b624c9e75989e01c3/submission/materials.zip)、[历史 Mock MP4](https://litianyi-007.github.io/city-agent/production/reviews/fb1bd5ac241a07a894364e5b624c9e75989e01c3/submission/demo.mp4)。MP4 为约 206 秒的历史免费演练，不是 HTML08 真实交付录像。
- [当前进度附录](https://litianyi-007.github.io/city-agent/production/reviews/fb1bd5ac241a07a894364e5b624c9e75989e01c3/submission/CURRENT-PROGRESS.md)、[固定版本安装导引](https://litianyi-007.github.io/city-agent/production/reviews/fb1bd5ac241a07a894364e5b624c9e75989e01c3/submission/REVIEWER-GUIDE.md)、[HTML01～08 原件索引](https://litianyi-007.github.io/city-agent/production/reviews/fb1bd5ac241a07a894364e5b624c9e75989e01c3/submission/HTML-DELIVERY-STATUS.json)。

入口明确区分“体验固定案例 / 本地输入新需求 / 查看材料”。GitHub Pages 不运行 Harness 后端、不接收 Key、不执行实时研发。评委如需自己输入一句话需求，按安装命令固定 checkout 到 `fb1bd5ac241a07a894364e5b624c9e75989e01c3`，启动后访问 `http://127.0.0.1:4420/#production`，在本地页面配置六角色模型、自己的 Key、费率和单次有限预算。未配置 Key/费率的免费预检会阻断，而不是假成功。

## 版本与隔离

| 事项 | 实际值 |
| --- | --- |
| 本次公开包 publisher / 安装版本 | `fb1bd5ac241a07a894364e5b624c9e75989e01c3` |
| gh-pages 发布 commit | `00fc0df2d1efd72bc15031ed2bae1d9e44cf0c99` |
| 其父 commit | `f02c844116784a5fbe6287d5072fdd0eaefebf32` |
| 发布回执 UTC | `2026-10-09T07:36:02.172Z` |
| Pages 实际构建 | `built`，`2026-10-09T07:36:46Z`，对应上述发布 commit |
| 实际线上核验 UTC | `2026-10-09T07:38:11.975Z` |
| 冻结基线 Tag 解引用 commit | `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466`，未移动 |
| 历史 Mock / 视频源版本 | `c21c588632d04dc7ed9dfa8cb265606400d2b522`，不是新 publisher |
| HTML08 实际运行版本 | `f21256f8fe280b619c295ec17842fdc941b36545`，不能改写为修复版 |

本次非强制更新仅改 `gh-pages:production/`。发布器及非作者独立 GitHub GET 复核均确认：其他 9 个根项的 SHA/mode/type 不变；旧 455 个不可变 production 叶文件逐项不变，增加快照后不可变叶共 573 个。没有推送 main、移动冻结 Tag、改旧 Release 或重写旧申报资产。其他研发线可继续自己的提交，本回执不声称它们的 refs 全局停留不变。

共享兼容元数据提交为 `1bf0982`，供另一线自行审查是否 cherry-pick；没有自动合并或编辑另一 worktree。后续追加本回执的 docs-only 提交不改变这里已发布的 publisher、安装命令、原实验版本或材料字节，也不为追赶回执循环重导/部署。

## 实际交付与费用边界

[HTML08 原始结果](experiments/HTML-08/RESULT.md)为 **failed**：18 Harness / 18 观测供应商 HTTP，166317 输入 + 13317 输出 = 179634 Token，管线 102991 ms，声明价估算 **0.0658755 USD**。三轮产品/研究/项目经理输出结构均合法，但 PM 要求尚未释放的下游测试契约，耗尽两次共享返修；未到测试、研发、冻结或最终行为 Gate。本配置完整交付 0/1，旧失败与原输出均保留。

这一次明确授权已消费；没有自动重跑、Jev 调用、手工修改生成产物、模板回退或放宽 Gate。1 USD 是声明价估算停止限额，不是供应商账单硬上限。供应商最终账单、外层开发 Token/费用、机器与录屏成本 unknown，不能记为零。免费的工程/安装/静态页面验证没有新增模型费用，模拟 usage 不纳入真实 Token。

免费修复引入 grouped v5 / phase-readiness-v1：固定宿主阶段政策区分当前职责与未来产物，PM `proceed` 只释放后续验收构建，不能跳过实际检查、冻结或 Gate。实际容量/覆盖缺口仍拒绝，12×20 与最多两次共享返修保留。新配置尚未真实模型重测，工程通过不能追认 HTML08 成功。HTML01～08 是异配置调优记录，不是稳定性实验；CAMERA09 有界合成场景 Gate 与 REAL02 选优研究分别展示，均不替代完整软件交付。

## 验证及审查时点

| 验证 | 结果与限制 |
| --- | --- |
| 运行时全量工程回归 | 1078/1078，657.759 秒，0 skip/cancel；在后续纯打印/发布侧补修之前，不能声称包含新增用例 |
| 浏览器回归 | 65/65，约 1.7 分钟；本分支 4421 独立数据，包含既有虚拟社会功能，不操作原目录服务 |
| 打印补修专项 | 52/52；实际 Chromium print 断言长 UUID/hash 不重叠、不裁剪、不隐藏，主 Agent 另逐页查看最终 19 页 PNG |
| 最终发布侧六专项 | 51/51，13.217 秒，0 skip/cancel；含上传/发布/安全/HTML 原件/打印 |
| 非作者最终上传代码审查 | 50/50，8.458 秒，TypeScript/diff 通过；stdin 提前拒绝 P2 关闭，无未关闭 P1/P2 |
| 独立 GitHub 安装 | publisher `fb1bd5…`，普通 fetch/detach/clean build，独立依赖及全新空数据；三个实际 UI Mock 各 3 Gate、0返修，1210/1375/1295 ms；UI 段 12.499 秒；0 供应商 HTTP/Harness/Token/模型费用；缺 Key/费率预检阻断，自有临时端口已关闭 |
| 本地作者配置免费预检 | 同 publisher 干净构建/boot/source，ready/fresh，0 模型/0新任务，原运行库存仍24；不是收费授权或最终 Gate |
| 终版静态产物 UI | 三案例实际交互、手机添加操作、深浅主题、375/768/1024/1440 屏宽；0 pageerror/非白名单请求/模型请求，ServiceWorker 观测为0，沙箱仍 allow-scripts |
| 真实线上文件与 UI | 120 文件全部 HTTP 200、字节与 SHA256 一致，总 60,142,473 字节；实际 GitHub Pages 三 Mock 添加/完成/删除通过，固定版本入口通过；0 pageerror/非白名单请求/模型请求，ServiceWorker 观测为0 |

曾发现 PDF 长标识重叠，已停止发布旧候选并做局部换行修复。静态 UI 初次诊断又因 Playwright `serviceWorkers:'block'` 初始化脚本在 opaque sandbox 读取 navigator.serviceWorker 报错；非作者以无脚本父子页面的四格对照确认工具注入归因。换用全新默认 context，保留零错误断言、已核字节 allowlist 和外联限制，没有添加 allow-same-origin 或过滤错误。只检查固定可信 Mock，不向任意模型代码开放浏览器执行。

这里的 worker 观测仅指 context 的 ServiceWorker 事件/清单；没有做 DedicatedWorker 事件观测，也不将早期批次简写的“0worker”扩大成完整 Worker 安全证明。

首轮上传失败时 gh-pages 没有更新；32KB manifest 单独1.043秒、20MB ZIP 单独52.632秒上传成功，大对象并发接近原60秒超时是合理推测而非确证根因。最终发布只复用已核 prior production 树中完全相同的 Git blob，并核本地 Git header/hash；新对象响应 SHA 必须匹配。单 blob POST 分档60/120/180秒，其他API仍60秒，最多3并发，无自动重试，首错停新派发并等自身子进程关闭。总100MB、单30MB、文件数、源码/ZIP/可信渲染、历史树、并发 ref 和 force:false 门限未放松。

实际最终上传26个新对象，复用89个既有对象对应94文件，同包去重5文件；未将诊断中孤立上传的 ZIP 对象视作可信缓存。源码推送、Git ref 发布、Pages 构建和实际线上核验四个事实分别记录，不相互替代。

## 终版材料与回执索引

| 对象 | 登记数 / 字节 / SHA256 |
| --- | --- |
| 离线 `output/pdf/production-mock-materials-X0k1wC` | 112登记+manifest共113文件，38,515,314字节；manifest `22b0aaf38dc460435963c6c73fe5171ea4e6a0e2e7128310c5154d9ea619009b` |
| 终版 PDF | 19页，1,364,306字节；`69657b4cbb2e9b9b02e700cd535e1896a2b76fbb915d0023b4940cd05816e4c6` |
| 静态 `output/production-public/review-DfazvA` | 119登记+marker共120发布文件，60,142,473字节；manifest `127008422bdf2da941489f6d7e42578e9f7badbb274abfde4f28cea066ceb44b`；另有本地发布receipt，不算发布文件 |
| 本地发布 `publication-receipt.json` | `f1667a72b2049a065f5183ce1f9422f8bdce1ae026d2b0d5f7a178e6be62a44a` |
| 实际线上 `output/production-html08/online-ittA0p/receipt.json` | 120文件逐项状态/hash与实际UI；`a26c3bdbcd4bba49ca4ca7c88767ba550e36edc20d65e3a7a3f5c4a1c9853b29` |
| 独立安装 `output/production-reviewer-install-yZ5wiT/verification-upload/receipt.json` | `8a4956538c9672100397122df90851deb981b18df9ee83008d236d61aa64cc62`，截图同目录，前三份旧回执保留 |
| 作者免费UI `output/production-html08/free-v5-ZY1s65/receipt.json` | `a6756a51b20fcd13266c0efec785967065449a19a7b767598969c745b8dea620`；reportHash `5f6a2a6781804a77518052e770c88265228cb0e5ed7bdd5e89048eedf7f45593` |
| 静态UI `output/production-html08/public-ui-9RaL11/receipt.json` | `ca243e389c2c0022c173b6e35780a1b5becf24846117f077f19d622a3ef766c4` |

非作者核验完整目录/hash、113源文件与公开包、ZIP及两入口/可信预览重建、32件HTML固定Git对象。旧 Mock27件、视频2件、CAMERA09七件、REAL02十件和mixed账本逐字继承；主稿等于仓库已申报原文。原始 MD 保留历史相对/浮动链接语境，不能声称每份原件都支持离线完整跳转；评委从 CURRENT/安装导引进入现版导航。哈希仅是一致性校验，不是独立签名。

## 接下来按顺序推进

1. 免费验证费用页八项业务到实际 checks/steps 的容量与覆盖反例；研究/PM 的自报低步数不算证明，不能通过删断言或扩大 Gate 迁就模型。
2. 在明确阶段、容量及合法 CSS/DOM 契约后，冻结下一配置与 HTML09 预登记，再申请一次新的有限预算；本次剩余额度不自动续用。
3. 最小真实 HTML 闭环通过后，才在安全执行器硬门限满足的前提下扩展模板/增量/Bug受控仓库；未验证容器不得在宿主执行生成Node/shell。
4. 固定配置与未见任务稳定性实验另确认总预算；补真实业务需求和同范围人工对照后再给正式达标/增效结论。

更完整的失败、修复与早期验证过程见 [BATCH-HTML08-CHECKS](BATCH-HTML08-CHECKS.md)；本回执只追加本次实际发布结果，不改写原实验或申报主稿。
