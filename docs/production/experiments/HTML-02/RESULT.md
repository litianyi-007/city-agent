# HTML-02：新配置真实 HTML 单次探索

## 结果

2026-10-07，从本地 `http://127.0.0.1:4420/#production` 点击“新建自定义需求”，填写[预登记](PRE-REGISTRATION.md)的原话、来源、验收与1 USD有限预算后，仅启动一次真实任务。没有demoCaseId、模板源码、外层断言注入、手改候选或临时改Gate。它是用户授权自拟题，不是实际业务工单。

运行 `850135e8-7993-424d-8ee2-ee384a7c32fd` **failed**。源 `b6413d472ec25484a36101caff59b00cca5580d3`，干净构建 `10:35:42.972Z`，实际新进程启动 `10:36:20.245Z`、bootId `f8e6dd51-8943-4db4-83cd-c6ae616f2973`。原metadata及run的boot/source/build指纹一致、ready=true/无issues；这仍是磁盘身份，不冒称缓存模块字节或OS隔离。

创建 `10:37:24.092Z`，结束 `10:38:01.025Z`，原记录耗时 **36,766 ms**。HTML Prompt v9、execution-v1、review-context-v2、boot-disk-v1；新身份门禁已真实接线，但任务没到HTML实现或返修评审，不能据此证明执行事实/上下文修补带来交付提升。

产品候选经一次Jev算术异常升级独立LLM而选中。研究角色三份输出均被JSON语法拒绝，两次共享stage-regeneration自动纠错后耗尽2/2上限；没有记录中途人工介入。没有项目经理、测试或研发调用，没有冻结验收或Gate，只有manifest/evidence，无可交付HTML。未启动额外付费重跑。

## 缺陷与证据边界

三份研究原文均在observations及constraints数组结束后多一个双引号，形如 `]","constraints"`，首次Node JSON.parse位置为1816、1843、1891（UTF-16代码单元位置，不是UTF-8字节）。输出保留完整收尾且用量低于6000输出上限；这不是“格式合法但Verifier不喜欢”。合法池为空，评审不对非法研究候选外呼。

独立静态诊断仅在内存验证多余引号位置：第二份即使语法问题消除，observations仍为13项、超过原max12。因此不能删除引号后当作合法候选，更不能放宽数量、自动修JSON或追认本次成功。三份原始输出和全部失败仍原样保留。

5条Harness记录均观察到 `response_format=json_object` 原生请求模式；它只证明请求参数，不证明响应JSON合法。[DeepSeek官方JSON Output指南](https://api-docs.deepseek.com/guides/json_mode/)要求明确JSON提示/示例与合理输出上限，不能替代宿主实际解析。本次没有保存独立原始wire正文，不能直接认定供应商违约、SDK篡改或某一层是唯一原因。后续可增强仅hash/长度的响应来源核验，仍不留密钥或私密正文。

## 调用、费用与原字节

**5 Harness + 1 Jev = 6实际HTTP POST**，6条预算记录，19,546输入 / 5,448输出Token；原总账complete=true、估算 **0.011305110 USD**。Harness 16,041/5,288、0.011157900 USD；Jev 3,505/160、0.000147210 USD。价格取页面声明的Flash输入0.30/输出1.20及Jev输入0.042/输出0 USD/M，不是供应商发票。Jev一次arith fallback并未省去LLM；N=1不证明多候选选优或高性价比收益。

| 原档 | SHA-256 |
| --- | --- |
| run.json | c67b9ab2b8d0046f6573e541a5f828a16b110bba65c4f4ac9734dbe160bc491c |
| evidence.json | 390efb68be240ee5420b5cdc197e43afcbef0bf5b3ce6d15c3278a83f34c6cf4 |
| delivery-manifest.json | 9d34160e55da60714f741a9298e298f52f8963f4951d397fdb6a010c4a6984b1 |
| platform-metadata.json | edaf5ff7875cdf5217b02216ddd6b90cc49d523890f7363f8b4e24d3fed779cb |

四份为API/启动前metadata原字节。纯历史专项 `tests/production-html02-evidence.test.ts` **7/7，520.484ms**，验证来源、原SHA、2次返修、非法候选、无Gate/源码及完整费用；无新HTTP/SDK/浏览器，不是新的模型试验。运行前480项工程/38项浏览器回归见[BATCH-HTML01-CHECKS](../../BATCH-HTML01-CHECKS.md)，不能当本次自主成功。

## 下一步（新源码，不改历史）

免费实现绑定原调用/候选/SHA的精确语法诊断和小片段，纠错提示区别数组/字符串与maxItems；仍重生成完整候选，不自动修JSON、增返修次数或删除业务要求。Jev unknown停止保留原决策失败原因，避免把本地容量拒绝只描述成供应商漏usage。工程对照和未来真实结果分列；下一次真实任务须新编号、冻结配置及明确单次预算，不自动追加本次额度。

公开v5材料仍固定967bbba，只含截至CAMERA09的旧快照，本次HTML02不属于该材料。HTML01失败、CAMERA09有界场景成功和申报基线不改写；两条worktree不合并。
