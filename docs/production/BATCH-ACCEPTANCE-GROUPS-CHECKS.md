# 分组验收工程批次与对抗审查

日期：2026-10-08。工作目录：`/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production`。分支：`feature/autonomous-production`；批次父提交 `28667eda5462524b3a1e18720e702009fccbf95a`。实施／文档源以本记录所在提交为准；冻结基线 `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466` 不变。

## 实际完成

- 增加默认关闭的 `planned-groups-v1`：项目经理验收计划及独立审核 → 测试最多3组 → 完整结构／语义／CSS／LLM审查 → 一次冻结 → 原研发／行为Gate／反馈链路。
- 逐槽动态JSON Schema绑定原计划、组、轮次、ID顺序、数量与步预算；原始模型值不规范化、不裁剪、不人工修补。仅去除包装的聚合候选使用独立ID，不伪造模型调用。
- 保存计划原始调用血缘、全部构建轮次、合法组及启动过的失败组调用ID、完整审核及冻结hash；来源或聚合篡改立即停止。
- 保留12×20容量与两次共享修复：局部结构拒绝仅重生当前组，完整覆盖拒绝开新轮重生全部组，不拼入旧轮答案；unknown、传输、协议、环境、取消不消耗候选返修。
- 免费预检明确16／28保守调用包络和未实测警告；保持用户原maxCalls／Token／费用门限。新策略与Jev、双候选、source-bound、摄像头及Mock不兼容时显式拒绝，UI不静默改配置。
- 更新README和待办前全文留底，逐字核对备份与父提交一致。新增 [下一单次实验提案](HTML-05-PROPOSAL.md)，预算授权为false，原八项业务验收、brief、Agent IDs和停止限额与HTML04一致。

详细设计与能力边界见 [契约](ACCEPTANCE-GROUPS-CONTRACT.md)。没有改主线worktree、main、gh-pages、冻结Tag、旧实验或申报原稿。

## 先失败再修复，不隐藏检查结果

首轮新管线／预检专项33项：6通过、20失败、7取消，5.779621125秒。失败发生于首请求前：把三份完整固定指令合并扫描，在正常六份synthetic凭据下触及原100,000工作限额，实际没有模型调用。取消测试因等待未发生的dispatch同时暴露无界等待；旧报告测试也发现undefined与省略字段的内存对象差别。

修复：分别扫描固定literal／diagnostic集合及三份完整指令，全部文字仍受原工作限额保护；取消测试改成有界等待；旧报告按实际JSON wire表示及hash核对。没有调大限额、跳过秘密检查或静默降级。之后36/36通过，补齐旧synthetic凭据碰撞后38/38通过，再增加两项真实动态schema／rubric契约测试。

以上首轮／专项TAP仅在工具输出中，不虚构日志文件或绝对起止时间。最终主代理日志在本worktree的被Git忽略的 `output/production-acceptance-groups/`；它们不是已发布评委附件。

## 验证范围

全量工程883/883通过，1,026.41735275秒（17.107分钟），失败／取消／跳过均0；该次测试集加载后又新增两项纯契约及一项真实Chromium纵向检查，补测单列，不把883改记为886。浏览器65/65（1.7分钟）、全树TypeScript与Vite构建通过。新分组UI11项全部截获生产API，真实launch返回注入拒绝，不实际请求供应商；旧调查／人群入口等回归同在隔离4421和独立测试数据中完成。真实模型验证未启动。

专项不与全量相加成新的成功率：

| 验证 | 实际结果／口径 |
| --- | --- |
| 主代理早期计划／容量／预检／HTML03/04原件回归 | 42/42，6.645593209秒，免费工程 |
| 新管线及预检／API专项 | guard修复后38/38，56.921374833秒；31管线＋7预检，注入provider/CSS/Gate，非模型效果 |
| 最终预检／API／模型输出契约补测 | 9/9，主代理0.8375895秒；包含后来增加的两项纯契约测试，单独记录 |
| 新分组纵向实际浏览器补测 | 1/1，5.044673584秒；真实CSS parser及Chromium Gate的页面加载、两条冻结业务检查通过。角色／Verifier为注入，HTML为测试自有，不证明模型质量或完整语义覆盖 |
| 最终全部新增分组专项 | 54/54，64.19363475秒，失败／取消／跳过均0；13计划＋32管线（含真实Chromium）＋9预检／API／输出契约。覆盖最终测试文件版本，不与883或65相加 |
| 独立安全／后端专项 | 37/37、77/77及新增碰撞2/2分别通过，不相加冒充全量；无供应商调用 |
| 独立代码质量／后端及同伴UI审查专项 | 新管线／预检38/38（58.35428175秒），最终9/9（0.8120905秒）分别通过 |

注入用量、夹具Verifier接受与假Gate通过不能进入自主交付良品分子；测试自有HTML的真实Gate通过也不等于模型自主开发，完整真实行为验证仍须新实验。独立审查者没有将自写模块／UI算作独立审查：模块由同伴安全审查，UI由同伴代码质量审查，root管线／共享契约分别受两方检查；最后新增真实Chromium测试由root非作者逐行审核。

## 对抗审查裁决

采用specs-review的非作者多角度审查：代码质量、后端契约及安全边界；无docs/lessons历史目录，不编造经验引用。

| 优先级 | 发现 | 处理 |
| --- | --- | --- |
| P2 | 新acceptance-plan继承普通PM scope，仍可能要求decision/tasks，与专门obligations/groups输出矛盾 | 新阶段全部三维及正反示例改为计划专用形态；旧阶段不改；新增契约回归与同伴复核通过 |
| P2 | 首轮合并公开凭据碰撞扫描超限，正常六Key路径在0请求处停止 | 按完整固定指令独立扫描，原每次100k界限与全部文本保留；正常路径及旧synthetic Key冲突0请求均覆盖 |
| P3 | 文档入口名未与实际UI完整标签一致 | 已统一为“启用分组验收规划（工程预览）”，独立复核关闭 |

最终无未关闭P1/P2。严格绑定、原Gate不可被改、取消迟到响应、unknown／非法Verifier输出停止、全局两修复、硬预算不抬高、free API不decrypt／persist／dispatch及旧HTML04报告hash均已专项验证。没有声称“完全安全”或用worktree代替生成代码沙箱。

## 复现与运行边界

Node22.19+（本批22.22.3），在本分支worktree运行：

```bash
npm test
npx tsx --test --test-concurrency=1 tests/production-acceptance-plan.test.ts tests/production-acceptance-groups-pipeline.test.ts tests/production-acceptance-groups-preflight.test.ts
npx tsx --test --test-concurrency=1 tests/production-acceptance-groups-preflight.test.ts
npm run build
PRODUCTION_E2E_PORT=4421 npx playwright test --config docs/production/baseline.playwright.config.ts
npm start
```

测试与服务端口／数据目录依本分支配置独立；不运行原目录服务或默认历史4311配置。真实运行还须提交后干净构建并重启服务；只刷新浏览器不能换后端已加载代码。本地入口 `http://127.0.0.1:4420/#production` → 新建自定义需求 → 真实模型、离线HTML、LLM、1候选、兼容证据模式 → 勾选新策略 → 免费启动预检。未有新预算授权不要点击收费启动。

生产源码boot闭包自动含新模块；旧独立Verifier study闭包不被当新分组证据。HTML03/04等旧原件维持原字节／版本。公开v6静态门户未部署新后端；本批普通推送仅生产feature分支。

## 运行时间、Token、费用及下一步

本批新增外部供应商请求0，未产生新平台任务的实测业务用量或费用。工程测试时间见上表／最终日志；注入的100/100等usage只是控制面会计夹具，不是实际Token。外层开发助手Token／费用、机器运行成本无法从本平台获得，标为unknown，不记成零。

本地原20条生产、2条Jev基准、3条study均已终态，旧授权不复用。下一步为HTML05新单次预登记与预算确认，之后核对完整原需求、实际交互及新增规划成本。首次通过只算最小真实闭环，不算稳定／通用L5或高性价比已证明。

提交前范围／可识别秘密扫描覆盖本批全部源码、测试、材料及备份，不读取真实Key或私有状态；模式扫描不等于任意秘密完全不可泄漏。文档新实验提案亦经非作者审查，确认无新授权、业务改写、提额或虚构实测。
