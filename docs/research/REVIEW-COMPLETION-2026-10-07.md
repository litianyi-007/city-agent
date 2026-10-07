# 虚拟社会主线：评审补齐与申报候选交接（历史记录）

> 历史阶段公开副本：主体记录2026-10-07的239单测/19浏览器、0新增API的申报候选准备阶段，不代表最新发布或实测状态。原文已完整留底于Git忽略的`output/review-drafts/pre-source-publication/`，这里只移除个人本机路径并明确时间范围，不回写答卷、旧评分或费用。后续真实API调查与当前发布状态见[本轮真实测试与发布审查](LIVE-REVIEW-2026-10-07.md)；合成居民不是真人研究。

日期：2026-10-07。工作树名：`city-agent-virtual-society`，分支：`feature/virtual-society-next`。本报告记录旧里程碑之后的补齐工作，不重定原申报截止时间，不把本地候选称为已发布/已提交。

当前公开材料目标入口为[新版评审材料](https://litianyi-007.github.io/city-agent/submission-next/index.html)，新增真实轮另册见[报告](https://litianyi-007.github.io/city-agent/submission-next/live-proof/report.md)。下列PDF/ZIP/日志定位均属于此前候选，不能当作当前固定Tag或公网部署回执。

## 历史阶段结论

这一批工程与申报候选已准备：五层人群方法、两个完整业务问卷、逐人原文与冻结规则、来源与成本说明、15页PDF、4分33秒实际浏览器录像，以及材料/源码ZIP。最终统一工程复验239项单测、19项浏览器测试通过；本地/Pages两种构建通过。

以上证明可配置、可执行规则仿真、可追溯、可导出与复现，不证明真实消费者偏好、五层人格行为贡献或开店商业效度。新增真实模型请求、Token与API费用均为0；历史真实实验单独列账，未混入24个新夹具实例。

新候选生成于 `2026-10-07T10:13:34.302Z`（北京时间18:13:34）。最终附件核验于 `2026-10-07T10:19:21.032Z`，源码独立安装核验收尾于 `2026-10-07T10:22:06.121Z`（北京时间18:22:06）。这些是本次补交记录，不替换旧里程碑截止时间。原冻结Tag、原申报材料及另一会话L4/L5工作树未改；源码尚未提交Git，新候选未发布公网，也没有正式申报回执。

## 历史候选产物的相对位置（非最新下载清单）

### 四项申报内容

1. 项目PDF（15页，数据来源、人群重点方法、问卷与结果重点、模型/Prompt/抽样/参数、时间与费用、创新点和业务价值）：候选PDF（`output/pdf/city-agent-review-96709127-8c76-4a18-bdd6-3bdbd5755a9f.pdf`）。
2. 完整材料附件（53个登记载荷加manifest；官方PDF、两场景16个业务附件、历史正负结果、方法和视频）：材料ZIP（`output/review-packages/e77bd4c7-4639-496c-baa6-610250598893/city-agent-review-materials.zip`）。解压后打开`index.html`复核附件；可直接阅读候选Markdown（历史材料相对位置`public/submission-next/project-materials.md`，当前公开版本另见最新发布记录）。
3. 项目体验：当前新版仅本地 [虚拟社会调查](http://127.0.0.1:4320/#research)、[人群预设](http://127.0.0.1:4320/#residents)、[候选材料](http://127.0.0.1:4320/submission-next/index.html)。[现有公网入口](https://litianyi-007.github.io/city-agent/)仍是冻结旧版；新`/submission-next`尚未对外部署。PDF已显式解释新附件公网链接暂不可用，应随材料ZIP提交或待发布后使用。
4. 演示视频：最终实际录屏MP4（`output/review-video/demo-next-review-demo-1791366970062.mp4`），273.040秒，1600×1000，H.264，画面中文字幕、无音频。全程未填Key、未请求模型；字幕是讲解叠加而不是伪造系统返回。

### 评委本机复现与自证原件

- 源码ZIP（`output/review-packages/e77bd4c7-4639-496c-baa6-610250598893/city-agent-review-source.zip`）：260个白名单文件及`SOURCE-SNAPSHOT.json`；无需等未发布分支即可解压安装。
- 包清单与校验和（`output/review-packages/e77bd4c7-4639-496c-baa6-610250598893/package-manifest.json`）。源码聚合指纹：`55bf7577dc5352967c159104e79a93d54cb273f769b5de472f3095d3d98972f1`。
- 业务自证报告（`output/business-proof/96709127-8c76-4a18-bdd6-3bdbd5755a9f/proof-report.md`），业务总账（`output/business-proof/96709127-8c76-4a18-bdd6-3bdbd5755a9f/business-proof.json`），16附件manifest（`output/business-proof/96709127-8c76-4a18-bdd6-3bdbd5755a9f/manifest.json`）。
- [五层构建方法](RESIDENT-CONSTRUCTION-METHOD.md)，[人口跨区方法论](../population/METHODOLOGY.md)，[评委快速开始](../guides/JUDGE-QUICKSTART.md)。

源码快照准确表示候选生成时的文件，而不是一个已发布Git版本。它排除`.git`、node_modules、私人数据库、Key、环境文件、output与会话留底；本交接报告及最终安装/附件QA日志晚于该源码快照生成，没有偷偷修改快照或候选manifest。正式发布后需另给不可变版本ref。

## 从评委问题到补齐实现

| 问题 | 本次处理 | 仍不能据此宣称 |
|---|---|---|
| 修改Provider/Base URL会否把原Key发给新地址 | 无显式新Key时清除旧Key；UI提示；复制/同地址编辑语义保留 | 未做所有外部供应商CORS/凭据实测 |
| 规划/导出里是否泄漏Key，Prompt与实际发送是否一致 | 输入、成功/失败/部分结果在hash前统一脱敏；送入Harness的Prompt与记录一致；公开对象严格拒绝凭据字段 | 不保证检测未知秘密或所有隐写；本机Key仍受原本机存储边界约束 |
| 伪造导入的通过率/权重/人群字段能否骗评分 | 复算结构、抽样、一致性、人口审计；严格画像/镜像/年龄街道/性别/资格AND；空白答案无效；30人门限尊重预登记阈值 | 字节hash不是真人身份或供应商执行认证 |
| 空审计/漏居民为何也会通过 | 空规则/0适用检查不记通过；计划ID覆盖、重复/孤儿/映射不一致拒绝；raw复算答案 | 规则只覆盖登记约束，不等于全面语义盲评 |
| completed已显示而manifest仍在写会否造成现场失败 | 成功终态在manifest完成后持久化；错误/取消/等待语义回归；前端继续轮询尚无finishedAt的过早终态 | 不覆盖其他会话的L4/L5真实失败 |
| 演示问卷是否真完整，刷新是否仍可复核 | 小学17题、宠物18题，各4个五层情景/12实例；独立冻结业务证据入IndexedDB，刷新恢复原规则、完整导出；旧坏记录隔离不删除 | 人格值没有驱动本夹具答案，不能说人格效度通过 |
| PDF附件会否调包/截图与总账不一致 | 固定16业务附件白名单、字节hash、场景/策略/seed、Prompt、原文、统计与总账一致性校验；录像下载证据与CLI稳定hash一致 | 不用新夹具通过遮盖旧答卷错误 |

旧16题夹具的两份“不购买却有正预算”原文（resident-005/009）已经随新版材料归档保留；旧1.0空审计漏洞的记录也保留。新问卷、新策略、新UUID与独立1.1审计另建，未回写旧结果。变更前状态表留底于`docs/archive/2026-10-07-before-review-fixes/`。

## 两个业务示例的结果与边界

采用seed20261007，固定12个不同合成实例，不是12名真实受访者。每场景购买意向覆盖明确不考虑3、未知3，其余6；预算明确0有3、null有6、正值有3。未知不补0，不购买也保留在分母中。

- 小学照护者：17题×12，结构有效12/12，登记跨题逻辑12/12，执行158.944667ms。孩子本人口味12/12未采集，因此不能把照护者许可当作滨江小学生零食喜好或真实选址依据。
- 宠物零食：18题×12，结构有效12/12，登记跨题逻辑12/12，执行156.201666ms。猫/犬是人为覆盖；50克价位与10/20元意向不属于随机价格实验，不能推出滨江猫狗占比、最佳价位、主粮主营比例或盈利。
- 两场景模型请求/Input Token/Output Token/API费均为0；时间不含文件写入、页面渲染、录屏或本机计算成本。

UI里“应用问卷与五层预设”仅生成无Key的新预设/复制草稿，不启动居民，也不自动把专用夹具策略/规则移入普通调查。普通“运行问卷演示”使用通用规则，不能冒充本完整业务自证。

## 研究依据与版本口径

本次在线补查BFI-2原作者、人格遗传元分析、Park自报agents最新v3等原始来源；来源登记累计12项研究/官方原件及13项滨江背景观测。第一层采用Big Five情景倾向而不是“DNA人格6–10类”，其余成长/教育/当前家庭/工作收入四层独立。未知是null；0–100只为情景参数，不是滨江实测量表分数，不由学历/收入反推商品偏好。

2020七普人口503,859及三街道仍是冻结底座；2024/2025全区总量另册。年龄×性别联合采用显式独立性推断，不是官方联合表；未实现IPF，也未更新为2026实时街道。小学在校学生、家庭户平均人数、年度人均收入、数字经济GDP比例都不能偷换为居民儿童分母、所有家庭人数、个人月工资或IT职业占比。

POPO原命题文档本轮读取两次均未返回正文，不能声称本轮重新核对成功；候选依据已留底文档与用户重述的四项验收要求完成。没有对POPO文档执行修改。

## 复验记录

- 单元测试：239/239日志（`output/review-next-final-unit.tap`），0失败/跳过，19.530秒。
- 浏览器测试：19/19日志（`output/review-next-final-browser.log`），38.4秒；包括业务完整流程、坏历史隔离、375px移动端和manifest终态竞态。
- 构建：本机日志（`output/review-next-final-build.log`）、Pages日志（`output/review-next-final-pages-build.log`），均exit0。
- doctor（`output/review-next-doctor.json`）：Node22.22.3、SDK/dsh0.1.5-rc.3、SQLite、dist、Chromium、独立端口就绪。评委不需GPU/模型权重/全局dsh；源码ZIP中`npm ci → npm run setup → npm run build → npm run doctor → npm run start:review`。
- Pages独立验证（`output/review-next-final-pages-smoke.log`）：人群CRUD/复制/恢复、会话Key不落盘、预检、旧2.0证据及新2.1夹具导入、移动端；新增模型请求/违规请求/页面错误均0。
- 统一工程摘要（`output/review-next-verification.json`）及最终附件QA（`output/review-next-artifact-qa.json`）：53载荷bytes/SHA、30相对链接、两个ZIP校验、local/Pages各6个关键文件HTTP200且字节一致、录屏下载原文与CLI两场景稳定指纹一致、视频浏览器解码/播放成功、PDF15页逐页视觉检查通过。
- 源码ZIP独立安装复验（`output/install-review/run.ebizs9/final-install-review.json`）：在独立临时源码目录解压，260/260源码及聚合hash一致；`npm ci`4.956秒/exit0、build5.741秒/exit0、doctor8项通过。独立端口4338启动后10个只读GET全部200，默认居民/工作角色都无Key，自有服务正常停止且端口关闭。独立CLI重跑17/18题两场景均12/12结构及登记逻辑通过，16附件hash一致、稳定总指纹与候选相同，0 calls/Token/API费；安装后260源码未改。
- 安装复验只是在同机macOS arm64的新目录，复用了Node、系统工具与已存在Chromium缓存，npm缓存也可能复用；没有执行`setup`下载，不是无缓存新电脑或Windows/Linux实测，也没有验证供应商权限/CORS、全部Harness profile或真实市场效度。临时复现目录和日志保留。

## 下一步优先级与需用户确认的边界

1. 验收新版候选，确认main/GitHub Pages发布范围；固定新版本ref/Release，不移动旧Tag。之后重验真实公网的新入口与附件、CORS、Key/下载流程；正式申报需入口/回执。
2. 获明确API预算后，按预登记10人冒烟→30人≥29完整答卷。live API当前上限12，还需要单独实施受控扩容；不能仅运行离线评分器就称30人真实门限达标。
3. 真实规划、人格消融、跨模型、顺序/措辞/重复/价格及语义盲评；冻结原文、所有计划样本与失败账本，不选择性报告。历史49次/44有效、重复3批仅1批过4/5以及六次四角色终验失败继续保留。
4. 现实补采：合法照护者/儿童证据边界、真实家长/养宠资格分母、候选点/客流/租金、匿名订单/SKU/统一单位价格/履约/毛利/试售，再用独立真人留出与简单基线校准。没有这些资料就保留needs-data，不给真实主营比例/选址盈利承诺。
5. 现实桥MCP、resident/world/project隔离记忆、kata wiki/dream、有限自主接管与家庭社交演化仍为后续计划；梦不写成真实经历，外部观测需版本/群体/许可/撤销/冲突审核。

本历史候选准备阶段没有新增付费实验，没有Git commit/push/main或gh-pages改写，没有正式比赛提交；没有触碰并行L4/L5工作树。后续已授权公开候选与受限真实API测试，结果另册，不能把此历史句子作为当前零调用声明。不能把材料准备完成理解为全部研究/商业门限完成。
