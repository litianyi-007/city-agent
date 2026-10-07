# 质量与评委发布 v6：设计、权限和验收

## 目标与边界

本批是外层开发 Agent 对平台的免费工程切片，不是平台内部六角色新的一次真实交付。用户要求完成自主开发、提交并发布到 GitHub，且发布前对所有提交代码对抗审查。仅使用 feature/autonomous-production worktree；不修改／合并 main、不停止虚拟社会服务、不动冻结 Tag、不迁移 Key。发布仅允许 gh-pages 的 production 子树，历史附件只读，新材料增加 reviews/<完整publisherCommit>/。

## Jev v4：弱弃权不是强拒绝

继承 REAL-02 的严格类型、评分公式及 ±0.005 容差，不因12次算术漂移而扩大放行。Choice=abstain、无合格项但尚未证明所有候选强拒绝时，分类 uncertain，进入已有的一次独立 LLM 有界复核；allStronglyRejected 保留直接拒绝。原 C16 账本不改写，离线重放只能说明新策略的分流，不能预测复核答案或宣称消除错弃权。Token、调用、时间、费用、取消继续受统一预算控制。

[Jev API](https://docs.typesafe.ai/api)和[Confidence](https://docs.typesafe.ai/confidence)区分概率加权 Score 与分布集中度；不把集中度当正确率，不推测供应商精度承诺。本批不发起新收费调用。

## 条款证据：显式 opt-in source-bound-v1

默认 legacy，旧 verifier v5 输出／Prompt、旧实验和默认路径保持兼容；只有 live + offline-single-html + llm-rubric 接受新模式。API 在模型调用前拒绝 Mock、相机、Jev 不兼容组合；UI 给出冲突、撤销旧同意且不静默替换引擎。

研发／返修的版本化 implementation-evidence-verifier-v1 契约绑定：原始 brief、原始用户 acceptance、全部产品 acceptance、冻结 checks／hash、当前候选 ID 与值 hash。评审须逐候选逐条款给 supported／missing／contradicted，并提供 /html 的8–160字唯一短引用和冻结 check／step 索引。最多2候选、14条款、每条2引用／3索引、16KB证据。supported 缺引用／断言、错误 hash、遗漏／重复／外来条款、不可定位引用、非交互后业务断言均拒绝；missing／contradicted 不能打到合格3分及以上。

机械校验只证明当前源码中存在引用、覆盖和绑定一致；同一引用被用于多个条款并不证明业务实现完整。产品分解本身也不证明原始需求被完整理解。最终冻结行为 Gate、失败反馈、共享最多2次返修及预算仍独立，评审分数不能覆盖实际失败。新 profile 不要求前置角色引用未来代码、不自动 JSON 修补、不做额外隐形调用。所有证据／诊断进入运行记录和交付 manifest。闭环含义不扩大为任意软件 L5。

共享模块使用 Web Crypto 和严格有界数据结构，不引入 Node、文件／网络、Key 或缓存。固定 study 源码依赖闭包升 v4，并包含两个新模块；旧 REAL-02 47文件 v3 原件及核验兼容保留。

## v6 证据、安装与发布

三 Mock、CAMERA-01～09、旧 MP4／WebM 从已校验 v5 包继承原字节及来源 commit；新导出 PDF 是新衍生材料。REAL-02 恰10个白名单文件：预登记、结果、metrics、archive-inspection、四个控制原件、原始 tar.gz、结果页。压缩账本核验固定 SHA、成员数量／路径／解压限额、内层秘密、实际 Oracle 与事件派生指标；不得相信手填良品率或覆盖旧结果。选优对照和完整交付分母分列，C成本更高／坏放行／错弃权均保留。

新材料版本精确 v6 才使用120文件／公开130文件上限，单文件30MB、总100MB不变；旧版本保留旧限额。公开源码 HTML 转 TXT；只允许逐字匹配平台可信固定 Mock 进入隔离预览。安装复制命令固定完整40位 commit，失败即停、存在旧目录即拒绝，摄像头下载与普通安装分开，不自动执行。

发布前从内存已核验快照生成 ZIP，再复核每个 ZIP 成员与源字节一致、没有隐蔽压缩尾流。publisher 强制当前版本、绑定内嵌 package-manifest、文件 hash 和精确清单，并在 GitHub 写入前再次核验 REAL-02／ZIP。合成 tree 前后比较 production 外所有 root SHA；production 内除首屏和 publication-manifest 外的既有 leaf 必须 sha/mode/type 不变。并发 ref 变化时停止，禁止 force。

## 本批验收和后续

先做单元／注入、浏览器表单、全量回归、构建，再独立跨所有新增代码审查。P1/P2 修复并复审后提交推送；干净 publisher commit 导出 v6，逐页 PDF 检查和公开浏览器核验后发布。费用：新增模型请求为0；工程运行时间记录，外层开发 Token／供应商账单未知而非零。真实新 profile 效果仍需另行预登记预算，不能将工程夹具算自主交付成功。

完成记录和后续门限见 BATCH-QUALITY-V6-CHECKS.md、NEXT-STEPS.md；申报主稿保持历史结论。没有官方 L4 认证材料，按既定有界工程口径自评。
