# 自主软件生产启动与复现

评委在自己的设备首次安装，请优先使用 [可移植安装与自测指南](REVIEWER-GUIDE.md)，不复制下文作者机器路径。下面保留本worktree的开发复现命令；刷新前原文见 [留底](https://github.com/litianyi-007/city-agent/blob/09d83cdecd0e238d5d4d3ed0ccefe53d4185dc88/docs/production/archive/2026-10-07-before-materials-refresh/RUNBOOK.md)。同版在线入口、MP4与完整材料关系见 [申报主稿](SUBMISSION-REPORT.md)。

所有命令在 `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production` 执行。原目录不安装、不运行测试、不修改服务；新目录依赖与数据独立。默认 Node 20 不满足要求，下列命令使用已安装 Node 22.22.3，不更改系统默认配置。

## 启动

```bash
cd /Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm run build
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm start
```

构建后入口为 http://127.0.0.1:4420/#production，虚拟社会仍在 #research。这里是本机后端。公开评审入口为 https://litianyi-007.github.io/city-agent/production/，仅可信固定 Mock 交互及证据回放，不运行后端或接收 Key；原虚拟社会 Pages 入口保持不变。

开发时用 `npm run dev`，前端 http://127.0.0.1:5420/#production 代理到 4420。运行前检查下列端口占用；不要停止他方服务。

| 设置 | 默认 | 用途 |
| --- | --- | --- |
| PRODUCTION_API_PORT | 4420 | API 与构建后同源 UI |
| PRODUCTION_WEB_PORT | 5420 | Vite 开发与 API 代理 |
| PRODUCTION_PREVIEW_PORT | 4422 | Vite 构建预览与 API 代理 |
| PRODUCTION_E2E_PORT | 4421 | 独立浏览器回归 |
| PRODUCTION_DATA_DIR | .city-agent-production | 本 worktree 内独立控制面数据 |

`PORT` 仍兼容测试服务覆盖。统一配置拒绝端口冲突、worktree 外数据路径和已存在的符号链接逃逸。Playwright 每次使用本 worktree 下新建的测试目录，不复用他方服务。

## 工程验证

```bash
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm test
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm run build
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm run test:e2e
```

`docs/production/baseline.playwright.config.ts` 是同一配置的兼容入口。测试 Key 为假值；随机主密钥和测试数据库均不得发布。

## 体验步骤

1. 进入“自主软件生产”，检查六个角色预设，创建、复制或修改模型；Key 使用页面密码输入，只显示配置状态。
2. 选择三个 MOCK 之一，查看原始需求与验收，启动工程演练。
3. 查看项目经理计划、各候选与 Verifier、研发前冻结 hash、实际浏览器结果、交付与原始证据。
4. 预览只显示受控 Chromium 截图，不在用户浏览器执行模型产物；行为验证以 Gate 原记录为准。HTML 作为源码文本附件下载，下载后在其他环境运行不再受平台隔离保护。
5. 真实模型需在本分支重新填写六角色配置、币种与单价，并明确勾选预算授权。不迁移原配置，不以夹具冒充真实模型。
6. 在“决策设置”填写/轮换 Jev Key，只显示已配置状态；可清除。真实 Jev 不需要迁移六角色 Key。固定版本和费率快照，启用后可运行3组候选对照，或“Mock + 真实 Jev”管线；两者不算真实代码生成。
7. 临时 Jev Key 已在会话暴露，体验前应在供应商刷新，再从页面替换。不要放命令参数、环境文件、Prompt 或录屏；设置提交后输入立即清空。

## 尚不可运行的范围

容器执行器未验证；本批不安装系统服务、不执行生成的宿主 Node/shell。任意仓库构建、依赖安装和公共生产部署不在当前 Demo 能力内。重启只把未完成运行标为 interrupted；恢复不会自动重发付费请求。

## 材料重渲与独立公开发布

```bash
npm run production:package -- --from-package output/pdf/原冻结材料目录 --public-demo-url https://litianyi-007.github.io/city-agent/production/
npm run production:public -- --package output/pdf/新审查材料目录
npm run production:publish -- --directory output/production-public/新公开目录
# 上一条仅预检；真实发布需用户授权后显式增加 --execute。
```

离线重渲先验证原包 hash，不连接 API、不重跑模型；原运行 commit 与当前报告/发布 commit 分开登记。新 `--record` 是另一个免费 Mock 批次，不覆盖旧 ID、失败或视频。源码必须干净提交后再导出，当前源码推送后才能发布。

发布脚本只基于最新 `gh-pages` 树新增/更新 `production/` 文件，用全根子树 SHA 核对旧入口不变；不删除、不强制更新、不用旧发布脚本、不修改 main。若他方并发推进 `gh-pages` 则停止，不能强行覆盖。公网运行完整后端另需认证、秘密管理和执行隔离设计，不在静态发布授权中。
