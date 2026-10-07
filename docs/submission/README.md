# City Agent 离线申报材料（2026-10-07）

公开查看请用[最新评委入口](https://litianyi-007.github.io/city-agent/review-updates/2026-10-08/)、[历史项目PDF](https://litianyi-007.github.io/city-agent/submission-next/project-materials.pdf)及[来源/方法/视频附件](https://litianyi-007.github.io/city-agent/submission-next/)。以下 `output/` 地址是原申报准备时的本机留档，Git忽略，不能在GitHub网页取得；不是程序安装包或在线下载入口。旧离线报告保留设计预期与当时实测的独立口径，不以新工程通过更改历史结果。

本批先完成申报材料，再恢复虚拟社会主线离线修复。新产物独立成包，保留历史PDF、视频、Tag、实验原件和里程碑截止时间。

> 本次推荐提交v2：[离线入口](../../output/submission-offline/2026-10-07-offline-v2/index.html)、[13页报告](../../output/pdf/city-agent-submission-offline-2026-10-07-v2.pdf)、[完整ZIP](../../output/submission-offline/city-agent-offline-submission-2026-10-07-v2.zip)。按用户追加要求，附录改为“设计预期与可追溯验收”：以预期正确行为阐明设计目标，不当作新实测结论；实际原文和账本在独立附件保持不变。前12页与已逐页检查的v1渲染字节完全一致，第13页另作目视检查。v1保留作为本轮材料留底，不覆盖。

## 本批产物

- [按申报结构填写的brief](BRIEF-2026-10-07.md)：背景、项目介绍、五项材料、体验、视频、创新与价值。
- [离线材料入口](../../output/submission-offline/2026-10-07-offline-v1/index.html)：报告、brief、完整题库、统计、原文、画像、Prompt和MP4。
- [13页项目报告](../../output/pdf/city-agent-submission-offline-2026-10-07.pdf)：突出五层可解释人群与完整问卷/结果自证。
- [新实际浏览器录屏](../../output/submission-offline/2026-10-07-offline-v1/video/demo.mp4)：4分25.96秒、1600×1000，无音轨，讲解显示在画面。
- [可复制纯文本简介](../../output/submission-offline/2026-10-07-offline-v1/brief.txt)。
- [全包84项payload清单](../../output/submission-offline/2026-10-07-offline-v1/manifest.json)及独立QA：70源文件不变、20本地链接有效、断网MP4实际播放、375px无横向溢出。

## 证据组织

1. 真实历史基准：AI会员12人×15题，12真实API调用，180完整回答；只声明结构和登记的街道/年龄两条规则。
2. 五层工程仿真：小学照护者17题、宠物零食18题各12记录，24答卷、420题目槽位，0模型调用。
3. 真实探索附录：完整保留20计划、5请求、3联合通过、15未启动及原始诊断；各组版本不混算。
4. 官方人口原件与科学方法：4份政府PDF、12条方法/背景来源、13条地区背景观测；统计事实、联合推断、情景假设和生成回答分层。

主报告与brief采取正面呈现，保留研究预演和现实校准的明确分工。真实基准画像直接从live-run提取，不引用属于fixture的sample-profiles。现实桥MCP、版本化记忆、wiki/dream和有限自主性作为延展设计分栏。

## 复核与再生成

PDF已逐页渲染目视检查。文件哈希只验证字节一致性，不认证现实真值、供应商账单或画像效度。生成时仓库HEAD与生成脚本指纹分别登记，避免把未提交的文案/脚本说成固定Tag源码。

新脚本：`scripts/prepare-offline-submission.ts`、`scripts/verify-offline-submission.ts`、`scripts/record-offline-submission.ts`。固定v1输出采用防覆盖创建；再次准备须显式另立版本，不能重写本次产物。录屏失败尝试另目录留存，不加入交付ZIP。

本批未启动付费API、不读取Key/私数据库、不修改旧原件、不自动提交比赛。新包为离线交付，在线入口引用已经可访问的Demo、GitHub及历史详细材料；公开发布采用独立后续版本。
