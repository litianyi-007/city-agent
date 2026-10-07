# 自主软件生产启动与复现

所有命令在 `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production` 执行。原目录不安装、不运行测试、不修改服务；新目录依赖与数据独立。默认 Node 20 不满足要求，下列命令使用已安装 Node 22.22.3，不更改系统默认配置。

## 启动

```bash
cd /Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm run build
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm start
```

构建后入口为 http://127.0.0.1:4420/#production，虚拟社会仍在 #research。这里是本机后端，不是旧 GitHub Pages 服务；未授权外部部署。

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
4. 预览在受限 iframe 中打开，源文件和 manifest 可单独获取；关闭预览会卸载 iframe。
5. 真实模型需在本分支重新填写六角色配置、币种与单价，并明确勾选预算授权。不迁移原配置，不以夹具冒充真实模型。
6. 在“决策设置”填写/轮换 Jev Key，只显示已配置状态；可清除。真实 Jev 不需要迁移六角色 Key。固定版本和费率快照，启用后可运行3组候选对照，或“Mock + 真实 Jev”管线；两者不算真实代码生成。
7. 临时 Jev Key 已在会话暴露，体验前应在供应商刷新，再从页面替换。不要放命令参数、环境文件、Prompt 或录屏；设置提交后输入立即清空。

## 尚不可运行的范围

容器执行器未验证；本批不安装系统服务、不执行生成的宿主 Node/shell。任意仓库构建、依赖安装和公共生产部署不在当前 Demo 能力内。重启只把未完成运行标为 interrupted；恢复不会自动重发付费请求。
