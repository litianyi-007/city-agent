# City Agent

以四角色团队完成有界自主研发的本地 demo。先配置 Agent 的角色和模型，再提交任务，观察需求拆解、研究、实现、独立验收和自动返修，最后打开交付页面。

**当前可交付：离线单页 HTML/CSS/JavaScript 应用。首个场景：杭州滨江人口结构下的商品调研预演。** 尚不支持任意代码仓库、后端服务、生产部署或真实市场预测。

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

## 使用

1. “智能体团队”支持新增、编辑、启停、复制和删除。角色固定为产品、研发、测试、研究员；每位 Agent 单独配置 provider、base URL、model ID、API Key。
2. “任务工作台”每个角色选择一名 Agent，输入需求与商品、价格、样本量、seed。
3. **流程演示**无需 Key，使用确定性计划、规则模拟和页面模板，但仍执行真实 Chromium 验收。它不构成 LLM 自主开发证据。
4. **真实模型**通过 DeepSeek Harness SDK 实际请求四个角色的模型。测试断言在研发前冻结；失败最多自动返修两次。无需中途人工确认。
5. 查看执行日志、角色产出、调研结果和交付产物。HTML 可预览，JSON 可下载；运行记录在刷新、重启后保留。

## 模型连接

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
- [原始文档留底](docs/archive/2026-09-23-before-demo/)：对应 Git 基线 `111027d`，不覆盖原文。

本轮用户指示将 L5 提升为核心方向，覆盖旧文档“等待评审、不开始实现”和“研发角色不得执行”的限制。统计评审作为有效性改进继续保留，不再阻塞工程 demo。
