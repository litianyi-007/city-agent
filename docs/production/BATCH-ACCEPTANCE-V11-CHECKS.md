# HTML v11：验收规划、容量反馈与免费工程验证

2026-10-08。仅在 `city-agent-autonomous-production`／`feature/autonomous-production` 开发；基于已推送的 `5bc9b4da426011c7179e41643cf1241a02f0b484`。原目录和虚拟社会 worktree 不开发、不停服务；冻结 Tag、main、旧实验、申报稿及 Pages v6 不修改。README 与任务清单更新前的完整内容在 [留底目录](archive/2026-10-08-before-acceptance-v11/)。

## 本批实际解决的问题

[HTML-03 原结果](experiments/HTML-03/RESULT.md)已证实：三份测试 JSON 可解析，但检查的部分步骤数超过既有20步限制，两次共享返修耗尽；没有研发、冻结检查或 Gate。反馈已保留超限索引与完整错误，欠缺逐项步数；2,000字符摘录没有覆盖任何超限项正文。静态审查另发现负例状态组合遗漏及其它字段无效造成的混淆，不能仅压缩步数就追认为完整验收。

本批采用通用 HTML 规则，不按“费用记录”关键词分流，不生成该需求的宿主参考答案。旧 HTML-03 五份原件和三份测试原文不改。

1. **实际 schema 提供容量事实。** 新诊断模块从 Gate schema 导出 maxChecks／maxSteps，作为宿主事实送入 HTML 各角色及评审上下文。仍为最多12项、每项最多20步；业务验收、角色输出结构和 Gate 规则不变。
2. **拒绝反馈可逐项定位。** 保留原错误、原文摘录、call／candidate及原文 SHA；新增检查总数、每项步数、超限索引与上限。由 tester 自主重新组织完整新候选，宿主不删步、拆改 checks、自动修 JSON 或增加返修。
3. **规划与覆盖分开审核。** researcher／项目经理在已有字段说明分组及 setup／操作／断言预算；tester 只输出 checks。以原始 brief 和 requirement.acceptance 为准，产品摘要不能授权删减条款。各 check 独立新页，覆盖明确指定的状态和边界；负例只改变被测变量，成功清空后先补齐其它合法字段，断言实际业务结果而不只是提示。
4. **LLM Verifier 保留独立裁决。** HTML 测试契约的 LLM 静态评审政策要求核对原始需求、完整候选及同源容量；确定遗漏或负例混淆须低于3分，全部不合格／证据不足须弃权。仍严格四字段、最低3分与最高分选择，不新增请求或递归评审；LLM 是否忠实执行该政策尚需新真实实验，意见不替代实际行为 Gate。Jev 快速层评分／弃权规则本批未改，不冒称它实现了这段新增 LLM 提示词政策。
5. **证据与秘密边界同步。** validationContract 记录诊断／规划版本；新模块进入当前评测源码闭包。新增协议字面量受现有秘密碰撞保护；已存历史凭据与新增结构碰撞时，在首个角色请求前失败并留证，不自动迁移 Key 或输出凭据摘要。

## 诊断不是放行器

`production-acceptance-diagnostics-v1` 只处理有界完整字符串，最大64KiB／64项／每项512步是**诊断资源预算**，不是放宽12／20验收。primitive string 外输入不触发 getter／Proxy；无名字、选择器、供应商片段或任意 Zod 路径进入结构化诊断，仅固定字段、数字、布尔和输入原字节 SHA。

解析不完整、额外字段、其它 Gate schema 错误、预算过大或没有容量超限时不提供诊断；没有诊断不等于合法。Production 的额外 CSS／custom 约束仍由完整原校验判定，容量诊断可能与这类拒绝同时存在，不能把它当作唯一错误。调用方先按现有策略脱敏，SHA 绑定传入的已脱敏完整原文，不是 Key 摘要或独立签名。历史返修反馈从当前 Verifier 上下文中移除，避免把前一候选的容量错误冒作新候选缺陷。

| 版本空间 | 本批状态 |
| --- | --- |
| HTML Prompt | `production-html-v11`，研究／规划／测试及 HTML 测试评审政策变化 |
| 诊断／规划 | `production-acceptance-diagnostics-v1`／`production-acceptance-planning-v1` |
| Verifier 评分与阈值 | 仍 `verifier-phase-ordinal-v5`，独立于 Prompt 与源码闭包版本 |
| 当前 study 源码闭包 | `verifier-study-source-v6`／52文件；新增诊断模块，旧51集合不得冒作当前来源 |
| 摄像头 Prompt 与历史归档 | 原 CAMERA v7、历史来源与归档读取保留；不改旧证据版本 |

## 免费验证与独立审查

- 新纯诊断9项：三份 HTML-03 原字节 SHA／超限向量、12×20边界、资源预算、无信息外泄、不合法输入与 mixed rejection；不外呼、不启动浏览器、不执行候选。
- 新 Prompt10项：原始验收优先、独立 setup／预算／负例隔离、严格输出与评分、CAMERA和其它未改角色提示词保持；不是语义模型效果实验。
- 新管线5项：注入适配器演练反馈→模型完整新候选→冻结控制流；连续三份坏候选9调用／两次共享返修后失败、零研发／Gate；结构合法但覆盖评审弃权不会冻结；新配置及历史凭据碰撞失败关闭。所有响应／usage为工程合成，不记为真实自主交付。
- 主代理专项53/53（54.248秒）、安全／历史交叉52/52（6.246秒）、另一 code-quality／server交叉39/39（19.667秒）通过；专项互有重叠，不相加为全量测试数。
- 全量 Node **824/824通过**，933968.9845ms（约15.57分钟），0失败／cancelled／skip；821个顶层项含3个嵌套子项，不混淆总数。日志 `output/production-acceptance-v11/node-full.tap`。TS、diff 检查与构建通过，浏览器 **54/54通过**（约1.6分钟），包括原虚拟社会功能；日志 `output/production-acceptance-v11/browser.log`、`build.log`。提交后须重新做干净构建／重启，不能用 dirty build 充当付费准备身份。
- 外层作者与非作者交叉覆盖 code-quality、security、server；最终实现／文档／范围审查无开放 P1/P2。23份拟提交文件（6文档、6源码、11测试）形态扫描及现有公开秘密检查完成，6处命中均为明确合成测试字符串，未输出其内容；另检查转义编码形态。旧HTML-03五JSON SHA未变，两份留底逐字节匹配基线。未读取私密state／Key或ignored输出；范围扫描不证明任意未知变换的秘密安全。外层开发 Agent 的审查不计入平台六角色自主占比。

本批0外部模型请求、0供应商模型费用；免费测试可用本地替身／受限 Chromium，不能称所有测试均“没有模型协议或浏览器执行”。外层 Agent Token、机器／人工成本与本批总人工周期未统计，标记 unknown，不记零。本批改善是否提升真实模型质量、节费或交付成功率尚无新实测；不沿用 HTML-03 一次授权或剩余额度。

复现全量工程验证（Node22，首次先按指南安装独立依赖与 Chromium）：

```sh
npm test
npm run build
npm run test:e2e
```

仅静态历史／新诊断核验，可运行 `npx tsx --test tests/production-acceptance-diagnostics.test.ts tests/production-html03-evidence.test.ts`。注入控制流与 Prompt 测试另见同名前缀测试文件，不能据它们的 fixture 终态证明新的付费模型成功。

## 本地体验与下一步

Node22.19+，按 [RUNBOOK](RUNBOOK.md) 使用本分支独立依赖、数据及4420／5420／4421／4422端口，`npm run build` 后 `npm start`。打开 [生产工作台](http://127.0.0.1:4420/#production)，历史 HTML-03 可只读查看；工程 Mock 不需 Key，费用题真实重跑则必须新授权。Key继续只在页面填写，不写入源码／导出／日志；不自动迁移其它 worktree 配置。

下一步为 [HTML-04 待批准单次方案](HTML04-NEXT-RUN-PROPOSAL.md)：使用相同费用页原始需求与八项业务验收、新 Prompt／来源和新 run ID，先免费预检再另行确认一次预算。即使未来 `completed`，也要核对全部原始验收覆盖与实际行为结果，不把静态评分或 prepare ready 当完整成功。只跑一次探索不证明稳定通用 L5，也不能与配置不同的旧探索合并算成功率。受控仓库／容器及九次泛化仍在后续阶段，不降级宿主执行生成脚本。
