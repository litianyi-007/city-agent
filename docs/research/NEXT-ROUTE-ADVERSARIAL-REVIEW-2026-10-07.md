# 申报材料完成后的主线：下一批背景审查与任务门限

## 阶段边界

先完成[离线申报材料](../submission/README.md)：13页报告、按申报结构的brief、4分25.96秒实际录屏、官方原件与三组独立证据。84项payload＋manifest校验通过，20个本地链接有效，MP4实际离线播放，PDF逐页目视检查；本次不新增付费调用，不改变旧里程碑截止时间。

以下是恢复开发的任务顺序，不写成已交付能力。当前开发范围为`feature/virtual-society-next`，不操作main或L4/L5 worktree。两次历史真实实验账本保持关闭；新增模型探测或居民实验另立计划与预算。

## 对抗性审查结论

1. **先纠正接口事实，再选实现。** 官方Responses API已经登记`text.format.type=json_schema`、`name`及`schema`；原“所有DeepSeek路径都没有schema”的概括不成立。Chat Completions、Responses与Beta strict工具参数是不同协议；文档声明不等于本机Harness封装或具体nullable问卷已经可用。[官方Responses接口](https://api-docs.deepseek.com/api/create-response/)、[官方Responses指南](https://api-docs.deepseek.com/guides/responses_api/)。
2. **用量必须有真实上游见证。** SDK规范化的0/0不能证明供应商发出了完整usage。已用本地SSE、虚构Key重现：上游无usage，旧Harness仍给`usageReported=true`及0/0；此时实验guard可能释放预留。新受预算路径先核验provider原包，再核对SDK总量，未知或异常保留预留并停止全部后续请求。
3. **结构正确不是研究有内容。** 离线反例表明，几乎全部业务题`unknown/null`的答卷可以通过结构、登记逻辑和情景资格。合法未知应继续通过类型检查，但研究状态应单独标记为信息不足，不能迫使模型补偏好，也不把HTTP200或结构valid叫业务成功。
4. **目标与受访者单位先匹配。** 儿童本人口味、照护者购买/许可、宠物零食与主粮、个人与家庭预算、渠道与真实候选点是不同问题。人群情景覆盖比例不等于人口权重，不从教育/收入/资格标签生成消费历史。
5. **历史试验不可补分。** 首个跨题事件与首个多选标量事件照原规则保留。未启动、结构阻断与已评估错误分开描述；新问卷/Prompt/传输路线/校验器另立版本，不能事后使旧失败变成通过。

## 路线优先级

| 候选 | 为什么值得核验 | 离线先确认什么 |
| --- | --- | --- |
| A：保留Harness，锁定Responses协议与原生schema输出 | 直接面向答卷内容，避免把数据伪装为工具执行 | 固定SDK的Responses transport、schema注入缝、完整SSE终止和usage、一次上游请求 |
| B：保留Harness，自定义固定答卷adapter | 扩展缝可以严格约束transport，便于预算/原文见证 | API选择、schema/raw绑定、无工具执行及无第二模型回合 |
| C：Beta strict固定函数arguments作为答卷 | 工具参数可表达部分schema约束，是候选而非默认答案 | nullable/数组/枚举兼容、参数原文映射、没有实际工具执行、本地约束完整保留 |

候选比较不能同时改题目和transport后归因；不升级`node_modules`或扩大任意endpoint权限。每条路线要分别列出“官方声明”“固定SDK类型/代码”“本地fixture通过”“真实API探测”，不能用前一层替代后一层。

## 六项任务与evaluation门限

| 顺序 | 任务与交付 | 验收门限 |
| --- | --- | --- |
| 1 | 目标→受访者单位→问卷→知识依据→输出矩阵 | 两原场景每个输出有匹配受访者与观测；口味代理、家庭/人分母、零食/主粮、模拟/现实逐项分开；所有信息缺口有出口 |
| 2 | 诊断与历史保全 | 新审计区分not-started / structure-blocked / checked / unknown；原始文件按固定manifest在开始与结束校验100%一致；运行时间口径明确 |
| 3 | 路线能力矩阵与最小Harness slice | nullable、合法零、五题型、排他多选均可表达；SDK/relay原文与schema hash绑定；每invocation上游≤1、工具执行0、自动重试0；实网能力另待授权 |
| 4 | 版本化答卷compiler与独立oracle | 全题ID/类型一一绑定，含可选题显式缺失出口；漏题、重复、错ID、未知字段、标量多选、超界等mutation拒绝100%；不只调用生产validator自证 |
| 5（安全前置） | provider usage见证、预算与wire绑定 | 缺失/不完整/异常usage停止全部且保留reservation；真实合法0可区分；缓存输入口径核对；第二请求、漂移和网络异常不重试；schema/body计入预留 |
| 6 | 内容充分性与现实校准设计 | 全unknown结构合法但研究状态不升级；过去行为有来源或显式未知；未确认可达与不可达分开；不强设非未知配额；真人/订单留出及人格消融另立预登记 |

任务5已作为本次恢复开发的首个安全修复，其他顺序保留依赖关系。它只针对带预算、单请求relay的路径时，报告必须明确该范围，不泛称普通页面/Harness所有用量路径已经覆盖。

## 下一次真实实验准入

完成上述离线门后，先提出固定数量的最小能力探测矩阵与新预算：nullable、排他多选、完整17题、完整18题；路线、模型、参数、问卷及源码hash均预登记。得到新授权才请求，不使用关闭账本余量，不重试、换模型或补样。探测通过后才另立10＋10居民试验；即使联合20/20，也仅证明该轮工程与登记规则，不认证人口代表性、人格效度或经营预测。
