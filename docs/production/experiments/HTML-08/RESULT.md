# HTML08：结构输出通过，前置规划阶段依赖循环

## 本次唯一真实尝试

2026-10-09，通过本地 `http://127.0.0.1:4420/#production` 实际填写原费用记录需求并仅点击一次“启动真实生产”。Run `966fc3b9-1308-4e19-832f-ea4960fb07f2` 为 **failed**：三轮产品、研究员和项目经理均返回合法结构，但 PM 三次 `revise` 要求尚未产生的具体测试契约，耗尽两次共享返修。没有进入测试、研发、验收冻结或最终行为 Gate，不计真实自主交付成功。

| 实测项 | 结果 |
| --- | --- |
| 实验源码／boot | `f21256f8fe280b619c295ec17842fdc941b36545` / `e46b7f26-3512-4d33-aaa4-04d4b5449491` |
| 实际模型 | 六角色配置均 DeepSeek `deepseek-flash`；仅产品、研究、PM 与 Verifier 实际调用，测试／研发未调用 |
| Harness／观测供应商 HTTP | 18 / 18；全部真实调用，Jev 0、注入 0 |
| 输入／输出／总 Token | 166,317 / 13,317 / 179,634；用量完整，未知条目 0 |
| 声明价估算 | 0.0658755 USD = `(166317×0.30 + 13317×1.20) / 1000000`；不是供应商账单 |
| 耗时 | 管线 102,991 ms；创建至完成 103,209 ms，起算点不同 |
| 自动返修／中途介入 | 2 次共享返修；`interventions=[]` 仅表示运行账本没有中途人工操作，不排除外层平台开发和归档工作 |
| 本配置完整交付 | 0 / 1；不与 HTML01～07 的异配置探索合并为稳定成功率 |

本次限额为 24 逻辑调用、500000 总 Token、6000 单次输出、600秒停止触发、2次共享返修和1 USD声明价估算停止。停止原因是共享返修耗尽，不是 Token、费用或时限耗尽。剩余估算额度不授权第二次；没有自动重跑、模板回退、人工修改产物或放宽 Gate。供应商最终账单、外层开发 Token/费用与机器成本为 unknown，不填零。

## 授权、输入和真实页面证据

[授权记录](authorization.json)对应用户本次明确回复“批准仅这一次，采用1 USD限额”，不是继承旧预算，且不是独立签名。完整提案原字节见 [PRE-REGISTRATION](PRE-REGISTRATION.md)，原文在运行前已提交于 [f21256f](https://github.com/litianyi-007/city-agent/blob/f21256f8fe280b619c295ec17842fdc941b36545/docs/production/HTML-08-PROPOSAL.md)；其中“待授权”是当时预登记时点，随后本次新同意和终态以这里的授权／结果为准。

[输入快照](input-snapshot.json)的原 brief 与八项验收和 HTML07 逐字相同，仅编号、来源和配置背景更新。来源为 illustrative，不是业务工单；无模板、旧模型答案、预填 checks 或生成源码。live / offline-single-html / llm-rubric / N=1 / legacy / planned-groups-v1；grouped v4 与 output-envelope v1，原12项×20步及共享返修限额不变。

浏览器插件返回不可用，采用本分支自有 Playwright Chromium 操作真实前端；没有 `route.fulfill`、SDK 注入或 Mock 答案。[单次点击前意图](launch-intent.json)先以 `wx` 持久化，实际观察到1个启动POST／1个202，运行库存23→24；第二POST被驱动阻止。实际请求、授权输入和 run.input 相等。浏览器仅访问回环4420，外联拦截计数0只是本次观察，不证明任意生成代码安全。

[免费预检](launch-preflight.json)记录干净 commit/build/boot、公开六角色配置、完整版本和 reportHash：ready/fresh/startupGuard.ready 均为 true，modelRequests=0、paidAuthorized=false、finalGate=null。ready不是收费授权或成功。原件归档在终态后进行，不把归档时间冒充运行前提交时间。[启动前](ui-before-launch.png)和[终态](ui-terminal.png)是平台UI截图，不是产品截图或3–5分钟真实交付视频。

## 原件归因

实际链路为 `产品→Verifier→研究→Verifier→PM revise→Verifier接受当前规划`，重复产品/研究/PM两次后仍 `revise`，宿主因全局两次修复耗尽停止。18份调用原文均为合法JSON，9份非Verifier产物通过其实际Schema；6份研究/PM导航与3份PM policy绑定实际完整Schema。与HTML07错误不同，本次没有JSON语法或额外字段拒绝；一个样本不能证明结构可靠率提高。

PM要求普通CSS选择器、节点层级与逐组实际steps核算先落实再 `proceed`；任务中将checks构建分给tester，但管线只有PM `proceed` 后才启动验收规划/测试，`revise` 分支只重跑product/research/PM。因此存在阶段准入边界不清与未来产物依赖错配。不能后验把旧PM `revise`改为`proceed`，也不能用强制放行代替修复职责契约。

研究后两轮还声称负例组约11/13步，却没有真实steps数组。五次负例若每次 `fill+click+数量+总额+小计` 已需25条，尚未包含提示、setup和其它字段重填；这些自述不足以证明≤20或业务覆盖。PM的“12组”也不能代替实际“最多3组、总计2–12 checks”的计划Schema。阶段职责修复不能豁免这些真实容量问题。

9次付费LLM Verifier均接受当前候选；N=1仅接受/弃权，不证明多答案选优或节费。静态Verifier没有解决上述容量证据不足；接受分数不是测试、研发或交付通过。run.frozenContract、run.gate、run.acceptanceConstruction 均不存在，全部八条业务实际未测试。

## 免费复核与下一配置

[receipt-files.json](receipt-files.json)索引18份原件及字节SHA。evidence和delivery-manifest为实际下载正文字节，API/请求是规范化快照；driver/preparation以惰性文本留证。没有归档浏览器profile、密钥、私有数据库或模型生成程序。字节一致不等于独立真实性签名。

无需Key、模型、Jev或执行生成产物的只读复核：

```sh
npx tsx --test tests/production-html08-evidence.test.ts
```

下一步仅免费修复：新版本明确PM初始规划、未来验收构建、研发前冻结及行为Gate的职责与依赖；保留真实范围缺口拒绝、容量门限、旧输出和全部失败。本次授权已消费，新版本真实实验须另获一次明确预算，不能自动追加。
