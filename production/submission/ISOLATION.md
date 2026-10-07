# 两条线隔离核对 · 2026-10-07

| 研发线 | 工作目录 | 分支 | 服务/测试 |
| --- | --- | --- | --- |
| 自动化生产（本会话） | `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production` | `feature/autonomous-production` | API 4420，WEB 5420，预览 4422，E2E 4421 |
| 虚拟社会（另一会话） | `/Users/litianyi/Documents/Code/_ai-goods/city-agent-virtual-society` | `feature/virtual-society-next` | 核对时服务 4321，由另一会话管理 |
| 历史原目录 | `/Users/litianyi/Documents/Code/_ai-goods/city-agent` | `main` | 本会话只读，不处理历史未提交内容 |

本生产分支从冻结基线 `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466` 创建，该基线仍为 HEAD 祖先；冻结 annotated Tag 的 peeled commit 一致。原目录 main 的历史未提交内容保留。

每条命令显式 workdir；编辑用新目录绝对路径。依赖、数据、加密主密钥、日志、产物和浏览器测试目录独立，不通过符号链接共享可写目录。配置拒绝数据目录越出本 worktree；启动先核端口占用，不复用或关闭主线服务。

三个开发 Agent 均已确认编辑范围仅为生产 worktree。main 操作、跨线自动合并、移动 Tag、改写共享历史、force-push 均禁止。2026-10-07 用户另行授权仅发布 `gh-pages:production/` 独立子树：保存原根 index/assets/submission 树 SHA，基于最新根树正常提交，只包含 production/ 变更，发生并发推进停止，发布后核对原树 SHA。不执行旧 publish-source/publish-pages，不修改旧公开资料。

Git worktree 共享对象与 refs，并非安全沙箱；共享契约只能通过独立提交供另一会话审查后 cherry-pick，不自动移到其 worktree。公开 Pages 子树与本机数据/密钥完全分离，只包含人工审核、hash 验证且秘密扫描通过的白名单材料。
