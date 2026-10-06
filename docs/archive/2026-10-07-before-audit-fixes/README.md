# City Agent

公开问卷 Demo：**https://litianyi-007.github.io/city-agent/** · [申报材料](https://litianyi-007.github.io/city-agent/submission/index.html) · [4分钟录屏](https://litianyi-007.github.io/city-agent/submission/demo.mp4)。

外网版在“人群 Agent 预设”页面填写 Key，仅保留本次会话，刷新后需重填；支持问卷仿真与证据导出。GitHub Pages不托管四角色Harness后端，本机版继续保留。当前附带答卷是工程演示；真实模型实测与真人市场校准未完成。[部署、验收与边界](docs/research/PAGES-SUBMISSION-2026-10-07.md)。

以四角色团队完成有界自主研发的本地 demo。先配置 Agent 的角色和模型，再提交任务，观察需求拆解、研究、实现、独立验收和自动返修，最后打开交付页面。

**当前可交付：离线单页 HTML/CSS/JavaScript 应用。首个场景：杭州滨江人口结构下的商品调研预演。** 尚不支持任意代码仓库、后端服务、生产部署或真实市场预测。

另一个核心交付是**可追溯人口底座**：官方原件与发布页存档、逐格事实、数据包校验、显式联合分布推断，以及可复用的新区域录入流程。

## 启动

Node.js 22.19+（已验证 22.22.3），首次安装：

```bash
npm ci
npm run setup
npm run build
npm start
```

打开 **http://127.0.0.1:4310**。

开发模式：`npm run dev`，前端 http://127.0.0.1:5173，API 4310。运行数据保存在被 Git 忽略的 `.city-agent/`；可用 `CITY_AGENT_DATA_DIR` 指定其他目录，`PORT` 修改生产端口。同一数据目录只允许一个服务进程。

## 本机版使用

1. “智能体团队”支持新增、编辑、启停、复制和删除。角色固定为产品、研发、测试、研究员；每位 Agent 单独配置 provider、base URL、model ID、API Key。
2. “任务工作台”每个角色选择一名 Agent，输入需求与商品、价格、样本量、seed。
3. **流程演示**无需 Key，使用确定性计划、规则模拟和页面模板，但仍执行真实 Chromium 验收。它不构成 LLM 自主开发证据。
4. **真实模型**通过 DeepSeek Harness SDK 实际请求四个角色的模型。测试断言在研发前冻结；失败最多自动返修两次。无需中途人工确认。
5. 查看执行日志、角色产出、调研结果和交付产物。HTML 可预览，JSON 可下载；运行记录在刷新、重启后保留。
6. “城市与样本”可查看2020三街道结构与2023—2025区级常住总量，追溯逻辑人口到原表、下载原件与数据包、上传新区域JSON预检。新年份总量不自动替换旧结构；预检不自动激活数据包。
7. 一键选择“小学生零食店”或“宠物零食网点”验收例子。流程会交付条件研究页面、数据缺口与假设；商业决策保持 `needs-data`，不将通用15+规则接受率套到学生或养宠人群。
8. “虚拟社会调查”（`/#research`）是独立的新问卷入口：从三模板或空白调查开始，编辑五类题型、导入/导出问卷 JSON、选择人群预设、检查资格与证据缺口，并保存本机草稿。它尚未接居民执行器，不能从这里生成答卷或沿用旧规则仿真冒充完成。
9. 调查页内“人群 Agent 预设”（`/#residents`）提供一般成年居民、小学生照护者、养猫家庭购买者、养犬家庭购买者，可新增、自定义、编辑、复制、启停和删除。独立配置模型与 Key；与研发四角色不混用，预设不是实际居民记录，也不预填商品偏好。

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
- 本地 SSE 模型替身用于验证协议与编排；尚未使用用户真实供应商凭证证明模型质量和真实任务成功率。
- 独立 Chromium 执行断言，脚本错误、无效交互和联网尝试均会失败。只有冻结断言通过才能完成；不等于任意需求已被完整验证。
- 人口来源为 2020 七普官方年鉴，503,859 为全龄总体，434,827 为 15+ 调研框。年龄×性别联合结构是推断；意愿和回答是未校准的确定性规则模拟，未调用 LLM 居民，也不是真人市场调查。

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

本轮用户指示将 L5 提升为核心方向，覆盖旧文档“等待评审、不开始实现”和“研发角色不得执行”的限制。统计评审作为有效性改进继续保留，不再阻塞工程 demo。
