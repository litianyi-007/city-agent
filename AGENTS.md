# City Agent 自动化软件生产分支

本分支从 `submission-milestone-2026-10-07` 创建，基线 commit 为 `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466`。

## 当前工作阶段

用户最新要求是完成准备后，等待完整需求描述再正式实施。当前仅允许环境准备、只读审查、基线回归、准备文档及其提交；不实施产品功能、不发真实模型请求。收到后续完整需求与明确推进指示后再更新任务范围。

## 操作边界

- 所有操作显式使用 `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production`。不得编辑、切换或清理相邻原 `city-agent` 工作目录。
- 不迁移原目录的密钥、数据库、模型配置、运行日志或私人材料，不共享可写目录或以符号链接复用依赖。
- 本机 Node 默认版本可能为 20；基线要求 22.19+，准备阶段验证使用已安装的 22.22.3。每次命令单独设置运行环境，不更改系统默认版本。
- 回归使用 `docs/production/baseline.playwright.config.ts`，默认端口 4421，独立临时数据；不直接启动默认 4311 测试配置或固定端口开发服务。
- Worktree 不是安全沙箱；未验证隔离执行器前不得在宿主执行模型生成的 Node、shell 或依赖安装脚本。
- 真实调用需要本分支页面配置和明确预算。Hopper 登录或历史授权不替代本分支授权。
- 仅提交本分支相关文件；允许普通推送 `feature/autonomous-production`，禁止修改 main、gh-pages、冻结 Tag、旧 Release 或申报资产，禁止 force-push。
- 旧实测失败与工程夹具分开报告，不以测试通过宣称内部 Agent 自主交付成功。

准备入口为 [docs/production/README.md](docs/production/README.md)。
