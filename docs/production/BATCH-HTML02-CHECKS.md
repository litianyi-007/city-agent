# HTML02后的免费修补与阶段B准备

2026-10-07。本批[HTML02真实结果](experiments/HTML-02/RESULT.md)与工程结果分列：failed、36.766秒、6次HTTP、估算0.011305110 USD、2共享返修；不覆盖HTML01、CAMERA09、申报基线或固定v5包。

## 实现与边界

- HTML Prompt v10增加通用JSON数组/字符串语法示范及研究条目soft长度建议；actual schema/max12不变，不自动删条目。camera基础指令和v7不加入这些HTML专用改动。
- `production-json-diagnostics-v1`只诊断已脱敏原文：SHA、Node首次JSON.parse错误、UTF-16位置/围栏偏移、至多320代码单元的真实片段；无位置保留null、合法JSON不造schema结论。ledger保留全部原文，仅下一原角色纠错获得绑定原call/候选/原SHA的诊断；独立review仍排除regeneration，避免先前失败意见污染新候选评审。
- 诊断不修JSON、不选模板、不跳角色、不代替Verifier或冻结行为Gate；共享返修仍最多2次。长协议标识的所有可成为Key的子串拒绝，不读取或迁移用户Key。
- Jev unknown仍停止和保留unknown总账，同时保留原决策失败原因；本地容量拒绝不再只显示为用量漏报。即使0 POST也不推造0 Token/成本。旧HTML01/06原错误不回写。
- [受控仓库准备契约](REPOSITORY-PREPARATION.md)实现任务/普通文件/全文件patch/控制面readiness的严格schema与绑定；现有API/两能力不变，不运行生成的Node/shell，声明校验不是实际沙箱证明。

## 专项结果与修订记录

| 专项 | 实测工程结果 |
| --- | --- |
| HTML02原证据 | 7/7，520.484ms；四SHA、身份/调用/费用、两个数组余引号及潜在13项、没有Gate/源码 |
| JSON定位 | 8/8，505.837ms；1816/1843/1891、围栏/Unicode、无位置null、schema不合法但语法合法不造诊断 |
| 新反馈接线/凭据/Jev原因 | 3/3，3.716s；>2000位置原片段、来源binding、review不含失败片段、unknown停止/原因保留 |
| 阶段B纯契约 | 17/17，251.391ms；路径/秘密/保护Gate/patch来源/大小/资源unknown/readiness拒绝 |

首次综合55项中54通过、1失败（59.839秒）：新工程测试误在`criteria.reviewContext`取上下文，实际独立LLM wire布局是`state.reviewContext`。只修正新测试的取值路径，保留“旧诊断不得进入review”的断言，未修改生产投影、冻结门禁或历史记录。后续接线专项3/3通过；旧失败日志保留`output/production-html02/targeted-checks.log`。诊断专项早期7/8的一项误以为Node所有语法错误都报告position，改用确定有position的对象反例，并继续保留无位置null的测试；不是放宽宿主JSON解析。

本批没有额外模型请求；机器及外层开发工具用量unknown，不记作零。完整Node/浏览器与最终干净构建结果随后按实际补记，不由专项推定。新的v10工程未被任何真实运行验证，下一次真实任务须新的预登记/单次预算，不追认HTML02成功。

## 最终全量验证

冻结生产源码后，Node22.22.3完整工程测试 **515/515** 通过，343.231秒，0失败/跳过/取消；日志`output/production-html02/node-full-final.log`。启动后仅追加文档，没有再修改生产模块或测试源码。独立审查未发现本范围P1/P2，CAMERA09/HTML01/HTML02共15个原档SHA仍一致；不把审查或515夹具计为真实交付成绩。浏览器及最终构建结果单列，不能从Node通过推定。

随后独立4421/临时数据浏览器回归 **38/38**（1.2分钟），覆盖生产配置/复制/三Mock行为/返修与取消账本，以及原虚拟社会人口、问卷和调查入口；日志`output/production-html02/browser-final.log`。TypeScript和diff格式通过。最终提交后重新干净build/实际重启，身份以本机metadata与`dist/production-build.json`为准；最终编译资产没有发布到固定v5线上材料。

## Jev算术升级的免费复核

再次核对[官方Confidence定义](https://docs.typesafe.ai/confidence)与[Score定义](https://docs.typesafe.ai/primitives/score)：Score使用按等级距离的分布统计，不能套Choice的top概率公式；score为等级的概率加权均值。当前实现仍按各自公式和显示舍入检验，未为省费去掉一致性检查。

HTML02产品coverage的最大概率等级为4，score=3.50、confidence=0.56。按官方五级Score定义，mode为4时应有`confidence = 1 - (4-score)/1.2`；即使允许两位小数各±0.005，score对应confidence约0.579～0.588，与报告值对应0.555～0.565不重合。scope的3.49/0.55也不一致。这是原响应数值的静态反例，不是新的模型判断，不修改原分数、不把单案例扩展成供应商普遍结论。

因此本次Jev升级理由有可复核的公式证据，但它没有减少LLM调用，不能把低单价宣传成已测省费。更小原子问题、独立标注与同条件成本对照仍按Verifier评估计划准备；任何改用本地重新计算分数的策略必须另起版本/实验，不能默默代替本次provider值或放宽既有Gate。本节只读取公开文档/归档，0新增Jev/LLM派发。
