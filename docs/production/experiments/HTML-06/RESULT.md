# HTML-06：真实前端单次启动，首模型调用前停止

北京时间 2026-10-09 02:41:16，实际本地需求编辑器提交一次费用记录页需求。终态 **failed**：`评估凭据碰撞检查超限，请精简配置`。未发出模型请求，不是模型质量失败，也没有自主交付产品。

| 口径 | 实际结果 |
| --- | --- |
| Run ID | `6bd95961-4dca-4378-9d2b-ead8befdb36e` |
| 启动源码 | `fba3731f373d690b6792b01beb62f1e7d4337d3a`，干净构建/boot身份已绑定 |
| 实际页面提交 | 1 POST / 1 启动响应；历史运行数 21 → 22 |
| 管线计时 / 创建到终态 | 286 ms / 536 ms；不同计时起点，不是互相矛盾的耗时 |
| Harness / 供应商 HTTP / Jev | 0 / 0 / 0，调用意图 0，未知调用意图 0 |
| Token / 声明价模型费用 | 0 / 0 USD；没有模型请求。外层开发 Agent 用量与成本未统计 |
| 自动返修 / 人工改生成产物 | 0 / 无生成产物可修改 |
| 产品、研究、PM、测试、研发、Verifier | 配置已选择，实际角色输出均 0 |
| plan / groups / steps audit / freeze / Gate | 均未到达；八项业务要求全部未测试 |

## 输入、授权与版本

[提案](../../HTML-06-PROPOSAL.md)在上述源码中已经提交；用户后续原话为“继续下一步”，本次将其解释并告知为对该具体提案的单次有限同意。保存[会话记录](authorization.json)，不把它写成独立签名或供应商账单硬上限。仅本次提交，0 消费也不会恢复一次启动授权；没有自动追加或重跑。

六角色均选页面现有 `deepseek-flash`，声明价输入 0.30 / 输出 1.20 USD / 百万 Token；LLM Verifier、单候选、无 Jev、`legacy`、`planned-groups-v1` / grouped v3。上限：24 逻辑调用、500000 总 Token、6000 单次输出、600 秒、2 次共享返修、1 USD 声明价估算停止阈值，unknown usage 停止。原 HTML04/05 的八项业务、12项/20步 Gate 不变。

[输入快照](input-snapshot.json)与[实际观察到的浏览器提交](actual-browser-submit.json)、持久化 `run.input` 完全相等。[点击前意图](launch-intent.json)和[授权核验](authorization-checked.json)的输入 SHA 使用 `JSON.stringify` **规范化输入对象**，不是原文件字节或网络 wire 字节；对象键序会影响此 hash。提交记录是规范化观察，不宣称保存了 HTTP 原始报文。

## 失败证据与归因边界

[免费预检](launch-preflight.json)曾返回 ready、0模型请求，但当时仅检查请求/报告及公开配置，不检查启动所有固定指令材料。真实启动随后在守卫中被拒绝。它从来不是收费授权、启动令牌或最终 Gate；本次暴露了预检与启动材料不一致的可用性缺陷。

源码显示旧守卫逐加密凭据代际重复扫描/加密公共窗口，且含当前与历史 Agent/Jev 快照。错误原文只能证明工作量门限触发，**不能据此确定实际私有凭据数量、长度、哪个指令包，或断言发生了凭据碰撞**。后续修复仅用合成配置复现，不读取实际 Key、加密主密钥或私有状态，不删除历史快照、不放宽 Gate。

`evidenceKind=real-model` 表示真实模式启动尝试，不证明模型实际执行。它计入全部启动尝试账本，但不作为模型格式/质量或分组策略成功率样本。`usage.complete=true` 是空调用集求和；独立用量账本 `entries=0 / knownSubtotal=null` 表示没有供应商用量行，不是未知请求或伪造零用量行。

## 原件与只读复核

- [run](run.json)、[原始下载 evidence](evidence.json)、[原始下载 manifest](delivery-manifest.json)、[字节清单](receipt-files.json)。两个下载文件保留完整原字节，其他 API JSON 明确为规范化快照；hash/字节一致不构成独立真实性签名。
- [实际 UI 收据](ui-receipt.json)、[启动前截图](ui-before-launch.png)、[终态截图](ui-terminal.png)。启动前截图下方展示旧 HTML05 历史，终态截图明确选择 HTML06 failed。
- [可信自动化源码（惰性文本）](ui-driver.mjs.txt)：实际表单填写/点击，不注入 SDK 或 route fulfillment；仅 loopback 浏览器请求，不渲染/执行生成 HTML。CUA 的 in-app browser 不可用后采用本分支自有 Playwright；不由此推断所有浏览器不可用。浏览器私有 profile、Key、数据库不导出。

在独立 worktree 使用 Node22：`npx tsx --test tests/production-html06-evidence.test.ts`。这是免费只读核验，不调用模型或重启实验。后续工程补丁不能改写本次失败、源码身份或原始收据。
