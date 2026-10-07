# 六角色自主软件生产工作区

当前评审材料v3：[完整离线申报主稿](SUBMISSION-REPORT.md)、[评委独立安装/自测指南](REVIEWER-GUIDE.md)、[材料对抗审查](REVIEW-MATERIALS-2026-10-07.md)。在线最新入口仍为 production/；正式提交用导出清单给出的 reviews/<完整报告commit>/ 版本入口，同版MP4、PDF、MD、原始证据与ZIP。旧公开submission文件保留不覆盖。

发布状态：v3先交付MD与指南，配套PDF/MP4/ZIP和版本在线页尚待生成/部署；当前公开production页是旧版Mock/WebM。以下旧阶段入口描述需按其版本解读，不代表新版已经发布。

[CAMERA-04结果](CAMERA-04-RESULT.md)：11次真实请求，验收Verifier结构拒绝，完整交付失败。四次真实调优均未完整通过，不用三个Mock替代。此前“本批不发布”是该实验启动时边界；用户随后优先要求材料与在线录屏，按独立材料修订执行。入口刷新前全文 [留底](archive/2026-10-07-before-materials-refresh/README.md)。

本线已进入第一批实施：产品经理、项目经理、研究员、研发、测试与 Verifier 共同执行有界软件生产。首批采用离线单 HTML 和受限 Chromium Gate，不执行生成的宿主脚本，不新增虚拟社会能力。用户允许自拟三个模拟需求；真实业务需求条款与官方 L4 认证不在本批完成范围内。

## 工作边界

工作目录为 `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production`，分支为 `feature/autonomous-production`，冻结基线为 `submission-milestone-2026-10-07` / `b66122c21604fdb2ecdcbafb89c3d5ad8cde1466`。相邻原目录、main、冻结 Tag 和旧申报材料均不修改。用户授权本轮仅发布独立 Pages `production/` 子树，原虚拟社会根入口、assets 和 submission 保持不变。

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

## 评审入口与结论

公开评审 Demo：[可信 Mock 交互与证据](https://litianyi-007.github.io/city-agent/production/)；[申报 PDF](https://litianyi-007.github.io/city-agent/production/submission/production-mock-submission.pdf)。它是静态回放，不运行 Harness 后端、不接收 Key、不执行新的生产任务。真实六角色任务必须按 RUNBOOK 在本机配置。部署需经独立脚本、秘密扫描、文件 hash 及原根树 SHA 核对，不以源码推送等同已部署。

[评委对抗审查](JUDGE-AUDIT-2026-10-07.md)记录致命疑问、复现、修复与仍缺的证据。旧生成代码 iframe 已关闭，当前预览只显示受控截图，下载源码后不受平台隔离保护。公开交互只允许运行逐字验证的平台可信夹具，不是任意生成代码的安全沙箱。

三项自拟 Mock 与真实 Jev 决策不能证明内部 Agent 已自主研发交付，也未满足“至少三项真实业务需求”；本材料是阶段性技术自证，不是 L4 达标声明。

托管 TypeSafe Jev 的设置与决策已接入本线；AnyJev 本地 SDK 则仍是后续方向，不能混称。用于其他研发线复用的兼容 Harness 用量/精确 Gate 改动独立提交为 `d62b857`，只供审查后 cherry-pick，本会话不跨线合并。

本阶段工程通过仅证明管线可运行。只有内部真实模型完成目标并通过冻结 Gate，才登记真实自主交付成功。模拟需求仍可用于真实模型实验，但不能因此变为真实业务需求。

## 新增受控摄像头场景测试

2026-10-07 上一批（CAMERA-03）：[共享全局返修契约](GLOBAL-REPAIR-CONTRACT.md)、[CAMERA-03 预登记](CAMERA-03-PREGISTRATION.md) 与 [实测结果/下一批任务](CAMERA-03-RESULT.md)。生成前纠错和研发返修共用最多两次，不修改冻结 Gate；旧 CAMERA-01/02 负结果保留。本次真实模型在反馈后自主修正产品JSON结构，随后因Jev协议不一致失败，无研发或圣诞树场景交付。[独立协议审查](JEV-PROTOCOL-AUDIT-CAMERA-03.md) 保留异常原文，没有放宽门限。本节更新前的入口文档已在 [留底](archive/2026-10-07-before-global-repair/README.md) 保存。

在本地生产页面选择 `camera-scene-v1`，内部角色生成严格 JSON 场景，平台可信运行时负责本机相机/识别/渲染，不执行模型脚本。先按 [本地资产说明](CAMERA-ASSETS.md) 准备固定模型，再从页面输入需求。

[规格](../prd/FP001-camera-scene.md) 与 [第一轮实验](CAMERA-EXPERIMENT.md) 分别描述冻结验收和实测。合成场景 Gate、假摄像头 SDK 集成、真实视觉与实体设备验收分列；前两项通过不代表完整摄像头需求交付。旧“仅截图”的描述仍适用于任意模型生成 HTML，不能借此新能力恢复旧不安全 iframe。

## 当前批次：Jev v3 与实际输出契约

[设计与安全边界](JEV-RESILIENCE-V3-DESIGN.md)、[CAMERA-04 预登记](CAMERA-04-PREGISTRATION.md)、[免费回归/独立审查](BATCH-CAMERA04-CHECKS.md)。本配置不重写旧失败；Jev 派生算术异常只能弃用决策、在原预算内进行一次独立 LLM 复核，不能变为 Jev 通过。角色及 Verifier 使用实际 schema 导出的输出契约，语义和最终行为 Gate 仍独立执行。

本段更新前全文已按 `20f61eb` [留底](archive/2026-10-07-before-jev-v3/README.md)。本批仅推送生产源码分支，不重新发布 Pages/PDF；公开入口仍是旧阶段静态回放，不能用来运行本地 CAMERA-04。
