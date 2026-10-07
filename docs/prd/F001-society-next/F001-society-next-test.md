# F001 工程验证记录（历史记录）

> 历史阶段公开副本：主体记录2026-10-07的188单测/14浏览器及五层初批工程阶段，不代表最新发布或实测状态。原文已完整留底于Git忽略的`output/review-drafts/pre-source-publication/`，这里只移除个人本机路径并明确时间范围，不回写答卷、旧评分或费用。后续真实API调查与当前发布状态见[本轮真实测试与发布审查](../../research/LIVE-REVIEW-2026-10-07.md)；合成居民不是真人研究。

日期：2026-10-07。macOS arm64、Node22.22.3；独立worktree `city-agent-virtual-society`，基线Tag `submission-milestone-2026-10-07`。本批改动尚未用户验收/新commit/公开发布，不能把工程通过记成项目总体完成。

## 本历史阶段最终已运行结果

| 检查 | 实际结果 | 能证明 / 不证明 |
| --- | --- | --- |
| Node22 `npm ci` | 608 packages，审计609，命令时0已知漏洞 | 本机依赖安装；不是长期无漏洞或跨OS安装保证 |
| 全部单测 | 188/188，通过，0失败/跳过；最终TAP耗时14,751.278ms | 契约/预检/执行/账本/兼容性及工程负例；不是真实模型质量 |
| `npm run build` | TypeScript与Vite成功 | 当前源码本机构建；不是四角色自主交付成功 |
| `npm run build:pages` | TypeScript与Pages构建成功 | 可生成静态版本；未发布，也未验证真实供应商CORS |
| Chromium完整回归 | 14/14，通过，30.0s；单worker，独立API4321 | 真实页面/本机CRUD/历史恢复/规则流程与stub候选；无外部LLM |
| dist-pages真实静态冒烟 | 独立4182、375px，无溢出/错误；旧live2.0和新fixture2.1导入导出一致 | Pages人群保存刷新复制、业务预检/规划限制、指南200；0新模型/外网请求，仍不证明供应商CORS |
| 只读doctor | ready=true，exit0，8项pass | Node/同版SDK+dsh/SQLite/dist/Chromium文件/端口/目录前提；不验Key/模型权限 |
| `start:review`实际启动 | 本机4320；health与review-guide均200 | 启动流程、专用数据目录、真实静态服务；0模型启动 |
| 旧真实附件导入复算 | 2.0版本、12/12、live、运行ID不变 | 新解析器兼容原Prompt/统计；不能转为新五层实测 |
| 新自证manifest | 5份附件原字节数及SHA-256匹配 | 文件一致/可回查；不认证真人或外部供应商 |
| 差异保护 | public/submission、data/population、package-lock不改 | 旧材料/数据/精确依赖未覆写；另一分支不在本线编辑范围 |

构建仍有Zod PURE注释和Pages模块static/dynamic import提示，均非失败；本批不以升级依赖来消除提示。Node SQLite实验性提示保留。

## 原始工程日志与复现命令

本机历史日志的仓库根目录相对位置（Git忽略，非公开下载链接）：

- `output/f001-final-unit-20261007.tap`
- `output/f001-final-browser-20261007.json`
- `output/ui-validation/`
- `output/ui-validation/pages-next-summary.json`

最终TAP由Node测试运行器直接生成，非人工重写；Playwright JSON由真实回归生成。报告与截图被Git忽略，未公开。通常在本分支Node22环境复现：

```bash
npm ci
npm run setup
npm test
npm run build
npm run build:pages
npm run test:e2e
npm run doctor
npm run start:review
```

setup显式下载浏览器；doctor不安装或调用模型。4320常驻review占用后，doctor的默认端口检查应失败，这是正确行为；测试用4321，不复用review服务。

静态Pages可用 `npx tsx scripts/verify-pages-next.ts` 对已经生成的dist-pages复现工程冒烟；脚本严格阻断其他网络/API，不使用用户数据库或Key。验证后关闭browser/4182，并确认端口释放；不执行公开发布。新脚本纳入TypeScript检查，`tsc --noEmit`再次通过。

## 重要正向与反例

- 规划契约/API：Key与角色、显式费用确认、AND人群资格、区域/时期/单位冻结、并发与取消、无重试、raw/Prompt/usage缺失；本地HTTP模拟供应商使用真实Harness，不认证真实模型身份。
- 业务证据15项：空模板、NULL目标分母、重复ID、引用/循环、来源缺hash/许可、地域/边界/时期/单位冲突、过期、人工核验和不自动推荐/发布。
- 五层7项：unknown默认、严格Big Five整数、DNA/fact/verified字段拒绝、多阶段成长共存、居住互斥与异地照护、收入币种/口径/上下界、旧预设不回填、CRUD/复制重启与Prompt消融。
- 自证5项：完整16题、四预设/Prompt血缘、确定性、fixture不使用persona推消费、30规则不升级真实门限、非法persona即使重算hash也拒绝。
- 离线边缘9项：固定分母、自报注册标识、负数/NaN/未知usage与费用、Token总账、五层预设血缘、合成身份唯一性、配置冻结、币种明确CNY；耗时也必须有限非负。
- 安全专项：literal/JSON/混合Unicode/对象键/partial/错误/取消、仅选中knownKey；真实SDK对本机SSE验证header正确而Prompt/证据脱敏。执行器只保留Token字段，不展开未脱敏返回text；问卷/画像误粘已知Key在checkpoint和调用前拒绝，API同步拒绝而无幽灵run。
- 浏览器14项：人口原件与完整性阻断、两个mock开店流程保留needs-data、规划显式应用/迟到/取消、业务预检不发模型、指南200、问卷恢复、五层真实CRUD/复制、无效配置不保存、375/390px无溢出、已有工作台兼容。

## 已发现并修复的失败，不删证据

独立审查补出了usage/result展开旁路、encoded Key漏检、负数/NaN/费用unknown填零、错误币种、五层画像与预设不一致、模型参数可换、falsy persona绕过schema等问题，已添加对应反例并修复。中途Response stub和optional state TypeScript错误也修复后重建；最终两构建退出0。

新12×16夹具的两份“不买却非零预算”答卷**没有修成通过**：原始生成数据不改，原统计仍12/12结构有效，语义反例与缺规则写入材料。现版没有语义盲评、完整unknown/资格跳题、真实人格贡献或外部市场校准。

## 仍未验收的门限

真实30人唯一cohort至少29/30、职业/家庭/采购跨题语义、五次重测/措辞/顺序/异构模型/公平消融、真人或交易留出、真实供应商CORS、Windows/Linux干净机安装均未完成。本批新增真实模型请求、供应商Token和API费用为0；工程测试中的本地模拟回包不计入它们。旧49次实验及六次四角色终验失败保留，不据工程green改写。

下一确认按[本批交接](../../research/NEXT-BATCH-REPORT-2026-10-07.md)和[评测预登记](../../research/EVALUATION-NEXT.md)。
