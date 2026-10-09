# HTML09：进入验收计划，原文引用失败

2026-10-09，本地 `http://127.0.0.1:4420/#production` 真实前端只启动一次，run `9f37b05e-3900-45c2-8dad-0bf82eb03ae7`，结果 **failed**。PM 已明确 `proceed` 释放后续验收构建，但三份验收计划均改动同一处原文引用标点，严格源绑定拒绝，耗尽两次共享返修。未进入 tester、研发、冻结或最终 Gate，完整自主交付 0/1。

## 配置与实测

| 项目 | 结果 |
| --- | --- |
| 实验源码 | `c74d723a4dd5e5f3830d5446ace559f1df713f77` |
| boot | `8482bed9-3eb7-49c8-b980-e911296dda6c` |
| 配置 | live / offline-single-html / llm-rubric / N=1 / legacy / planned-groups-v1；grouped v5 / phase-readiness-v1 |
| 模型 | 六角色配置 DeepSeek `deepseek-flash`，实际调用产品、研究、PM、Verifier；tester/研发未调用 |
| Harness / 观测 HTTP | 9 / 9，全部 HTTP200、complete；Jev、注入、未知用量均0 |
| 输入 / 输出 / 总 Token | 60,282 / 13,291 / 73,573 |
| 声明价估算 | 0.0340338 USD = `(60282×0.30 + 13291×1.20)/1000000`，不是供应商账单 |
| 时间 | 管线69,090 ms；创建至完成69,273 ms，起点不同 |
| 返修 / 介入 | 2次 stage-regeneration；账本 interventions=[]，不排除外层平台开发/归档工作 |

实际限额未变：24逻辑调用、500000总Token、单次6000输出、600秒停止触发、2次共享返修、1 USD声明价估算停止、unknown立即停。失败原因是返修耗尽，不是费用不足。单次授权已使用，没有第二次付费运行、Jev/Hopper调用、模板回退、外层修改产物或降低 Gate。供应商最终账单、外层开发Token/费用、机器成本为 unknown，不填0。

## 单次授权与页面证据

[授权记录](authorization.json)保留用户实际原话“推进下一步”，并明确这是紧接 HTML09 单次1 USD询问的上下文解释，不是伪造另一句结构化“批准”。边界在启动前向用户重述；预登记内容来自该源码提交中的 [docs/production/HTML-09-PROPOSAL.md](https://github.com/litianyi-007/city-agent/blob/c74d723a4dd5e5f3830d5446ace559f1df713f77/docs/production/HTML-09-PROPOSAL.md)；[本归档副本](PRE-REGISTRATION.md)的路径在运行后建立，[授权核验](authorization-checked.json)绑定提案/输入 SHA。对话记录不是独立签名。

[输入快照](input-snapshot.json)、[实际浏览器请求](actual-browser-submit.json)和 [run.input](run.json)一致，brief与完整八项验收和HTML08逐字符相同；来源仍为 illustrative，自拟演示需求，不是业务工单。未传入手写工程见证、旧答案、checks或HTML。

本分支自有 Playwright 使用独立 profile 操作真实本地页面，不使用用户浏览器profile、SDK注入或 `route.fulfill`。[点击前意图](launch-intent.json)先独立持久化，仅1个启动POST/1个202，库存24→25。[UI回执](ui-receipt.json)与[启动前](ui-before-launch.png)/[终态](ui-terminal.png)截图记录平台执行，不是最终产品截图或成功视频。原profile不归档。

[免费预检](launch-preflight.json)ready/fresh/startupGuard.ready均true、0模型请求、paidAuthorized=false、finalGate=null；干净commit/build/boot和六角色脱敏配置有源。ready不是收费许可或成功。归档在运行后进行，不把归档时间冒充预先提交时间。

## 原件归因

实际链路：产品→付费Verifier→研究→付费Verifier→PM think-design `proceed`→付费Verifier→acceptance-plan→宿主拒绝→两次计划重生成→失败。只有前三份合法阶段候选调用了LLM Verifier；三份非法计划的“Verifier弃权”是空合法池的宿主拒绝记录，不是另外三次付费评审。

三份计划都可 JSON.parse，且通过实际 acceptancePlanSchema，但第7条 `obligations[6]`（ID OB-07，source=acceptance）把原文“输入拼接；”改为“输入拼接。”。quote的UTF16索引51/原文索引295处从U+FF1B变成U+3002；严格连续子串检查失败是正确行为，不能统一标点或自动修好放行。其余引用本次均匹配，不代表义务覆盖和槽位容量已验证。

旧反馈只有 `plan-source-quote`；结构诊断对这类“schema合法、语义引用非法”的候选返回undefined，缺少具体失败条目定位。三份原文SHA依次为：

```
7479fa61304f249334bcf1a046a2a1628f95373785f2f53308f8349c6fd69c5b
c6ba526401443343c56cd3498ca90eb6aebaae59f17678bb3e99a4408dcabd71
61f60ef36d5a04ff03a6fb73533ded85445817b77b6a3e8263314320c458527e
```

阶段准入的旧卡点本次跨过一次，不证明稳定性或节费。计划仍有多个负例塞入20步等未经实际checks展开的声明；修好引用也不保证后续容量、覆盖或交付通过。9个HTML探索配置不同，不能合并为同一冻结配置成功率；本次比HTML08便宜/快也不能归因为v5增效，失败阶段不同。

## 免费核验与后续

[字节索引](receipt-files.json)保留17份原件，API/请求是规范化快照，evidence/manifest为实际下载字节；driver以惰性文本留证。字节一致不是独立真实性签名。原始失败不改写为新版结果。

```sh
npx tsx --test tests/production-html09-evidence.test.ts tests/production-acceptance-source-diagnostics.test.ts
```

[下一配置的免费修复](../../ACCEPTANCE-SOURCE-DIAGNOSTICS.md)：仅增加失败索引/source/hash和严格引用提示，返修前重算来源绑定；不提供正确引用、不放宽parser或Gate。grouped v6尚无真实模型效果，须另获新单次预算才能验证，不继承本次剩余额度。
