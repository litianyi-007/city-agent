# City Agent 自动化软件生产分支

本分支从 `submission-milestone-2026-10-07` 创建，基线 commit 为 `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466`。

## 当前工作阶段

用户已提供完整方向，第一批实施六角色、有界反馈闭环、受限 HTML 交付、LLM-as-a-Verifier 候选验证，以及必须实施的托管 Jev 快速决策层。用户授权三项自拟 MOCK 和高性价比真实请求；首批内部估算上限每项 5 USD、总计 15 USD。没有真实业务需求或正式 L4 标准，材料必须明示，不用预测代替实测。临时 Jev 凭据只经受控输入写入本分支加密设置，禁止回显、文件明文、Prompt、Git、日志或材料；前端支持轮换/清除，用户醒后轮换。

准备阶段原文留底见 `docs/production/archive/AGENTS-preparation.md`。历史基线、旧失败证据和申报资产保持不变。

## 操作边界

- 所有操作显式使用 `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production`（`feature/autonomous-production`）。不得编辑、切换或清理相邻原 `city-agent`，或 `city-agent-virtual-society`（`feature/virtual-society-next`）；该主线在并行执行。共享 Git refs 不等于共享工作目录，禁止移动他方分支/Tag。
- 本线 API/WEB/预览/E2E 默认 4420/5420/4422/4421；虚拟社会当前 4321 服务不得停止。服务/测试先检查端口，独立数据与依赖，所有命令显式 workdir。
- 不迁移原目录的密钥、数据库、模型配置、运行日志或私人材料，不共享可写目录或以符号链接复用依赖。
- 本机 Node 默认版本可能为 20；基线要求 22.19+，准备阶段验证使用已安装的 22.22.3。每次命令单独设置运行环境，不更改系统默认版本。
- 回归使用 `docs/production/baseline.playwright.config.ts`，默认端口 4421，独立临时数据；不直接启动默认 4311 测试配置或固定端口开发服务。
- Worktree 不是安全沙箱；未验证隔离执行器前不得在宿主执行模型生成的 Node、shell 或依赖安装脚本。
- 用户本轮已允许高性价比真实调用；首批采用每项 5 USD、合计 15 USD 的内部估算上限，仍需本分支页面新配置与单价。Hopper 登录或历史配置不替代新配置，不无限重试。
- 仅提交本分支相关文件；允许普通推送 `feature/autonomous-production`，禁止修改 main、gh-pages、冻结 Tag、旧 Release 或申报资产，禁止 force-push。
- 旧实测失败与工程夹具分开报告，不以测试通过宣称内部 Agent 自主交付成功。

工作入口为 [docs/production/README.md](docs/production/README.md)。
