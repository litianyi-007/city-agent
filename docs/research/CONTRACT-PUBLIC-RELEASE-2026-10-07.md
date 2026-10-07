# 契约1.1真实测试补充：发布实证与交接

日期：2026-10-07。独立实验 `f736fda5-2b12-4918-b843-1421e1c76454`；本记录仅追加，不改写 RC1、原申报 PDF、旧实验账本或里程碑截止时间。正式比赛尚未提交。

## 先看结论和入口

真实 DeepSeek API 调查已完成，**两个10人质量门限仍失败**：小学0/10、宠物3/10联合通过，15名未启动。5次居民请求、17,032 Token，按冻结高峰非缓存价保守估算¥0.042032，不是供应商账单。新账本已关闭；没有重试、补样、换模型、30人扩容或旧账本续用。规划/CORS均未启动，不记成通过或失败。

- [公开 Demo](https://litianyi-007.github.io/city-agent/#research)
- [本轮独立补充材料](https://litianyi-007.github.io/city-agent/submission-contract11/)
- [真实测试报告](https://litianyi-007.github.io/city-agent/submission-contract11/report.md) / [原文与诊断总账JSON](https://litianyi-007.github.io/city-agent/submission-contract11/report.json)
- [评委快速开始](https://litianyi-007.github.io/city-agent/review-guide.html)
- [最新固定源码与附件预发布](https://github.com/litianyi-007/city-agent/releases/tag/society-contract-review-2026-10-07-rc2-ui1)

仅一个实际跨题错误、一个结构错误；业务审计的 failed/conflict 汇总包含未启动或结构阻断者，不能称为20份居民逻辑/身份错误。规则、部分知识设计限制和统计分母详见[真实轮复核](CONTRACT-TRIAL-2026-10-07.md)。发布成功不改变质量失败，不能用于推荐真实店址、主营价位或猫狗比例。

计时口径补充：小学1926.6ms、宠物7514.0ms为`executeSurvey`内的运行计时，包含画像、模型等待、运行内统计/诊断及此前checkpoint写入等待；不包含执行返回后的业务审计、汇总持久化、附件导出/页面渲染。原件timingBasis的“不含持久化”过宽，原JSON/PDF不覆盖，本记录澄清；不是总业务端到端耗时。后续新版本需同步修正文案并增加checkpoint计时回归。

## 固定源码与发布边界

| 对象 | 固定版本 | 说明 |
|---|---|---|
| 契约修复源码 | `society-contract-review-2026-10-07-rc2` → `7dffdb6a191a1cbdac29d475379531ba3d575bcb` | 保留，不移动Tag |
| 最新界面入口修复 | `society-contract-review-2026-10-07-rc2-ui1` → `a1fe400a1a2e06879081caecb6afe15d7d0e7373` | 本次 Pages 与推荐下载源码；后续文档提交不改变这个固定源码 |
| 本次 Pages | `2245245531b44891e8a00c7b08876dccf74c27ca` | 从 `e0443395050aa9cf624904422cab82d924a4983c` 增量发布；部署完成并实际访问 |
| 历史 RC1 | `society-review-2026-10-07-rc1` → `0600eb067fa74a448c96610f7f47ca9176d56760` | 源码、材料和失败实验不变 |
| 原里程碑与 main | `submission-milestone-2026-10-07` / `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466` | 本批未修改 main 或旧Tag；不操作并行 L4/L5 worktree |

实际发布使用 GitHub Git API，固定仓库与 `gh-pages`，单父提交、`force:false` 和发布前HEAD校验。107项旧材料及其 Git blob ID 不变；新增补充目录27项payload＋1份manifest；原RC1根入口另归档为 `milestones/society-review-2026-10-07-rc1/index.html`，旧资产仍保留。没有删除旧文件。

两次 clone 发布路径因传输缓慢在写入/推送前停止，保留失败日志；未向供应商请求。这些不能算发布成功。之后 API 增量发布完成，记录在 `output/contract11-api-publication.json`，公网和字节验证独立进行。

本次独立包包含24个逐字节一致的原始实验文件、HTML入口、README、2页PDF及manifest，不含审批会话、Key、私有绑定或运行日志。23个关键源码/依赖冻结hash用于解释实验血缘；事后Git Tag不是对先前脏工作区执行的独立认证。

## 已完成验收

| 验收 | 本次实际结果 | 证据 |
|---|---|---|
| 单元测试 | 303/303，0失败 | `output/contract11-final-unit-tests.tap` |
| 浏览器回归 | 19/19，37.7秒 | `output/contract11-ui1-e2e.log` |
| 本机/Pages构建 | 两种构建通过 | `output/contract11-ui1-build.log`、`output/contract11-ui1-pages-build.log` |
| 本地页面体验 | 修复后35项通过 | `output/contract11-ui1-local-pages-browser-qa.json` |
| 实际公网浏览器 | 34项通过，供应商请求0 | `output/contract11-public-browser-qa.json` |
| 公网文件字节 | 合并155/155实际一致 | `output/contract11-public-combined-byte-qa.json` |
| 精确凭据泄漏门 | 168文件、11次PDF文字/元数据检查通过 | `output/contract11-exact-secret-scan.json`；后续UI1源码另过公开文本门 |
| PDF | 最终2页逐页渲染目视检查通过；公网PDF签名、页数和SHA一致 | `output/pdf/city-agent-contract11-review-f736fda5.pdf`及最终v3渲染 |

首次本地界面检查发现调查页仍将RC1报告标成“本轮”。原失败记录 `output/contract11-local-pages-browser-qa.json` 保留，修复为新旧入口分列后另提交UI1，不移动RC2。桌面1280px和手机375px检查无横向溢出；实际JSON/Markdown/PDF入口返回对应内容而非SPA兜底。此轮遵循界面一致性审查与静态渲染约束，没有新增自动模型请求或持久保存Key。

155文件字节覆盖由两份不可变验证合并：系统curl首次151/155匹配，4项无响应；随后真实Chromium将对应4项实际完整读取，HTTP200、字节与SHA全匹配。视频完整读取约32/70秒，原30秒传输超时记录不改写。合并报告保留两份输入hash和逐项来源，**不是一次curl全通过，也不是重新运行模型**。Node传输超时、curl部分失败和构建中的暂态失败日志均留底。

最新GitHub Release为公开预发布、非草稿；三个附件已核对本机与GitHub digest：

| 附件 | 字节 | SHA256 |
|---|---:|---|
| `city-agent-contract11-materials.zip` | 684778 | `0389f7bb55aae47141ea92a12ffb9bf1240e1e910cdc502dd61adca1a9b63548` |
| `city-agent-contract11-review-f736fda5.pdf` | 899441 | `aafabaab10611ab130892eb9ede98ecf918dde530659d58370f997d8da6c3e6f` |
| `manifest.json` | 5124 | `bf0e32a746720265ac33e7432a783e996d8a08028f8c620d277ed419a803b1e8` |

这些验收证明工程回归、材料完整和发布可访问，不证明人口真实联合分布、五层人格增益、经营效度或 L5 自动交付成功。

## 尚未完成与下一批

本轮没有制作新的付费实测视频；RC1的4分33秒录屏是前次零费用UI操作。没有执行新版源码在他人干净电脑/Windows/Linux的安装验收；RC1的335文件macOS同机新目录安装结论不继承到UI1。GitHub自动源码包与固定Tag下载可用，但材料ZIP不是安装包。页面自备Key直连与本机Harness仍是不同路径。

下一批先离线推进[结构化输出支持矩阵、6项任务与evaluation门限](STRUCTURED-OUTPUT-NEXT.md)：固定单函数/单请求自定义Harness适配，nullable兼容前置门，新问卷部分知识状态，not-evaluated诊断，以及正负回放与预算停止回归。官方strict工具调用Beta兼容尚未探测，不宣称已经支持或可以保证无错。所有Prompt/问卷/审计改版另立版本，原文与计划分母不变。

新规划真实质量、页面新付费完整链、两个10人门限仍待验；30人暂停。真人/业务留出、语义盲评、人格消融、学校/候选点/租金/客流/订单/SKU/毛利资料待补采。现实桥MCP、长期记忆、wiki/dream和有限居民接管仍是未实施规划。

**下一次任何付费能力探测或调查必须重新确认预算；两个历史账本均不重开。** 正式申报需要用户提供入口并确认提交，不能以公开Release代替申报回执。完整合并状态见[主线计划](../SOCIETY-NEXT.md)，F001维持doing。
