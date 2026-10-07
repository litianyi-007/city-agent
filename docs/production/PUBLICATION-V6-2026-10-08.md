# Production v6：发布与评委体验验收回执

发布于2026-10-08 05:47:27（北京时间），GitHub Pages构建于05:48:05完成，status=built、error=null。仅发布既有授权的gh-pages:production/；没有发布服务端，也没有收费模型调用。

## 评委入口

- [公开体验与材料首页](https://litianyi-007.github.io/city-agent/production/)：三个固定可信Mock可直接交互。
- [本批固定在线版本](https://litianyi-007.github.io/city-agent/production/reviews/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/index.html)：安装说明、PDF、ZIP、MP4及原始证据入口。
- [固定安装与自测指南](https://litianyi-007.github.io/city-agent/production/reviews/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/submission/REVIEWER-GUIDE.md)。新需求在评委本地安装后的`http://127.0.0.1:4420/#production`输入；公开静态页不收Key、不执行Harness或新任务。

首屏明确区分“体验固定案例”“本地输入新需求”“查看材料”，没有把成品夹具输入框伪装为在线生成编辑器。安装指令固定完整SHA、失败即停、拒绝覆盖已有目录，摄像头资产准备单列且不自动执行；不复制另一研发线的数据或凭据。

## 发布身份与主线保护

| 字段 | 实际值 |
| --- | --- |
| 源码／PDF／安装publisher | `5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda` |
| gh-pages部署commit | `f02c844116784a5fbe6287d5072fdd0eaefebf32` |
| 本次父部署commit | `a53ace36d72d0e8f33091ae6c4aab7b86fe2fc7c` |
| Mock／历史视频原始来源 | `c21c588632d04dc7ed9dfa8cb265606400d2b522` |
| REAL-02原始实验源码 | `7899b9792dc611f30958a085908add660f3b156d` |
| 冻结申报基线 | `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466` |
| 材料版本 | `production-materials-v6` |
| 发布文件／总字节 | 118（含publication-manifest）／55,703,157 |
| 原package文件 | 110（另含package-manifest） |
| 选定不可变证据原件（子集） | 69份Mock／Camera／媒体等原件逐hash核对，无变化；不作为全部继承文件计数 |
| 旧production不可变叶子 | 339份，sha／mode／type全部不变 |

合成新tree前后核对所有production外root SHA不变，覆盖index、assets、submission、milestones及并行线新增目录；production内仅更新index.html和publication-manifest.json，新资产只追加reviews/<publisher>/。基于最新gh-pages父树非强制更新，未改main、另一分支或冻结Tag；原worktree及其服务未编辑／停止。旧申报MD、模型负结果及原视频没有覆盖。

本回执是部署后新增的源分支文档，不修改已冻结publisher及已发布快照。之后源分支HEAD可以含本回执；安装与材料仍固定上述publisher，不能将新文档commit追写为历史实验来源。

## 材料与线上字节核验

PDF已渲染12页A4横向，并逐页视觉检查：无裁切、文字重叠、黑块或链接孤页。公开浏览器已实际显示PDF第一页及1/12页数。主材料保留七栏目与真实／Mock／预测／未知口径；REAL-02恰十份原件、573内层JSON和派生统计经校验，原始账本不改写。

| 文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| production-mock-submission.pdf | 1,275,264 | `83c357ac8be57411f6f074da725cc59c7d27bc74470dc06629feb73208bb00a3` |
| materials.zip | 19,508,609 | `b30f9d1a7dbd9c279087ea7b55c1f5faaca67756bcc3a8a078d3565a9af41707` |
| demo.mp4 | 4,857,699 | `ad2627631dd99efc79c282f9c61ef46783421a8f00bc8a565e1e5e0ac81e9f36` |
| package-manifest.json | 128,437 | `bda6ca45643ab8b76b9b35cf594cea37fec2304128d8ee486bd05bf03d828f34` |

线上13个关键文件均HTTP200、字节数／SHA与核验包一致：两个portal、PDF、ZIP、MP4、两个主要MD、package-manifest、REAL-02的tar/metrics、三个可信预览。public publication-manifest与本地原字节一致。原MP4为205.88秒（3分26秒），不是本轮真实模型开发录像；浏览器实际播放超过一分钟，duration=205.88、readyState=4、error=null，随后暂停。

## 浏览器与独立安装实操

公开Chrome页面逐项完成：

1. Mock-01新增一项、标记完成、删除，数量从1/0→1/1→0/0。
2. Mock-02新增两项、完成其中一项，未完成筛选只显示另一项；回全部仍两项，统计2/1不被筛选破坏。
3. Mock-03空格输入被拒绝且数量0；两个不同任务恰两项，删除指定项后另一项保留且数量1。没有额外添加“同名任务必须去重”的验收要求，也不把展示标题当新的冻结断言。
4. “复制安装命令”出现成功提示，可见文本含完整publisher及set -eu／engine-strict。自动化浏览器虚拟剪贴板返回空，粘贴校验提示无数据；这不能判定用户浏览器系统剪贴板的实际内容，因此不声称端到端剪贴板内容已验证。可选中文本手动复制，且下述安装已独立完成。
5. PDF、视频、安装说明与REAL-02统计均可访问；公开页没有Key或收费执行入口。Demo与PDF已在浏览器保留。

独立GitHub新clone没有复制任何数据库／Key／日志：Node22.22.3、608独立依赖、独立官方Chromium缓存，使用4520/5520/4522/4521及独立data目录。最终HEAD/build/启动身份同publisher、clean=true、ready=true、issues=[]，六角色默认deepseek-flash、无Key／费率。此前三次免费Mock均实际Chromium Gate3/3、零返修；分别保留实际运行时的源码版本，原运行IDs和每次12条mock记录保持，更新／重启没有重跑模型。自定义费用记录需求可输入，缺来源／验收／Key／单价／授权时“启动真实生产”禁用，不用固定Mock替代。

本机主production服务在4420重建时，仅核对并停止自身idle进程，18个运行、2个benchmark、3个study无active，历史状态及加密设置原地保留；未读取／迁移Key。测试clone服务完成后独立停止，不停另一线服务。验收截图在ignored `output/production-quality-final-dYjZML/`，不把本机路径当公开证据链接。

## 审查、验证及成本边界

发布前所有本批代码由外层开发与非作者交叉审查，覆盖quality／security／server；P1/P2已修复复审关闭，包括清单／ZIP尾流／HTML渲染字节、安装失败即停、成本分母、新模型默认值、凭据字串保护，以及最后ffprobe快照和PDF排版。完整记录见[BATCH-QUALITY-V6-CHECKS.md](BATCH-QUALITY-V6-CHECKS.md)。

afeb冻结全量773/773、922.520秒，浏览器47/47约1.5分钟；后补发布专项64/64、主复跑70/70、独立18/18及排版33/33分别通过，存在重叠不合计。全量轮次不冒称包含后补工具测试；原失败／中断轮次保留。最终TypeScript／build／干净启动身份及发布预检通过。

本批新增付费模型请求／平台模型Token／平台模型估算费用为0；外层开发Token、机器费用和供应商最终账单unknown。上一批REAL-02原52HTTP／342986输入＋8557输出／0.077296446 USD声明价估算仅归档重用，不记成本批新费用，也不与旧JeV账本双加。它的高性价比预登记结论为false；不能据此宣称Jev已提升良品数或节费。

当前Jev v4及可选source-bound-v1只有免费工程证据，不计为新真实自主交付成功。下一步依序为新的明确预算和预登记→真实HTML冻结Gate及有／无源码绑定证据对照→实体摄像头验收→已验证安全容器与受控仓库→固定配置泛化。首次真实闭环和稳定性门限保留，不以本批测试、发布或静态交互声称通用L5。
