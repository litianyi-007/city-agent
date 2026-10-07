# 六角色自主软件生产工作区

本线已进入第一批实施：产品经理、项目经理、研究员、研发、测试与 Verifier 共同执行有界软件生产。首批采用离线单 HTML 和受限 Chromium Gate，不执行生成的宿主脚本，不新增虚拟社会能力。用户允许自拟三个模拟需求；真实业务需求条款与官方 L4 认证不在本批完成范围内。

## 工作边界

工作目录为 `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production`，分支为 `feature/autonomous-production`，冻结基线为 `submission-milestone-2026-10-07` / `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466`。相邻原目录、main、Pages 和旧申报材料均不修改。

Key 在新页面重新填写，不迁移原配置。生产 Agent 使用独立六角色契约；既有四角色与虚拟社会入口保留。原始准备文档在 [archive](archive/README.md) 留底，旧实验仍是六次不同工程配置下的失败尝试。

## 设计与验收

- [设计](DESIGN.md)：职责、项目经理闭环、Verifier 与 AnyJev 的实施边界。
- [验收](EVALUATION.md)：冻结标准、反例、取消、预算和证据口径。
- [任务](NEXT-STEPS.md)：当前切片与容器、真实模型、稳定性后续工作。
- [需求](REQUIREMENTS.md)：三项模拟案例与真实需求差距。
- [启动](RUNBOOK.md)：独立端口、数据及回归命令。
- [申报栏目](SUBMISSION.md)：七项材料索引；实测、预测与计划分开。
- [隔离核对](ISOLATION.md)：并行分支/worktree、主线服务与共享 Git refs 边界。
- [工程验证](VALIDATION.md)与[真实实验账本](EXPERIMENTS.md)：包括失败、弃权、用量和未完成项。

托管 TypeSafe Jev 的设置与决策已接入本线；AnyJev 本地 SDK 则仍是后续方向，不能混称。用于其他研发线复用的兼容 Harness 用量/精确 Gate 改动独立提交为 `d62b857`，只供审查后 cherry-pick，本会话不跨线合并。

本阶段工程通过仅证明管线可运行。只有内部真实模型完成目标并通过冻结 Gate，才登记真实自主交付成功。模拟需求仍可用于真实模型实验，但不能因此变为真实业务需求。
