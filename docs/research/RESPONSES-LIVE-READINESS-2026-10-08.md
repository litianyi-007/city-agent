# T28：真实能力探测准备与零调用前置停止记录

> 本文保留此前0-call历史。本机凭据等待已解决：用户确认原研究员Key后f3真实1请求因新增phase协议拒绝，首失败全停；phase1.1兼容/独立审核已通过，新的独立预算亦已获授权。[最新记录](RESPONSES-CAPABILITY-TRIAL-2026-10-08.md) · [公开白名单摘要](https://litianyi-007.github.io/city-agent/review-updates/2026-10-08/)。本文output原件属本机私有留档，不是GitHub下载入口；原失败不因回放改写。

日期：2026-10-08，北京时间。分支 `feature/virtual-society-next`；HEAD `8ad592c0af4df77102f928dae42ab7411d903ef5`；本批为未提交工作树，不冒称新的GitHub发布版本。

## 当前结论

用户已授权≤¥1、≤2次请求的独立 DeepSeek 固定模型能力探测。专用CLI、完整17/18题冻结输入、预算绑定、独立审计、只读凭据和原文取证已实现，并通过两名非作者复审。最终全量 **543/543单测、19/19浏览器、122/122 Responses专项、Pages构建/类型检查**通过，179历史原件、193源码起止一致。

真实命令在模型调用前被当前评审库的凭据门拒绝：`NO_MATCH`。当前本机Demo的4个研发角色均 `hasApiKey:false`。本轮 **0供应商请求、0模型答卷、0费用、2项not-started**；没有创建模型预算账本，也没有原始供应商响应。不能将它写成真实调查、供应商拒绝或Schema能力已验证。

正在请用户选择凭据来源：沿用原项目的既有研究员Key（只读、不迁移到评审实例），或在当前Demo研究员配置页填Key。已有金额/次数授权不需重复询问；配置来源明确后须重新冻结并绑定执行计划。不会自动换Key、重跑实网、增加预算或启动10＋10。

## 交付及验收边界

| 交付 | 实现与证据 | 本轮不宣称 |
| --- | --- | --- |
| 完整问卷输入 | `shared/responses-probe-plan.ts`，17/18题不删约束；新对象Prompt；合成资格及消费知识缺失明确 | 代表滨江消费者、两名偏好样本或现实选址结论 |
| 独立质量审计 | strict decoder之外的schema oracle；原业务逻辑、资格、未知填补分别审计；原文与数组投影分离 | 合规一份文本证明供应商逐关键字强制执行 |
| 授权/预算 | 新授权回执与plan hash分开记录；完整body＋1024预留；固定串行2次；无规划/CORS/重试/扩容 | Key存在即有效、供应商账单或重开旧账本 |
| 只读凭据 | 原DB从不开SQLite；短时私有加密DB/WAL快照；checksum与三次源稳定门；清理失败不返Key | 宽容恢复所有合法WAL、自动迁移或忽略损坏取旧Key |
| 原始取证 | 仅实际已拉取字节；完整EOF hash与部分前缀hash分开；Key回显不导出；按枚举记录媒体类型 | 取消产生的done是EOF、错误JSON是成功SSE |
| 执行/停止 | `review:responses:live`显式两模式；首次失败停止全部；第二场景保留not-started；checkpoint/源/授权再核验 | 默认API/UI已迁移、真实供应商能力已过门 |

模型固定 `deepseek / https://api.deepseek.com / deepseek-flash`，私有调用地址固定 `/v1/responses`，本轮只接受HTTP200。官方接口文档只作为登记依据，不以文档代替本轮实网观察。[DeepSeek Responses接口](https://api-docs.deepseek.com/zh-cn/api/create-response/)

零模型调用preflight重新抓取官方价格HTML，检查 Flash 模型列与高峰非缓存输入¥2/百万、输出¥8/百万，忽略缓存/闲时优惠；两次完整body及3000输出上限的保守合计预留为¥0.130486，不是实际账单。[DeepSeek官方价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)

## 独立审查如何影响实施

按specs-workflow先写本轮边界设计、冻结实验，再由独立specs-review分别检查安全和研究口径。实际发现并修复：

1. 旧数组答卷Prompt与新对象schema相冲突：独立对象Prompt，不临时清洗或删约束。
2. 原生SQLite只读打开可能碰WAL/SHM：只打开短时加密副本，不停现有服务、不checkpoint原库。
3. HTTP201可能被generic relay接受而报告 `httpAccepted:false`：本轮独立200门；合格SSE的201也停止全部，第二项不启动。
4. 授权/计划/HEAD可能登记后漂移：每一门重新读取并比对，不只检查启动时快照。
5. 账本close异常曾可能仍报finalized：只有闭合成功、durable且非active才登记finalized。
6. 迟返回fetch与取消body：无条件abort、有界取消/等待；取消触发的done不得认证EOF。独立正常EOF、挂起、迟返回及前缀夹具验证。
7. HTTP错误JSON不因后缀被写成SSE：统一原文 `.provider-original.txt`，媒体类型单列。
8. 生产库正常`runs`目录被过严inventory拒绝：只允许普通目录并绑定身份，不读、遍历或复制内容；文件/链接/未知根条目仍拒绝。

凭据最新版17项合成专测独立通过，另3条目录换inode/换链接/伴随Key变更均拒绝。不访问真实Key做合成安全验证，不用供应商费用试错。[SQLite官方WAL格式](https://www.sqlite.org/fileformat2.html)

## 全量工程取证，负记录分列

| 批次 | 结果 | 原件目录 | 解释 |
| --- | --- | --- | --- |
| 第一轮 | 539单测、122专项、Pages通过；浏览器18/19 | `output/offline-review/system-8jkwak/` | GET `/`实际500，完整stdout/stderr及trace另tar留存；root额外普通构建与服务读dist存在干扰，不抹去失败 |
| HTTP/迟返回补丁 | 541单测、19浏览器、122专项、Pages通过 | `output/offline-review/system-1wZWUY/` | 与随后取消前缀修复的源码不同，不继承为最终版本 |
| 取消前缀修复 | 542单测、19浏览器、122专项、Pages通过 | `output/offline-review/system-xrhXs8/` | 首次实网命令前已通过；随后发现生产目录兼容问题 |
| 当前凭据目录兼容 | **543单测、19浏览器、122专项、Pages通过** | `output/offline-review/system-1BMGNf/` | 当前源码；19浏览器43.8秒；总复核45229.458625ms；193源码/179历史一致，8份日志字节/hash复核通过 |

最终源码inventory：`78ec1ebabc3c47b9f9143fe1889daf6cad3326a472d76f1aeda579d00d862176`。能力计划另含4份业务/人口JSON，当前197文件hash为 `d24264d523c37fca81fc4243ac68cf8077bd3d681e58b3a2452f64551f5986e8`。

第一轮浏览器trace证实2026-10-07T18:57:04.330Z页面GET返回500 JSON；服务从`dist`供页、普通构建重写`dist`是已定位的测试安排风险。之后不在浏览器工作期间额外运行普通构建；后续通过不能证明一般并发发布安全或历史偶发失败的全部根因已修复。

## 本轮已冻结、前置停止的注册原件

预算授权ID：`approved-2026-10-08-responses-cny1-2`。注册ID：`c1e0f2aa-47e0-4909-ae0c-da6068b68e31`。

- 注册与另行记录的用户回执/绑定：`output/live-evaluation-authorizations/approved-2026-10-08-responses-cny1-2/`，0600文件。
- 原计划hash：`7641cc927cb8679cdc0754f3a16a0b93565ac50d13342148e1082548eff659fa`；197文件原source hash：`ffa6922135357c4ca951decdb963e4573201f430370022fe0b249b670b781a7b`。
- 价格快照检查时间：2026-10-07T19:06:24.750Z；HTML hash：`5a7b1832592387340f2fc456399b34b89b05f3fa167c2e35909e2fa4afe021e3`。
- 零调用观察：[pre-dispatch-report.json](../../output/live-capability-proof/c1e0f2aa-47e0-4909-ae0c-da6068b68e31/pre-dispatch-report.json)。hash：`7596f8c051eca17aff526a76436c43f7e279444c750c70a51c1fc8aef5be7146`。这是操作者对工具结果的记录，不冒称完整进程日志或供应商响应。

CLI实际执行一次，退出1。诊断确认授权/计划/人口/价格/历史一致，当前评审库无匹配Key；原项目库正常`runs`目录在兼容修复前被拒绝。没有原库API Key被选用、复制或迁移，原库SQLite从未打开。后续源码兼容修复已使原冻结source hash失配；原计划和观察继续留底，不覆盖、重开或强行续跑。

## 下一步

1. 用户确认凭据来源；不要求用户在聊天里粘贴Key。
2. 在明确来源与原授权上限内重新独立登记计划，保留本次0-call记录；重新检查价格/源码/授权、未消费账本和选定固定模型。
3. 至多2次真实请求，首异常停止全部。记录HTTP、原始流、EOF、用量、预算、独立结构/逻辑/资格/未知审计和未启动分母；失败原样保留。
4. 根据真实能力结果再决定新的离线修复或独立能力对照。10＋10、逐关键字对照、API/UI选择、新视频和发布分别过门，不自动并入本预算。

两场景未知输入通过也只验证本次保留未知的合规性，不会变成「小学生最喜欢什么」或「猫/犬零食哪个区域更盈利」的调研结果。市场/人格/真实居民外推仍需要业务观测与独立校准。两份旧closed账本、旧申报材料与另一会话L4/L5分支均不改。
