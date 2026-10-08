# HTML07：启动守卫放行，研究JSON与PM闭集失败

## 单次实测结果

2026-10-09北京时间03:34:59–03:35:49，在本地需求编辑器实际填写并只点击一次“启动真实生产”。Run `18b50d49-4cc2-4f63-bcc7-94da50802d91` **failed**；启动守卫v2及同源预检正常放行，但研究员两次JSON语法错误耗尽共享返修，随后项目经理额外字段拒绝，未进入验收规划、分组、步骤审计、冻结、测试、研发或最终Gate。原八项业务全部未测试，不计自主交付成功。

管线 **49.631秒**，创建至完成 **49.881秒**（起算点不同）；**7逻辑Harness调用＝7观测供应商HTTP尝试**，**37,555输入＋7,683输出＝45,238 Token**。声明价估算 **0.0204861 USD**，用量完整、未知0、Jev0；这是估算而非账单。1 USD仅停止后续请求的估算门限，剩余额度不授权第二次实验。本配置唯一尝试完整交付0/1，不合并不同源码的HTML01～07为稳定性成功率。

[本地工作台](http://127.0.0.1:4420/#production)可选择HTML-07历史。[GitHub Pages](https://litianyi-007.github.io/city-agent/production/)仍是v6静态材料/可信案例入口，不运行新需求后台。本批源码/证据推送不等于公开部署更新。

## 授权、输入和实际页面

用户明确回复“批准仅这一次，采用1 USD限额”，见[授权原件](authorization.json)。该可信对话记录不是独立签名；未继承HTML06的已消费授权。需求来源illustrative，是自拟演示而非业务工单。[输入](input-snapshot.json)与HTML06原brief/八项acceptance逐字一致，仅编号、来源、背景更新；无旧模型答案、源码、预填checks、demoCaseId或模板。

[运行前提案的原字节快照](PRE-REGISTRATION.md)在运行前已存在于干净源码commit `c981490cd94bcb753f6b66291ee4319b092f62f8`；快照在运行后归档，不冒称归档文件当时已提交。其相对链接按[原提交路径](https://github.com/litianyi-007/city-agent/blob/c981490cd94bcb753f6b66291ee4319b092f62f8/docs/production/HTML-07-PROPOSAL.md)解释，proposal SHA与授权记录一致。

- 六角色页面已有DeepSeek / deepseek-flash；声明费率输入0.30 / 输出1.20 USD每百万Token。公开配置仅hasApiKey，不读取/导出Key；同Model ID不认证权重独立。
- live / offline-single-html / LLM Verifier / N=1 / legacy / planned-groups-v1；不调用Jev。
- 24逻辑调用、500000总Token、6000单次输出、600秒停止触发、≤2共享返修、1 USD估算停止；unknown立即停止。原12项×20步与完整业务不变。
- grouped prompt v3 / PM输出policy v1 / JSON诊断v2 / 步骤审计v1 / 完整评审投影v1 / public-collision-guard-v2 / production-startup-public-guard-v1。
- clean build/boot `49679553-a24b-4c68-bcca-24eb9131dcd2`，source/build commit均为c981490；免费页面预检ready/fresh、startupGuard.ready=true、0请求、paidAuthorized=false、finalGate=null。预检hash绑定实际输入/配置，不是成功或付费授权证书。

本次IAB返回“Browser is not available”，采用本分支自己的Playwright Chromium实际操作前端；无route.fulfill、SDK注入或Mock回答。click前`wx`持久化意图，实际请求快照与授权输入相等；重复POST阻断，观察到1POST/1个202，历史22→23条。驱动的automaticRetryAllowed=false指不追加另一启动尝试；管线内最多两次共享返修仍按本次限额执行，计入7次调用。浏览器只请求回环4420，外联拦截0；该观察不证明任意生成代码安全。前置准备脚本曾因机械替换计数5/4断言停止，仅写两份数据快照、未执行UI或模型；纠正后核对既有快照未覆盖，没有额外启动。

[启动前](ui-before-launch.png)/[终态](ui-terminal.png)截图是平台UI，不是产品截图或3–5分钟视频。前一张需求表是HTML07、下方仍显示HTML06旧历史；终态已选择HTML07。`interventions=[]`只表示该运行账本无中途人工操作，外层开发、脚本、归档、核验均不是内部团队交付。

## 原件归因与Verifier边界

`产品 → 产品Verifier接受 → 研究非法 → 返修1非法 → 返修2合法 → 研究Verifier接受 → PM非法 → 共享返修耗尽 → failed`

| 阶段候选 | 实际拒绝 | 原文SHA-256 |
| --- | --- | --- |
| 研究初次 | observations后提前闭合根对象，`constraints`变为尾随JSON；UTF-16位置1829 | `ac67aedb1db6bc3c20f370392ef88aa659c461582c5e31ca001c03b870917016` |
| 研究返修1 | 第二个observations数组元素缺少起始双引号；位置233 | `c946a5b91055848c94e028e85d30372922e05f6261bf3e8ecdd0353deb77ab25` |
| PM初次 | JSON合法但根多出`risksNote:""`，严格schema唯一unrecognized_keys | `6de257a60d1d723c83f9081b39c48fdf1fee66212e0596581fb24632bcae9414` |

JSON诊断v2的位置、320-unit摘录与完整原文SHA均正确；后续研究请求忠实保留前轮call/candidate、2000-unit原文前缀、诊断、失败及剩余修复1→0。PM实际outputContract只允许/必需decision/summary/tasks/risks，additionalProperties=false；PM policy与系统指引一致，不要求不存在的默认值字段。没有发现宿主误拒绝或反馈自相矛盾，不剥离空额外字段来放行旧答案。

原生json_object在线请求已观测，7个HTTP均200、protocolComplete/usage完整，输出未达到6000上限；这些事实仍不保证输出语法或语义正确。httpEof=false与协议终止口径分开，未据此宣传物理传输EOF或供应商质量保证。

实际付费LLM Verifier仅2次：产品5分accept、研究4分accept；另3条空合法池abstain来自宿主结构门禁，不是额外付费判断。N=1只有接受/弃权，不能声称在多个答案中选优改善。静态分数不认证步骤容量、业务覆盖、正确实现或交付。

特别保留研究/PM的未证实容量说法：五金额负例在两种前置状态下拆2个check就能≤20步，没有真实steps支持。以每负例fill金额＋click添加＋提示/数量/总额/小计四个分别断言的**示例布局**计，单状态五负例已有30数组条目，还未计合法其它字段重填、已有记录setup和内容断言。这不是所有合法布局的数学不可能证明，但足以否定该2-slot布局的容量自证；不能用研究4分或PM声称替代将来的真实数组计数及完整Verifier。

## 核验与后续

[receipt-files.json](receipt-files.json)记录18份公开原件的字节和SHA。evidence/manifest为原始下载artifact正文字节；API、观察请求是规范化快照，不是网络wire原件；run比evidence仅多一个LF、JSON相等。源码脚本以惰性`.txt`留证，未执行候选代码；profile/缓存、密钥/状态/私人材料均未归档。字节等同不是独立真实性证明，既有脱敏策略不认证未脱敏供应商原件。

独立逐调用账本重算7条usage与`(37555×0.30+7683×1.20)/1000000`吻合；费用、Token、调用及时间门限未耗尽，停止原因是共享修复耗尽。供应商账单、外层开发Token/费用、人工增效与机器费用unknown，不记零。

Node22下无需Key只读复核，不启动模型/浏览器/SDK或执行产物：

```sh
npx tsx --test tests/production-html07-evidence.test.ts
```

免费下一切片优先通用的角色闭集/完整JSON自检、去重短输出指引，以及独立setup/负例逐次结果的实际槽位容量反例；保留原Schema、12×20 Gate、完整需求与两次共享修复。只有新工程版本、审查、预登记和新单次授权后才再收费，不自动重试HTML07、不后验修原件。[本批审查](../../BATCH-HTML07-CHECKS.md)/[任务顺序](../../NEXT-STEPS.md)。
