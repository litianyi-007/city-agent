# HTML-04：费用记录页单次真实探索结果

## 结果与体验入口

2026-10-08，用户明确批准“仅这一次，采用1 USD限额”后，运行 `789f99d1-792f-413e-b509-71da5302eb2f` **failed**：首次测试机械合法但独立LLM Verifier以2分弃权；第一返修JSON非法，第二返修步骤超限，两次共享修复耗尽。**没有冻结验收、研发、最终浏览器Gate、HTML或预览**，不计真实自主交付成功。

本次是用户授权自拟费用记录页，illustrative／live／real-model；不是实际业务工单或Mock。原话与八项验收完全保留，无demoCaseId、外层预填checks、已有源码、手改产物、JSON修补、模板回退或临时放宽12项／20步。

[本地工作台](http://127.0.0.1:4420/#production)可在历史运行查看HTML-04。浏览器连接当时不可用，本次通过同一后端原生API输入、预检和POST启动，**不冒称前端点击或本次录屏**。[公开Pages](https://litianyi-007.github.io/city-agent/production/)仍是静态v6案例／材料，不运行新需求后端；源码／证据推送不等于Pages发布。

## 固定来源与预算

付费前已提交、推送source `19466ab1c75610502ae8ff58a069308781e62151`中的提案及固定八项验收；[预登记索引](PRE-REGISTRATION.md)是实验后归档导航，不倒签时间。原提案“待批准”全文保留，用户随后另行批准才提交一次付费输入，未重用HTML-03授权。

| 项目 | 快照 |
| --- | --- |
| source commit | `19466ab1c75610502ae8ff58a069308781e62151` |
| 构建／服务启动UTC | `2026-10-08T06:30:53.447Z`／`2026-10-08T06:31:59.550Z` |
| bootId | `107ec4b9-1c3c-4870-b000-754b8e133084` |
| sourceFingerprint | `6dedcc52d6aef10a1a31edb7bc906a784436d01aad641af590996cb05d511005` |
| buildFingerprint | `edb3afb8f75dd908ba3920c01d72cb9ea4ea8da7af014c866d29a5e36abe6abc` |
| 免费预检reportHash | `488381b84197d3e66da2e33864a965a2e259e315fceb82e511d94a768fd6ac92` |
| 状态与数量 | clean／ready=true／issues=[]，109个boot source文件、10个build文件 |

109是boot公开源码快照，不是study v6／52文件闭包；hash是相同内容的核验，不是独立签名、已加载TS字节证明或安全沙箱。免费预检ready／fresh、paidAuthorized=false／modelRequests=0／finalGate=null，paid输入唯一变化为budgetAuthorized=false→true。

六角色均为页面已配置DeepSeek／`deepseek-flash`／`https://api.deepseek.com`，声明输入0.30／输出1.20 USD每百万Token；hasApiKey仅是脱敏状态。Key不进入本次公开材料／Prompt，不迁移别线设置。HTML v11、诊断／规划v1、Verifier ordinal v5；legacy／N=1／LLM评审，Jev0。参数只取实际配置或观测，不猜temperature、seed、权重身份或账单折扣。

仅一次：1 USD声明价估算停止额度、24槽位、500000总Token、6000单次输出、600秒、2次共享修复。首次预留71,536Token／0.0268608 USD；正常12／最坏24逻辑调用包络，最坏Token预留1,716,864高于500000，已提示可能提前停止。ready不保证交付或完整业务覆盖，不是付费同意；authorization.json为对话同意记录，非独立签名或自动启动令牌。单次授权已使用；剩余估算额度不构成追加授权，不运行第二次。

## 链路与失败分型

createdAt `2026-10-08T06:38:38.530Z`，failed事件 `2026-10-08T06:39:42.953Z`，finishedAt `2026-10-08T06:39:43.130Z`；平台durationMs **64,396（64.396秒）**。创建到完成包含排队／准备，不能强令其差值等于管线内部duration。

`产品→产品Verifier→研究→研究Verifier→项目计划→规划Verifier→测试→测试Verifier弃权→测试返修1→测试返修2→failed`

10个逻辑Harness调用、10次观测HTTP POST。四次真实Verifier：上游各4分accept，测试2分abstain；后两条空合法池abstain是宿主结构拒绝，不是新增模型评审。两次为冻结前acceptance纠错，不是研发后Gate返修；interventions=[]只表示平台账本记录的中途人工介入0，不独立证明系统外活动，外层开发／归档不计内部自主环节。

| 候选 | 机械检查与裁决 | 原文SHA-256 |
| --- | --- | --- |
| 初次 | 8项，步数10,14,19,15,12,19,7,20；结构／选择器预检合法，覆盖评审2分弃权 | `49b39a688d87f9a0e3a6d9a538ae0d73a637a1eb199231d840e9774e3d2d64d1` |
| 返修1 | JSON非法，UTF16位置3604，count整数后多引号；不能计算有效checks或步数 | `e3f9c93757341d47ca1da89de2675fba88699fa67d7c0ef6c0b81820e738d862` |
| 返修2 | 9项，步数12,21,22,19,15,21,20,14,22；超限索引1,2,5,8，全部拒绝 | `7031ce4c1fafa773892a0982e3214e186b1a5476d64284bf2043d236babed64c` |

第一返修绑定初次call／candidate／SHA、2,000字符摘录与弃权原因；第二返修收到准确绑定第一返修原文的syntax诊断、位置及局部片段。最后容量诊断的步数／索引／SHA正确，但已无剩余返修调用，**没有验证该容量反馈被模型使用或帮助修好**，不能追认为反馈效益。

## 独立覆盖审查与边界

初次check[5]名称声称“两态”，实际只有空列表的五种非法金额与count=0，没有已有有效记录setup，其它checks也未补齐五种×已有记录态；该项及空白描述项没有提示存在／内容断言。添加／筛选只有数量、部分汇总，不充分核对实际描述／类别／金额；筛选删除切回后未核对剩余记录身份。内部2分弃权与这些缺口一致，标题或合法结构不代替覆盖。

末份可解析候选仍漏要求：空态只测-1／0／空／1.234，缺10000.00；已有5.55有效记录后只测10000.00／-1，缺0／空／1.234。即使压到20步，也不能追认为完整验收。上述为静态原文审查，不是执行Gate或应用Bug；本次无应用源码供实测。

上游规划4分／proceed不代表tester可靠实现其承诺。本次防止一份已知覆盖不足候选冻结，是可观察的有界事实；单次不证明v11因果增益、普遍准确率或高性价比，不合并不同配置HTML01～04为稳定性实验。本配置唯一尝试完整交付0/1，不伪造研发／Gate成功。

## 计量与原档

10条完整usage：**69,479输入＋12,588输出＝82,067Token**。声明价估算 **0.0359493 USD**，公式`(69479×0.30 + 12588×1.20)/1000000`；原JSON为0.035949300000000003，展示舍入不改账本。HTTP均200／denied0／protocolComplete及usage完整，httpEof均false，不把协议DONE说成物理EOF；Jev0、未知请求0，无追加实测。

供应商发票、模型实际底层权重认证、外层Agent Token／机器／人工成本及完整增效对比均unknown，不记零。未执行的研发／Gate不是零成本成功阶段；预算限制后续启动，不承诺供应商账单硬上限。

前三份直接下载HTTP正文、字节不转换；其它五份是API解析后保存的规范化JSON准备／同意／启动快照，**不冒称等于网络原正文字节**。所有导出按既有平台策略脱敏；角色rawOutput SHA绑定导出原文，不证明取得供应商未脱敏原件。

| 文件 | SHA-256 |
| --- | --- |
| [run.json](run.json) | `48ae00e8bbeb6feeac69fb8820c12ed07463be54d9fb0d991bf8300230cfb86d` |
| [evidence.json](evidence.json) | `f7019da587755ffb382f5f9ed8839b4f14301f4d3256d29e47d0e3dc9ba564dd` |
| [delivery-manifest.json](delivery-manifest.json) | `b317d684c151389842072c51a1cf845ad739b00b738333fc51604f9cadbeb338` |
| [platform-metadata.json](platform-metadata.json) | `3325f825c0cc33a4a9b3cbc7d71845f44f8b043abebb51935fb731c2f3383960` |
| [launch-preflight.json](launch-preflight.json) | `4d5377191c95d71f37029a4d64dcbe1744567fc43ce26bbb6c2c644b04bb3fb3` |
| [input-snapshot.json](input-snapshot.json) | `e80c122c08d77b518236d8c0d61304ab47a27741cca48e2900084a572bcf3947` |
| [authorization.json](authorization.json) | `cd0308a7040508b257c39f27698850c0a8e2caec1e50757f22e538c039da8257` |
| [launch-response.json](launch-response.json) | `16598b18c6646426ab78d0f3b169caded81a7f7f697cb1845f021e0fe4a73702` |

按 [评委指南](../../REVIEWER-GUIDE.md)安装Node22与独立依赖，无Key只读核验：

```sh
npx tsx --test tests/production-html04-evidence.test.ts
```

新receipt测试首轮7/8：测试自身对不存在regeneration调用includes触发TypeError，仅修测试空值处理后 **8/8通过**（543.302ms），初轮／复跑日志保留在output/production-html04，不改实验或门限。最终免费专项 **60/60通过**（17.314秒），包含新8／旧HTML03／诊断／Prompt／注入管线／来源／凭据／归档，互有重叠，不相加。TS与diff核验通过。本批没有运行时代码修改。付费前完整 **824/824＋54/54** 对应source19466，不追认为归档后全量832回归或新模型成功。

测试只读JSON／hash、解析与静态覆盖、核算；新receipt不启动SDK、模型、浏览器、候选或JSON修补。60项中既有注入控制流为工程合成，不是新增真实调用。非作者证据／计量审查确认10HTTP、全部hash、预算与分型，旧HTML03五原件未变，公开秘密形态检查不读取真实Key／私密state；外层审查不替代内部Verifier／Gate。

### 代码审查报告 — feature/autonomous-production

2026-10-08，范围17个文件：8份公开JSON、8份Markdown、1份只读receipt测试。三名非作者分别完成代码质量／服务端证据、公开安全／变更范围、业务与文档交叉审查；独立receipt复跑均8/8。没有`docs/lessons/`历史经验目录，参照原始失败档案而非虚构经验记录。

- P1：本次范围无开放项。
- P2：本次范围无开放项；候选业务缺陷已在上文记录，不代表平台全部缺陷已解决。
- P3：后续结构性改进见下一节，不用继续增加提示词替代工程契约。

结论：本次归档／测试范围可提交。三份文档留底与19466全文逐字节相同，17个公开文件规则型秘密扫描通过，当前文档入口存在；不覆盖未知编码秘密、未读私密日志或完整平台安全，不代表真实交付通过。

## 下一步：先免费改结构

本次一次授权结束，不启动HTML-05或重试HTML-04。优先免费实现版本化验收规划／分组生成契约：先明确需求条款、状态、负例与setup预算，再用受控的小组输出组成完整checks，并在研发前完整预检、覆盖审核、冻结。保持12项／20步和原要求，不手改旧答案、静默删断言、追加共享返修或放宽Gate。

该能力仍是下一任务，不是本次已实现：须验证新请求／Token包络、分组血缘、取消／留痕、失败不隐匿、全部组合法才冻结等门限，不能只增加文字提示或以压缩数量替代覆盖。新的真实探索需新配置／预登记／单次预算；实际Gate与全部业务核验通过后才称最小闭环，稳定泛化另验。
