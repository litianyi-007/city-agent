# 第一批工程验证与真实验证

## 当前实际结果（2026-10-08）

本批 [REAL-02](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/experiments/VERIFIER-REAL-02/RESULT.md) **completed**：54 盲决策均先于 36 实际行为 Oracle，52 供应商 HTTP（34 LLM＋18 Jev）、286 事件、370.649 秒、342,986／8,557 Token、声明价估算 **0.077296446 USD**；unknown usage 0，实际账单 unknown。B 好选中 12/18、坏放行 4/18；C 好 11/18、坏 2/18、5 次弃权中 1 次错弃权，完整费用比 B 高 3.258721%，预登记高性价比条件不成立。12 drift 和 4 uncertain 升级有原始诊断，不冒称全响应协议通过。

先行预登记提交 7899b979 的 47 项执行源码与已回归 7345fdaa 相同；4 份控制原件及 573 JSON 原生包只读核验、独立费用／源码／盲时序／安全审查一致。全部调用 cleanupAwaited=true 仅是原生等待记录，不证明供应商账单或独立残留进程审计。此批只追加文档／证据，不把评测 completed 当作研发产品 Gate 通过。[更新前全文留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-08-before-verifier-real02/VALIDATION.md)。

### 上一免费修复与更早验证记录

最新免费协议修复以 [BATCH-VERIFIER-PROTOCOL-CHECKS](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/BATCH-VERIFIER-PROTOCOL-CHECKS.md)为准：首轮 702/705 及中间 12/13 的失败均保留；最终完整 Node **705/705、910.929 秒、零 skip**，独立浏览器 **45/45、约1.4分钟**，复杂上下文/输出契约 20/20，TypeScript/Vite通过。新 source-v3 不复用旧 source-v2 冻结。没有新增供应商请求或实际模型 Token，新 Prompt 质量/效益待新授权实测。[本次全文留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-08-before-verifier-protocol/VALIDATION.md)。以下旧源码成绩按各自时间点保留。

源码 `eb83022` 完整免费Node **676/676，906.263秒，零skip**；完整浏览器 **45/45，约1.5分钟**，TypeScript/Vite通过。其后的`aaaac61`仅预登记文义/判定补正，执行源码46项hash不变，从clean HEAD构建、重启后通过实际页面启动唯一已授权真实实验。

[VERIFIER-REAL-01](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/experiments/VERIFIER-REAL-01/RESULT.md)：10dispatch、73,632/2,505 Token、声明价估算0.017598132USD、43.874秒，11决策后协议失败、43未启动、0Oracle、无重试。完整已知usage不等于质量验证或供应商账单；Jev三个尝试全部升级，不能声称高性价比。原始控制授权/全plan/先行running/终态确认及账本包可跨设备只读核验，独立审计一致。

下列“未调用/尚无入口/Key未配置/待批”均是各自提交的历史状态，不作为当前结论；已提交申报原稿和公开v5保持不变。[此次全文留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-08-before-verifier-real01/VALIDATION.md)。

## 当前补充（2026-10-07，历史段落不回写）

最新[控制面与跨设备只读核验](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/VERIFIER-CONTROL-PLANE.md)按新source-v2验证；本批没有真实供应商对照，旧640/38仅表示上一提交。新结果在[BATCH-VERIFIER-CONTROL-CHECKS](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/BATCH-VERIFIER-CONTROL-CHECKS.md)单独追加。原tar包含受限macOS元数据，补充说明不修改原归档/SHA或旧实验结果。[本文更新前留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-07-before-verifier-control/VALIDATION.md)。

VE-04免费[完整SDK wire预检](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/VERIFIER-WIRE-PREFLIGHT.md)与[本批验证记录](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/BATCH-VERIFIER-PREFLIGHT-CHECKS.md)已实施。18池逐字/参数/hash/独立会话与loopback抓取[原件](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/experiments/VERIFIER-WIRE-01/RESULT.md)分列；工程用量不当真实usage、0外部模型请求不当选优收益。当前付费ready=false，1 USD是待批声明价估算额度，Jev输出Token上界未知；公开v5不更新。[本文留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-07-before-verifier-preflight/VALIDATION.md)。

该切片源码7bc387f最终工程 **604/604、529.372秒**，独立浏览器 **38/38、1.3分钟**，专项15/15、TypeScript/diff通过。实际18池免费捕获11.949秒、18localPOST/0external，39原件/33source SHA均独立核对；模型Token/效果仍未测。

VE-02/03 新[注入study合同](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/VERIFIER-STUDY-CONTRACT.md)增加先行manifest/intent、三策略、全盲决策先于Oracle及无答案缓存。免费工程与Mock实际Oracle的本批记录单独保存；不是新增真实模型/费用效益/自主交付成绩。旧 Phase-1 意见的[跨线交接](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/REVIEW-CONTRACT-HANDOFF.md)保留历史文件，不修改虚拟社会线。本次[留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-07-before-verifier-study/VALIDATION.md)。

该切片冻结01ab356最终 **589/589、506.819秒**，独立浏览器 **38/38、1.3分钟**，TypeScript/diff/clean构建通过。[本批工程记录](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/BATCH-VERIFIER-STUDY-CHECKS.md)保留审查期间的非冻结失败；[VERIFIER-MOCK-01原件](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/experiments/VERIFIER-MOCK-01/RESULT.md)为131.547秒、54注入意图/36实际Oracle、0外部供应商请求。三策略固定首选各8通过10失败，合成Token/费用不得当模型效益。

[Verifier挑战准备批次](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/BATCH-VERIFIER-CORPUS-CHECKS.md)继续免费VE-01，18池36候选的实际Oracle与标签全一致（16通过20业务负例），116.390秒、0模型请求；原manifest/intent/results[归档](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/experiments/VERIFIER-PREP-01/RESULT.md)。这不是正式收费选优或新自主交付结果；新的完整回归以该批次最终实际日志为准，下文515/38仍是前一源码时点。本次[留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-07-before-verifier-corpus/VALIDATION.md)。

该新源码最终全量 **531/531、472.724秒**，独立浏览器 **38/38、1.3分钟**，TypeScript/diff通过；36份准备及15历史原件独立复核一致。新真实HTML、收费Verifier效益、物理相机与容器仍不由这些免费回归推定。

[v5公开材料](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/PUBLICATION-V5-2026-10-07.md)已发布，11页PDF逐页检查及13个公网文件HTTP/SHA读回通过。[HTML01](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/experiments/HTML-01/RESULT.md)通用网页真实运行失败，1自动返修、19次HTTP、总费用unknown，原失败不覆盖。其后免费工程修补的HTML执行事实v1/Prompt v9、返修review-context v2、boot-disk v1身份门禁与旧模型实测分列，新的源码尚须新实验验证。本文更新前[留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-07-before-html01/VALIDATION.md)。

本批冻结源码最终工程验证480/480（343.702秒），独立4421浏览器38/38（1.3分钟），TypeScript及diff格式通过，详见[BATCH-HTML01-CHECKS](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/BATCH-HTML01-CHECKS.md)。工程夹具/注入结果不计真实自主交付；HTML02按新预登记仅启动一次。

HTML02已实际单次终态failed：36.766秒、6HTTP、完整估算0.011305110 USD、2共享研究纠错耗尽、无冻结/Gate/源码，原四档[归档](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/experiments/HTML-02/RESULT.md)。其后新的HTML v10诊断与阶段B纯契约见[BATCH-HTML02-CHECKS](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/BATCH-HTML02-CHECKS.md)，不回写旧实验。当前全量结果以该新批次实际日志为准；上述480/38是HTML02运行前的源码，不直接代替后续新增代码验证。[本次旧文留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-07-before-html02/VALIDATION.md)。

v10与仓库准备切片最终工程 **515/515、343.231秒**，独立浏览器 **38/38、1.2分钟**，TypeScript及diff格式通过。全部纯注入/免费工程与历史回归，不新增真实模型或实体相机证明；当前真实HTML任务仍没有通过记录。

[CAMERA-09](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/experiments/CAMERA-09/RESULT.md)已完成一次最小真实有界场景交付，冻结source24256f9、11/11行为Gate、0返修，76.602秒、18实际HTTP、估算0.037964112 USD。完整摄像头/真实视觉/实体设备仍分别验收，不算完整良品或稳定L5。

后续pending计量修补、Verifier开发语料与历史证据验证见[BATCH-CAMERA09-CHECKS](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/BATCH-CAMERA09-CHECKS.md)，当前六角色Key已由用户配置在本分支页面，未迁移别线。新公开材料以publication-manifest/receipt为准，旧段落的Key未配置、当时未调用/未发布与189/229项工程数字均是历史时点，不是现在状态。[本文更新前留底](https://github.com/litianyi-007/city-agent/blob/5b91af1ecf7e20fff56789ab0b2d0e2c951d9bda/docs/production/archive/2026-10-07-before-camera09/VALIDATION.md)。

## 审查前基线已验证（历史记录）

- Node 22.22.3，全套单测189/189，墙钟11.685秒。
- 浏览器11/11，墙钟38.4秒；包含原虚拟社会人口/问卷/两类调查回归，以及生产三题实际行为、配置复制、移动端、Jev Key轮换和异步取消。
- TypeScript、Vite生产与Pages构建通过；没有发布Pages。
- Jev数值协议v2：21项适配器反例；独立免费属性检查111个Score与50个Choice；保留合法舍入、拒绝联合不可能分布与rubric标签篡改。属性检查不是校准证明。
- v2真实决策对照3请求：含弃权选中Gate2/3；另有v1数值协议失败和混合管线uncertain失败。详见EXPERIMENTS，不覆盖负结果。
- 原始供应商usage缺失不等同SDK默认0；保留实际已报告0。Harness每次至多1个上游POST，取消关闭请求/浏览器，重启不自动重放。
- API路径、符号链接、未知费用、预算停止、有限两次返修、冻结Gate、输入镜像假验收与PATCH默认重置均有负例。

## 未验证/未完成

新分支六角色生成模型Key未配置：真实内部模型编写与自主交付未实测，不称“最小真实闭环通过”或L4认证。3题是用户授权自拟，不满足真实需求来源条款。受控仓库、容器Node/shell执行、lockfile/patch交付和九次稳定性实验仍待实施；不降级到宿主执行生成脚本。

Key设置只回显状态；临时Jev凭据已入本线加密控制面，需要用户刷新后从页面替换。共享修订独立提交`d62b857`供另一线审查，不自动合并。

## 本轮评委审查修复

本轮新增反例覆盖生成页面延迟导航、无限循环/截图取消清理、Key的JSON转义与属性名脱敏、协议元数据碰撞、输入选择器别名伪装业务断言、中断JeV的未知HTTP请求数、导出血缘和路径逃逸。新配置使用 `production-html-v2`、`production-acceptance-v2`、`visible-token-v1`；不改写旧实验。

原虚拟社会worktree、main、冻结Tag、历史原始运行和旧申报附件仍不修改。最新用户授权本轮只新增 `gh-pages:production/` 独立静态评审门户；完整后端没有对外部署。发布使用根目录其余tree/blob的SHA核验与非强制更新，不能覆盖旧虚拟社会入口。

未完成的发布、PDF视觉检查或公网实操不提前算通过。本轮不发起任何模型或Jev付费请求；开发工具用量与机器成本未知，不填零。

### 冻结前工程回归结果

- Node 22.22.3：最终全套工程单测 **229/229**，墙钟 **17.615 秒**（先前一轮228/228，15.971秒）。
- 独立数据与 4421 端口：浏览器回归 **13/13**，墙钟 **45.7 秒**。包含虚拟社会人口来源/两个开店调查/问卷回归，生产三题实际 Gate、复制/配置、PNG预览、失败Gate标题和中断JeV unknown。
- 公开门户专项 **4/4**：实际 Chromium 三题行为交互、键盘切换、深浅主题及 375/768/1024/1440 四宽度；没有外部请求。实际公网发布后的检查另见本地 publication-receipt 和最终交付说明，不提前填通过。
- 导出/发布安全专项：源目录/文件 symlink 与路径穿越、未登记必需 JSON、hash 缺失/不一致、普通 manifest、文件数与大小边界、exact可信fixture字节、凭据字段扫描及虚拟社会整棵树SHA不变。
- 首次实际重导出因旧包 `mock-package-v1-qa1` 的精确版本兼容缺失被拒绝；仅显式加入已登记QA版本，不接受任意版本后缀，18/18材料/发布安全回归通过。未改旧manifest或原始文件。
- TypeScript 与工程 Vite 构建通过；最终 clean commit 仍须重新构建与核对 provenance。
- 对全部 tracked + unignored source 文件进行秘密前缀扫描，未发现疑似真实凭据；运行数据、加密主密钥、产物与测试目录均在 ignore 内。扫描不是所有未知秘密的完备检测。
- 只读对比原目录的 `status --porcelain` 和 `diff --binary` 与审查开始快照一致；main HEAD 与冻结Tag不变。虚拟社会并行 worktree 可有它自己的修改，本线不写它。

PDF、ZIP、静态门户与公网文件只会继承旧原始证据（生成 commit 891fedc），材料渲染/审查 publisher commit 单列。本轮免费回归不冒充新的真实模型实验。
