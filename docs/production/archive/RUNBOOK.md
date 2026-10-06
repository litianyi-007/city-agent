# 自动化软件生产环境操作

以下命令用于本分支准备回归。执行目录必须为 `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production`，不得在原 `city-agent` 目录安装、测试或启动服务。每次工具调用显式指定 workdir；终端 cd 不会自动改变会话后续默认目录。

## Node 与依赖

项目要求 Node 22.19+；本机默认 shell 为 20.15.0，准备回归实际使用已安装的 22.22.3，不改系统默认配置。

```bash
cd /Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" node --version
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm ci --ignore-scripts --no-audit --no-fund
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm test
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" npm run build
```

依赖使用独立 node_modules，不共享原目录可写依赖。npm 内容缓存和已安装 Node 属于工具资产，不包含迁移的项目运行数据或密钥。本轮没有升级 package.json 或锁文件。

## 浏览器回归

准备测试配置保留基线五个浏览器场景，单独设置 testDir、baseURL、webServer cwd、数据和产物目录，不改变产品运行时。

```bash
env PATH="/Users/litianyi/.nvm/versions/node/v22.22.3/bin:$PATH" node node_modules/@playwright/test/cli.js test --config=docs/production/baseline.playwright.config.ts
```

默认端口 4421；重跑前检查占用，不停止其他进程。如果已占用，在同一命令环境设置一个已检查的 `PRODUCTION_E2E_PORT`。`reuseExistingServer:false` 禁止偷偷接入他方服务。每次创建新 worktree 内的唯一 `.city-agent-preparation-*` 目录，保存独立 SQLite、随机加密主密钥及测试结果，不从原目录复制配置。

准备回归使用本机已可用的 Playwright Chromium，没有新安装系统服务。数据目录可能包含测试用假 Key 和随机加密主密钥，不得提交或发布；对应目录已被基线 `.gitignore` 忽略。

## 后续端口约定

| 用途 | 候选端口 | 当前状态 |
| --- | --- | --- |
| 本分支 API 与构建后同源页面 | 4420 | 基线已支持 PORT 覆盖；本轮未保持服务运行 |
| 准备浏览器回归 | 4421 | 本轮实际使用并通过，服务已结束 |
| 本分支 Vite 开发 | 5273 | 仅预留；代理和 Origin 白名单尚待统一修改 |
| 本分支预览 | 4273 | 仅预留；启动及 Origin 规则待需求后定稿 |

端口检查只证明检查时未占用，不是永久预约。基线 Vite 仍固定 5173/代理4310，API 还允许旧开发 Origin 5173/4173，默认 Playwright 仍为4311；不要直接用旧 npm run dev 或 npm run test:e2e 代替本线隔离配置。

后续服务数据拟使用新目录内独立 `.city-agent-production/`，由服务生成本分支密钥与空配置。目录名是约定，当前未迁移 Key、未启动真实生产任务。

## 代码执行环境

准备时 PATH 中未发现 docker、podman 或 colima 命令，未验证任何容器执行器。不能据此断言整台机器不存在其他隔离方案，也不能声称任意代码沙箱就绪。本轮不安装或启用系统服务。

新增生成代码的 Node/shell 执行前，先明确环境、权限和隔离门限；缺少安全执行条件则拒绝该范围。现有 Harness 主机工具仍禁用。

## 当前停止条件

本轮准备结束后等待完整需求。不启动模型实验、Hopper 付费评审、任务执行或公开发布。新分支页面配置和整批预算在真实运行前单独确认；原目录配置不会自动生效。
