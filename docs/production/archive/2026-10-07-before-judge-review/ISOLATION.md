# 两条线隔离核对 · 2026-10-07

| 研发线 | 工作目录 | 分支 | 服务/测试 |
| --- | --- | --- | --- |
| 自动化生产（本会话） | `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production` | `feature/autonomous-production` | API 4420，WEB 5420，预览 4422，E2E 4421 |
| 虚拟社会（另一会话） | `/Users/litianyi/Documents/Code/_ai-goods/city-agent-virtual-society` | `feature/virtual-society-next` | 核对时服务 4321，由另一会话管理 |
| 历史原目录 | `/Users/litianyi/Documents/Code/_ai-goods/city-agent` | `main` | 本会话只读，不处理历史未提交内容 |

本生产分支从冻结基线 `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466` 创建，该基线仍为 HEAD 祖先；冻结 annotated Tag 的 peeled commit 一致。原目录 main 的历史未提交内容保留。

每条命令显式 workdir；编辑用新目录绝对路径。依赖、数据、加密主密钥、日志、产物和浏览器测试目录独立，不通过符号链接共享可写目录。配置拒绝数据目录越出本 worktree；启动先核端口占用，不复用或关闭主线服务。

三个开发 Agent 均已确认编辑范围仅为生产 worktree。所有发布、main/gh-pages 操作、跨线自动合并、移动 Tag、改写共享历史、force-push 均禁止。Git worktree 共享对象与 refs，并非安全沙箱；共享契约只能通过独立提交供另一会话人工审查后 cherry-pick。
