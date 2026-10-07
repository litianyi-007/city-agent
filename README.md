# City Agent

2026-10-07追加：JSON契约修复后的第二轮真实调查已完成，仍未通过两个10人门限；小学0/10、宠物3/10联合通过，15未启动。5次确认请求、17,032 Token，保守估算¥0.042032；按授权停止整场景，规划/CORS未再启动。旧RC1、原PDF和旧账本保持不变。[独立测试与下一步](docs/research/CONTRACT-TRIAL-2026-10-07.md)。本轮已关账，不以未用余额自动重试或扩容。

公开评审版 RC1 已发布：`feature/virtual-society-next`，固定 Tag `society-review-2026-10-07-rc1`（源码 `0600eb067fa74a448c96610f7f47ca9176d56760`）。[源码/材料下载](https://github.com/litianyi-007/city-agent/releases/tag/society-review-2026-10-07-rc1) · [发布实证记录](docs/research/PUBLIC-RELEASE-2026-10-07.md)。`main`、旧 Tag 与并行 L4/L5 分支不改，正式比赛尚未提交。[合并待办与真实状态](docs/SOCIETY-NEXT.md) · [五层人群方法与在线依据](docs/research/RESIDENT-CONSTRUCTION-METHOD.md) · [历史16题/12人工程自证](docs/research/PERSONA-PROOF.md) · [评测预登记](docs/research/EVALUATION-NEXT.md)。

历史RC1轮已实施真实 API 合成居民调查，不是 mock：计划两场景各10名；小学17题实际1名、联合通过0/10，宠物18题实际2名、联合通过1/10，合计17名未启动；两场景均未达到扩容门限。另2次自然语言规划均未产出可应用的 schema 候选；2次浏览器跨域请求 HTTP200 仅证明协议路径，不是新版页面完整流程或额外独立居民。全部7次确认请求 input15,418/output6,881 Token，按冻结高峰非缓存价保守估算¥0.085884，不是供应商账单。¥5/24次授权未用满也不自动重试或扩容。

截至本候选文档更新，284项单元测试、19项浏览器回归（37.0秒）及本机/Pages两种构建通过；最新事实与发布封板见[本轮真实测试与发布审查](docs/research/LIVE-REVIEW-2026-10-07.md)。历史188/14阶段见[初批交接](docs/research/NEXT-BATCH-REPORT-2026-10-07.md)，历史239/19阶段见[评审补齐交接](docs/research/REVIEW-COMPLETION-2026-10-07.md)；不把旧工程结果改写成新的模型质量。

[阶段里程碑汇报](docs/MILESTONE-SUBMISSION-2026-10-07.md)：封板截至2026-10-07 03:19:40（北京时间），四项申报附件及外部观测映射、记忆/wiki/dream的未实施规划齐备。冻结Tag：`submission-milestone-2026-10-07`；后续新任务从此Tag分支。申报完成不代表原产品M1/M2全部验收通过。

公开问卷 Demo：**https://litianyi-007.github.io/city-agent/**。已上线：[公开评审材料](https://litianyi-007.github.io/city-agent/submission-next/index.html) · [真实测试轮报告](https://litianyi-007.github.io/city-agent/submission-next/live-proof/report.md) · [原文/失败总账JSON](https://litianyi-007.github.io/city-agent/submission-next/live-proof/report.json)。公网119项文件字节与发布版一致，零费用页面流程独立通过；335文件固定源码包在macOS同机新目录安装复验通过，不是跨平台/他人干净电脑验证。原冻结[申报材料](https://litianyi-007.github.io/city-agent/submission/index.html)及[录屏](https://litianyi-007.github.io/city-agent/submission/demo.mp4)保持不变。新版4分33秒视频是前次零费用 UI 操作，不冒充本轮真实 API 录像。

**评委入口：[完整快速开始与故障排查](docs/guides/JUDGE-QUICKSTART.md) · [静态说明页](public/review-guide.html)。** 三条路径：浏览器无Key看快照/规则；页面自备Key直接请求供应商（需CORS、不经过Harness）；下载候选固定源码后本机通过Harness复现。`doctor/start:review`属于新候选，旧冻结Tag只有原基本启动；材料ZIP不是安装包。Windows/Linux尚未完成本项目干净机器实测。

外网版可直接点击「查看已发布实测 · 无需Key」读取旧12人15题真实问卷及49次居民实验；旧44/49有效、稳定性未全面通过的记录保留，不能与新增7次请求拼成新的通过率。完整业务工程示例始终0次模型调用，规则答案不算人格效度。自备Key在页面填写，只保留本次会话，刷新后清除。GitHub Pages不托管Harness后端，真人市场效度仍未验证。[历史审查补齐](docs/research/AUDIT-FIXES-2026-10-07.md)。

本地 demo 已实现四角色有界自主研发流程：配置角色和模型、提交任务、拆解、研究、实现、独立验收与自动返修。规则夹具可完成交付，但旧里程碑六次真实模型交付均未通过最终Gate；不能将流程存在或生成了HTML当作L5交付已完成。居民问卷的真实实测与该失败分开记录。

**当前工程范围：离线单页 HTML/CSS/JavaScript 应用。首个场景：杭州滨江人口结构下的商品调研预演。** 尚不支持任意代码仓库、后端服务、生产部署或真实市场预测；真实模型交付质量仍需闭合验收。

另一个核心交付是**可追溯人口底座**：官方原件与发布页存档、逐格事实、数据包校验、显式联合分布推断，以及可复用的新区域录入流程。

## 启动

Node.js 22.19+（已验证 22.22.3），不要使用Node 20；使用nvm时先执行`nvm install && nvm use`读取`.nvmrc`。首次安装：

评审应下载上面已发布的固定 Tag/完整 commit SHA，而非浮动分支。在新目录取得源码，再执行安装：

```bash
git clone --branch society-review-2026-10-07-rc1 --depth 1 https://github.com/litianyi-007/city-agent.git city-agent-review-rc1
cd city-agent-review-rc1
git rev-parse HEAD
```

```bash
npm ci
npm run setup
npm run build
npm run doctor
npm run start:review
```

本续作打开 **http://127.0.0.1:4320/#research**。`doctor`只读检查，不读Key/私有配置，不创建数据库，不安装或请求模型；退出码0=前提就绪、1=检查失败、2=参数错误。`npm run doctor -- --json`输出报告；启动器自检失败不启动，不自动换端口。跨平台覆盖：`npm run start:review -- --port 4330 --data-dir .city-agent-review-4330`。默认数据目录为专用`.city-agent-review/`。Ctrl+C正常停止。

开发模式：`npm run dev`，本续作前端 http://127.0.0.1:5180，API 4320，浏览器回归默认4321；可用`CITY_AGENT_WEB_PORT`、`PORT`、`CITY_AGENT_TEST_PORT`显式覆盖，API代理跟随PORT，不静默连接原项目4310。`npm start`仍可作为直接开发入口，默认数据目录`.city-agent/`；可用`CITY_AGENT_DATA_DIR`指定独立目录。同一数据目录只允许一个服务进程。评委优先使用上面的专用启动器。

复现已公开旧冻结Tag时，请按[评委指南A路径](docs/guides/JUDGE-QUICKSTART.md#a-现在就能下载的旧冻结版源码)使用原`npm start`及4310端口；旧Tag没有新增自检/评委启动工具。新候选使用独立固定ref，不移动旧Tag。

## 本机版使用

1. “智能体团队”支持新增、编辑、启停、复制和删除。角色固定为产品、研发、测试、研究员；每位 Agent 单独配置 provider、base URL、model ID、API Key。
2. “任务工作台”每个角色选择一名 Agent，输入需求与商品、价格、样本量、seed。
3. **流程演示**无需 Key，使用确定性计划、规则模拟和页面模板，但仍执行真实 Chromium 验收。它不构成 LLM 自主开发证据。
4. **真实模型**通过 DeepSeek Harness SDK 实际请求四个角色的模型。测试断言在研发前冻结；失败最多自动返修两次。无需中途人工确认。
5. 查看执行日志、角色产出、调研结果和交付产物。HTML 可预览，JSON 可下载；运行记录在刷新、重启后保留。
6. “城市与样本”可查看2020三街道结构与2023—2025区级常住总量，追溯逻辑人口到原表、下载原件与数据包、上传新区域JSON预检。新年份总量不自动替换旧结构；预检不自动激活数据包。
7. 一键选择“小学生零食店”或“宠物零食网点”验收例子。流程会交付条件研究页面、数据缺口与假设；商业决策保持 `needs-data`，不将通用15+规则接受率套到学生或养宠人群。
8. “虚拟社会调查”（`/#research`）：编辑五题型、导入/导出、选择人群、预检和保存草稿。下方可运行规则夹具或通过Harness真实作答；冻结分析、原文、硬约束诊断和成本，导航/刷新后恢复历史。完成后点击「交给四角色生成交付页」连接真实研发线，不再用旧价格公式替代问卷。
9. 调查页内“人群 Agent 预设”（`/#residents`）提供一般成年居民、小学生照护者、养猫家庭购买者、养犬家庭购买者，可新增、自定义、编辑、复制、启停和删除。独立配置模型与 Key；与研发四角色不混用，预设不是实际居民记录，也不预填商品偏好。
10. 续作支持五层情景构建：Big Five倾向、成长照护与多选经历、教育、当前关系/同住/照护、工作社会角色/明确口径的月收入。默认未知、可自定义，全部assumption，旧记录不自动补推；人口资格筛选仍独立。完整Prompt和新版本快照保留这些字段，两种消融则移除。
11. 调查页“从自然语言规划调查”可显式选择已配置的产品/研究员进行单次Harness候选规划，确认费用后启动，支持取消/下载/应用草稿；不自动启动居民、不认证事实。90秒/6000输出Token；失败及取消证据保存在专用数据目录的`planning/<UUID>.json`，勿公开私人研究文本或日志。
12. “检查业务证据包”导入/编辑来源、观测与研究要求，纯只读校验地域、时期、单位、分母、冲突和来源引用；不抓网址、不调用模型、不激活人口或经营推荐。结构就绪仍须人工审核原件与授权。

升级已有运行实例时须重启后端才能加载新增接口；仅刷新浏览器不足。重启前先结束正在运行的任务。调查草稿保存在同一 SQLite 数据目录；导出的问卷不含人群连接信息或 Key。界面/接口与阶段限制见[本批交付记录](docs/research/WORKSPACE-2026-09-24.md)。

## 人口数据与新区域录入

2020-11-01七普常住503,859人：西兴143,318、长河168,276、浦沿192,265。完整保留官方年鉴、网页、页码、表格定位、原件SHA-256，以及28条建模观测。2025年末55.9万人是1%人口抽样调查推算且按0.1万人发布；不冒充逐人精确的最新街道人口。[官方2025公报](https://www.hhtz.gov.cn/col/col1229574514/art/2026/art_d79bffcf95f24e619178dd3acfaee081.html)

```bash
npm run population -- validate data/population/regions/binjiang-2020.json
npm run population -- compile data/population/regions/binjiang-2020.json --output data/population/binjiang-model-review.json
```

编译拒绝覆盖已有输出；未填来源和观测的 `new-region-template.json` 应被阻止。当前编译器支持单时点的完整子区域总人口/年龄/性别边际或完整联合表，尚无任意区域自动爬取、地图选址或数据包自动发布。详见[可复用方法论](docs/population/METHODOLOGY.md)与[三分钟讲解稿](docs/population/DEMO-TALK-TRACK.md)。

## 本机版模型连接

| Provider | Base URL 示例 | Model ID |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | 服务商提供的模型 ID（预填 `deepseek-flash`） |
| OpenAI Compatible | 你的兼容接口根地址，通常以 `/v1` 结尾 | 接口支持的 ID |
| Anthropic | `https://api.anthropic.com`，不要重复添加 `/v1` | 接口支持的 ID |

必须支持对应的流式 Chat Completions 或 Messages 协议。当前 SDK 不开放 temperature，因此不展示或静默忽略该参数。默认模型名只是可编辑配置，不承诺账户具有访问权限。没有价格表时费用显示未知；Token 计数取自接口 usage。

默认 ID 依据 2026-09-23 核对的 [DeepSeek 官方接口文档](https://api-docs.deepseek.com/api/create-chat-completion/)。旧 `deepseek-chat` / `deepseek-reasoner` 已列入官方停用公告，不再预填。

Key 在本机服务端 AES-256-GCM 加密，API 不回传原文；复制继承配置和 Key。密钥文件与数据库同机保存，因此这保护磁盘文件的直接明文暴露，不防拥有该本机账号权限的人。服务仅绑定回环地址，不应直接暴露到公网。

## 已验证与边界

- 实际 DeepSeek Harness SDK，固定 `0.1.5-rc.3`，分别验证 OpenAI 兼容协议、Anthropic、取消、错误与 usage。
- 本地SSE替身只验证软件协议；2026-10-07另有真实DeepSeek调用，原始实验与失败在公开附件。模型配置selector不等于独立认证底层权重。
- 独立 Chromium 执行断言，脚本错误、无效交互和联网尝试均会失败。只有冻结断言通过才能完成；不等于任意需求已被完整验证。
- 人口来源为2020七普，503,859全龄、434,827为15+且含未成年人。年龄×性别联合是推断。旧工作台意愿公式、规则夹具和新LLM问卷分别标记；都不能当真人市场调查。

验证命令：

```bash
npm test
npm run build
npm run test:e2e
```

## 文档与原文

- [对抗性审视与本次裁决](docs/DEMO-DECISIONS.md)
- [产品范围](docs/PRODUCT.md)
- [实现架构与契约](docs/ARCHITECTURE.md)
- [交付状态与后续路线](docs/ROADMAP.md)
- [六工作包任务清单](docs/TASKS.md) / [分层验收门限](docs/EVALUATION.md) / [调查工作区与人群预设](docs/research/WORKSPACE-2026-09-24.md)
- [人口基线原表核验](docs/population/BINJIANG-EVIDENCE.md) / [2023—2025近期数据与口径冲突](docs/population/BINJIANG-RECENT.md)
- [两个研究场景的数据适用性与补采矩阵](docs/population/SCENARIO-READINESS.md)
- [验证记录](docs/VALIDATION.md)
- [原始文档留底](docs/archive/2026-09-23-before-demo/)：对应 Git 基线 `111027d`，不覆盖原文。
- [人口增强前的Demo留底](docs/archive/2026-09-23-before-population/)：README、产品/架构/路线及原city模块。

最初用户指示将 L5 提升为方向并允许工程 Demo；当前此分支专注虚拟社会调查，L4/L5由另一会话并行推进，不宣称本分支已完成 L5。真实调查已执行但10人质量门限失败，人格贡献与经营效度仍待验；现实桥MCP、长期记忆、wiki/dream和有限居民接管均为未实施规划。
