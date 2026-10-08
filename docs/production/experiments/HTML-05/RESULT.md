# HTML-05：实际前端提交与PM输出协议失败

## 结果与体验

2026-10-08，实际本地前端只启动一次HTML-05，Run `9a56085f-8a2e-474d-97fd-82f82aaac795` **failed**。产品、研究通过各自LLM静态审核，项目经理三份候选依次违反严格字段或JSON语法，耗尽两次共享修复。没有验收计划、分组、测试、研发、冻结合同、最终Gate、HTML或预览；八项业务验收均未测试，不计自主交付成功。

[本地工作台](http://127.0.0.1:4420/#production)历史可选择HTML-05。[公开Pages](https://litianyi-007.github.io/city-agent/production/)仍为静态v6案例／材料页，不能在线运行这个新需求。源码与本次材料推送不等于Pages更新。

浏览器插件不可用，本次使用自己的Playwright Chromium实际填写编辑器、免费预检、授权勾选、点击“启动真实生产”。没有route.fulfill、SDK注入或Mock回复；供应商HTTP由真实Harness执行。前端观察到单POST／单202响应，平台历史20→21条。[启动前截图](ui-before-launch.png)／[终态截图](ui-terminal.png)是平台页面，不是生成产品截图或3–5分钟视频。浏览器只允许回环4420请求；0外联拦截是本次平台UI观察，不是任意生成代码安全认证。

## 固定来源与权限

[冻结索引](PRE-REGISTRATION.md)说明运行前已提交提案与实验后归档的时间边界。用户回复“推进下一步”仅消费本次1 USD提案；来源类型illustrative，自拟演示需求不是业务工单。brief和八项acceptance与HTML-04逐字相同，无旧源码、预填checks、demoCaseId、外层修JSON、手改产物或模板回退。

- 实际源码：`8928f9aac7a5d6a59615467c851d7e8a7e94c54f`，clean／ready／issues=[]。
- 构建UTC：`2026-10-08T08:15:25.518Z`；boot `5eb125c3-87ff-4c8d-aa13-41eac83a74c0`。
- sourceFingerprint：`e4df69148772a9bc7adfad36669e03f23d6c3b2b88e4b72088afda973f687c38`，110个公开source文件；buildFingerprint：`475ba6d5989bf3ec595f00adb4f724a0756ceb83a76c05c35fba9b1ce3fbddbf`，10个build文件。
- 免费预检hash：`5ba90d2d36b8f8fc0feb66777abb4fce45a6e464c408651019a829053ed9192f`；ready／fresh、0模型请求、paidAuthorized=false、finalGate=null，不是付费或成功证明。
- HTML grouped-v1、验收plan/group/construction-v1、原12项／20步与Verifier ordinal-v5；本次JSON诊断为v1。六角色均DeepSeek／deepseek-flash，页面声明0.30／1.20 USD每百万Token；配置只显示hasApiKey，不输出Key。
- 实际门限仍24调用、500000总Token、6000单次输出、600秒、2次共享修复、1 USD估算停止；初始16／最坏28保守包络不会自动提额。费用门限不是供应商账单硬上限。

运行后免费修补改为JSON诊断v2，不回写本次v1版本、原文、失败或费用；旧申报、HTML01～04、Tag、main与另一研发线保持不变。相同模型ID不证明权重独立，版本hash也不是已加载内存字节或安全沙箱证明。

## 失败链路与归因

`产品 → 产品Verifier接受 → 研究 → 研究Verifier接受 → PM非法 → PM返修1非法 → PM返修2非法 → failed`

真实Verifier仅2次，各5分accept；PM的三条空合法池abstain由宿主结构门禁产生，不是三次付费Verifier判断。两次修复均在研发前、同一全局额度；interventions=[]表示账本无中途人工操作，不独立认证系统外活动，外层平台开发／归档不计内部自主交付。

| PM候选 | 严格拒绝原因 | 原文SHA-256 |
| --- | --- | --- |
| 初次 | 多出`decision_rationale_note`，schema additionalProperties=false | `a70a9e7553580e119ff7e5116d5865e38ddaf69ebe28b572831a34ffd6d852c1` |
| 返修1 | 仍多出`decision_note`，不因空字符串而删除或放行 | `383ea04cc409579416767304e270c041d473fc0f2202a1066b8781fbd944720b` |
| 返修2 | summary后提前闭合顶层对象，尾随tasks；真实JSON.parse报UTF16位置505 | `5f3347aa43571dd2859ecf358fc082f31bf34adfcfd32bde8cff32ffaa5f8235` |

三次实际outputContract均只允许decision／summary／tasks／risks，required完整且禁止额外字段；原Prompt不要求上述note。第一、第二修复分别收到前候选callId／candidateId／SHA、严格拒绝原因及2000字符原文前缀。模型第一次返修文字自称只输出四字段，但仍带note；自述不替代实际解析。

诊断v1只识别“in JSON at position”，漏掉本次“after JSON at position 505”，因此原档位置为null、摘录落在2533–2853文末。本次已无剩余修复使用该诊断，不把后来v2定位准确追认为模型获得反馈或改善成功。该缺陷与最后解析拒绝各自留证，没有自动修答案。

研究／PM关于“8组、约14步”的说法仅是未实现规划；完整操作及断言可能超过声称容量，两个5分不认证实际业务覆盖。新分组策略尚未被本次调用触达，不能判断其质量或性价比，更不能用不同源码的HTML01～05探索合成固定配置稳定性成功率。本配置唯一尝试完整交付0/1。

## 用量、原档与复核

管线durationMs **52563（52.563秒）**；创建到完成52.781秒含准备／排队，二者不混同。**7逻辑Harness调用＝7次实际供应商HTTP POST**，均200、usage／协议完整、denied0、httpEof=false；协议结束不等于物理EOF。**42130输入＋7806输出＝49936Token**，Jev0、未知usage0。

声明价估算 **0.0220062 USD**，`(42130×0.30 + 7806×1.20)/1000000`；原账本浮点值0.022006199999999997保留。未耗尽调用、Token、时间或费用门限，失败原因是两次修复耗尽。供应商账单、折扣、外层Agent Token／人工／机器成本和ROI仍unknown，不记零。

[receipt-files.json](receipt-files.json)固定15份原件的字节／SHA。evidence与delivery-manifest为实际下载artifact正文字节；run、启动、预检、公开配置为API解析后规范化快照，actual-browser-submit为schema规范化的实际请求，不冒称网络原字节。run与evidence仅相差追加LF、解析结果相等。授权记录非独立签名；导出遵循既有脱敏策略，不证明取得未脱敏供应商原件。浏览器profile／缓存、加密配置、Key和私人材料没有归档。

安装见 [评委指南](../../REVIEWER-GUIDE.md)，Node22下无Key离线核验：

```sh
npx tsx --test tests/production-html05-evidence.test.ts tests/production-output-diagnostics.test.ts
```

它只读原件、校验hash、重放严格解析和声明价算术，不启动SDK、模型、浏览器或候选代码。工程回归、修补与独立对抗审查见 [本批记录](../../BATCH-HTML05-CHECKS.md)，不替代真实结果。

## 下一步

本次一次授权已经使用，不自动复跑。下一免费切片优先按角色修正“设计默认记录”的合法字段指引、强化PM四字段闭集与结构拒绝反馈、对负例状态组合核对真实setup／断言容量；所有完整Verifier与实际Gate保持独立。完成工程／审查后另冻结配置和新预算，再测试完整分组闭环，不靠删字段、少测业务、提额或外层修产物追认成功。
