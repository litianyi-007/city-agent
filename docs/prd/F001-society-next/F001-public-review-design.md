# F001：2026-10-08独立评委体验发布设计

用户已明确授权自主完成既定任务、提交部署GitHub。本批仍在 `feature/virtual-society-next`，不合并main、不移动旧Tag、不修改另一会话L4/L5。新增固定Tag拟定 `society-responses-review-2026-10-08-rc3`；只有提交、推送、Pages及公网验证完成后才登记已发布。

## 评委体验范围

三个明确入口：无Key检查来源/五层画像/两场景完整规则工程流程与导出；页面自备Key进行浏览器直连（不是Harness）；固定Tag下载后本机Harness执行。新诊断及typed unknown保留原证据，不把未知改偏好。Responses为有界实验候选，不静默替换旧API/UI。新实网记录、兼容性回放及历史调查分层呈现，不能互相升级。

## 公开材料与安全发布

- 新增独立 `review-updates/2026-10-08/`，只发布审查后的index、README和精简status；原始SSE、授权/私有账本、Key、DB、工作区绝对路径和内部链接均排除。
- status必须与独立全量离线报告的真实计数、源码hash、历史核验，以及已闭合的真实实验报告一致。回放明确posthoc；实网失败不能被改成成功，费用未知不能写零。新的独立真实结果若出现，另增记录而非覆写旧run。
- 新发布器只允许固定feature分支和Pages现有gh-pages配置、登记的离线proof路径、显式--execute。默认只做dry-run，不读取任何Key/DB，不解密或自动接入供应商。
- 构建白名单只选index/review-guide/hashed assets；独立补充材料只选上述三文件。旧submission/submission-next/submission-contract11、旧资源和其他已有远端文件全部保留。每个已有文件先hash；仅index/review-guide允许更新且须先原字节归档；其余已有hash资源若同名不同字节则拒绝。
- 隔离临时目录clone gh-pages，先核验配置及历史、复制/校验、明确清单git add和普通fast-forward push；不删除远端文件，不force，不改仓库设置。原source发布脚本会开私库和推main，明确不使用。
- 源码只stage经过审查的实施清单；排除新archive、output、私有目录和未知用户改动。提交前审staged diff与文件分类；源码新固定Tag发布后提供GitHub release/安装说明，不将材料ZIP当安装包。

## 验收门

1. 新发布契约纯fixture正反例、类型、全套单测/浏览器/Responses/Pages构建；源码/179历史起止一致。
2. 原始实网记录不可变；新付费复验单独预算与冻结计划、任何首异常停；后续同类小额授权不等于旧账本resume或扩大cohort。
3. 评委指南/入口/任务状态统一最新版本，历史视频/PDF明确日期；浏览器路径明确费用确认与不具备CLI预算硬门的边界。
4. deploy前独立安全/评委复审；deploy后HTTP200、页面无错误、无自动供应商请求、两场景零费用运行/导出/刷新、390px布局及发布载荷逐字节/hash实查。

源安装新增同机新目录验证，不宣称Windows/Linux或评委电脑实测。公开部署和工程通过不等于现实市场效度或五层人格贡献已验证。
