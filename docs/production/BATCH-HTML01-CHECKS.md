# HTML01之后的免费工程修补

2026-10-07，本分支与原虚拟社会worktree仍隔离。真实HTML01失败与v5发布见各自[结果](experiments/HTML-01/RESULT.md)、[receipt](PUBLICATION-V5-2026-10-07.md)，不覆盖申报基线、旧实验或固定公开材料。

## 实现

- HTML执行事实v1、Prompt v9：公开已有禁止原生submit/外联/导航限制，明确click处理、内容节点与控件分离、状态操作后的实际数量与统计不变量。CSP、Gate、camera基础指令/v7不变。
- review-context v2：研发返修生成仍保留完整previousHtml；只有匹配真实先前已选角色调用和SHA之后，独立评审以来源引用替代旧代码副本。完整新候选、原业务、冻结Gate、failedGate、PM决策/风险及其他事实不删除、不截断、不隐藏。
- boot-disk v1：固定磁盘身份，live创建与每下一付费角色/Jev阶段拒绝源码、HEAD或构建漂移；新records保存身份，旧记录不追填。benchmark持久化窗口拒绝的invoked标记恢复正确；不冒称0POST就必有0Token。[设计与局限](EXECUTION-IDENTITY.md)。
- 根README新增生产分支真实入口/安装/边界；原虚拟社会历史说明保留并标注，修改前四文留底在archive/2026-10-07-before-html01。

## 已完成的专项

| 专项 | 结果与口径 |
| --- | --- |
| HTML01历史档 | 7/7，540.975ms；四原JSON SHA、失败/冻结/唯一返修/原unknown/0POST容量拒绝原样 |
| HTML执行对照 | 4/4，3.591s；实际受限Chromium相同checks下native submit失败、显式click通过；取消后Browser断开 |
| 独立review投影 | 最终7/7，238.152ms；HTML01旧34067B→27248B，当前新候选/Gate/PM/冻结全保留，原32000/64000B门限未增加；含新增凭据子串保护 |
| HTML返修接线 | 1/1，13.663s；纯注入Jev/LLM相同来源绑定，无真实HTTP/SDK/浏览器；工程完成非自主交付 |
| boot磁盘身份 | 12/12，159.807ms；纯fake reader、漂移/unknown/immutable边界 |
| 身份接线 | 最终7/7，1.543s；纯注入0HTTP，startup零注册、下一role/Jev/different boot、benchmark后续阶段/持久化窗口及缺默认guard阻断 |

首次综合专项64项中63通过、1失败（59.186s）：免费CAMERA07反事实测试把新的projection版本v2错误要求为旧v1；只调整该新反事实的版本断言，逐项旧业务及历史SHA仍严格核对。未修改旧运行、业务Gate或验收要求。其后全量/浏览器结果以实际日志补记，不提前宣布通过。

随后规划/HTML事实14/14（15.726s）。审查中的第一轮全套479项、478通过/1失败（336.475s）：本地SDK协议夹具没有新的明确身份hook，真实dispatch被正确拒绝。只给该夹具显式增加约束到其独立127.0.0.1临时端口的工程hook，仍逐请求校验native JSON和全部证据，不修改生产拒绝规则；专项7/7（12.689s）。该轮同时在审查中发生生产修补，保留为node-full-during-review.log，不当作冻结源码最终全量。独立review还补齐默认真实Jev基准缺身份guard的拒绝、新协议键及enum凭据子串保护；纯内存583个≥16子串全部拒绝，不扫描或迁移旧Key。最终源码另跑完整验证。

本批修补不产生模型请求；外层平台建设工具用量和机器成本unknown，不填零。新的真实HTML02预登记独立存在，仅在免费验证、干净构建/重启身份完成后启动一次；不把反事实容量缩减当历史成功、省费效益或稳定L5证明。

## 冻结源码的最终回归

Node 22.22.3：完整工程测试480/480通过，343.702秒，0失败/跳过/取消；日志`output/production-html01/node-full-final.log`。完整回归开始后没有再修改生产源码，仅追加文档记录。浏览器回归与干净构建结果分别登记，不能由单测推定。

独立4421/临时数据浏览器回归38/38通过（1.3分钟），包含原虚拟社会入口、人口/问卷/调查，以及生产设置/复制、三题夹具行为、取消/账本/返修显示；日志`output/production-html01/browser-final.log`。TypeScript与`git diff --check`通过。测试没有启用真实角色或Jev请求，不是HTML02实测，也不是实体相机证明。
