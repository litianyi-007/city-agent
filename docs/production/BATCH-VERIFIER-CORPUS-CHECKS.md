# Verifier挑战准备批次：工程验证

2026-10-07，独立`feature/autonomous-production`。在HTML v10与仓库准备契约之后，继续免费的VE-01：18池/36完整候选、盲评白名单、实际业务Oracle、离线请求容量与可追溯准备脚本。本批不增加生产API/能力，不执行仓库脚本或新收费请求，不改公开v5/旧实验/冻结Tag。

## 实测专项

| 范围 | 工程结果 |
| --- | --- |
| H01–H06 | 最终4/4、52.719秒；12实际候选、5通过7业务负例、116含加载检查 |
| H07–H12 | 最终3/3、43.872秒；12实际候选、6通过6业务负例 |
| Scene＋聚合初版 | 8/8、24.460秒；12场景及C17不计分正控、盲评/容量/确定性 |
| 聚合intent边界最终 | 4/4、607.324ms；已启动取消/失败不消失到not-started |
| 统一准备runner | source7755b4d、clean=true、116.390秒；36/36意图完成且实际标签一致；31声明来源hash |

准备runner四份原件[归档](experiments/VERIFIER-PREP-01/RESULT.md)，独立核对原字节与SHA；CAMERA09/HTML01/HTML02的15个历史原件也保持不变。最大Jev逐问20,223/总24,992 B；逻辑LLM28,708 B；没有扩容、截断、把Oracle结果注入模型请求或偷用既有Key。

## 修订与边界

H10首轮专项2/3、28.202秒，在缺中间数量断言时坏候选删除过多导致后续点击超时；没有把该超时记为坏标签验证成功。Oracle在第一次删除后增加精确数量/身份断言，候选源码和分层不改，重新3/3通过。H01的0/6也拆成独立页检查；H06明确A→B→全部，避免首次失败遮蔽后续边界。

C17独立审查发现过滤objects会改变整个scene的seed：修复为原scene一次粒子生成再按count分片，验证原始区域；派生仍明确不同seed。补wx先行intent、异常terminal、逐前后及结尾HEAD/source保护、取消最后一项保护；value JSON/raw HTML hash分别命名。修正发生在统一准备source提交前，未改已有实际实验或看到收费判断后改标签。

源码/用例冻结后执行完整Node与独立4421浏览器回归，随后按实际追加最终结果。机器和外层开发工具耗费unknown；0供应商请求不是已测“零成本模型收益”。下一任务是免费VE-02/03同条件study adapter及账本；任何真正选优/费用结论须新冻结和预算。详见[挑战集](VERIFIER-CHALLENGE-CORPUS.md)及[对照计划](VERIFIER-EVALUATION-PLAN.md)。

## 最终全量结果

Node22.22.3完整工程测试 **531/531**，472.724秒，0失败/跳过/取消；`output/production-html02/node-full-verifier-final.log`。独立4421/临时数据浏览器 **38/38**，1.3分钟；`output/production-html02/browser-verifier-final.log`。包含原虚拟社会入口/人口/问卷和生产配置/复制/Mock交互/取消等回归，不运行原目录服务。TypeScript及diff格式通过。完整测试开始后不再修改源码/测试，只补文档和原记录归档。

另一外层Agent独立复核本机114文件：36初始intent、36terminal、36逐个Oracle与聚合全一致；31源码hash与7755b4d一致，18请求重新序列化hash/大小一致。C17原cone左3662/右0、star左0/右1562像素；generic Gate均通过而业务Oracle正确拒绝，C15无雪主体真实不可见失败。历史15档SHA无变化，分支/冻结Tag未移动。工程结果不替代付费策略实验或内部模型自主研发。

最终文档提交后重新干净build和本线4420服务启动，实际身份以metadata的source/build/boot一致为准；不发布新dist到固定v5公共材料。
