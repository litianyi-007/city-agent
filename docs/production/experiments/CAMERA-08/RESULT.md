# CAMERA-08 实测结果

2026-10-07，本地编辑器一次真实启动 `1a6231d6-9ebb-466a-879c-6381b6adffcf`，干净源码 `0d62ff08b870627872f851ef5153e527e410eea8`，终态 failed，57.688 秒，共享返修 2/2。完整报告估算费用 **0.030952776 USD**，采用页面声明费率，非供应商账单。没有外层修改产物、模板回退、Gate 放宽或实体摄像头授权。

## 阶段进展与停止原因

产品通过；研究首次缺 constraints/unknowns，原研究角色自主纠错，消耗第一次共享返修。项目经理本轮合法 proceed，因此虽记录 planning-loop-v1，不能宣称真实再规划路径已通过。测试首次将固定合成状态和按钮语义混为实体设备状态，被语义预检拒绝；原测试角色完成第二次纠错，后续候选通过结构、语义和 CSS 预检。

最终 acceptance 独立 LLM Verifier 返回 226 输出 Token，reason 内含未转义引号，严格 JSON 解析在 position 456 失败。不是输出截断，也不是 Jev 容量拒绝。系统原样保存输出，记录 abstain 并终止：`acceptance Verifier 校验失败，未默认为通过`。没有冻结验收、研发、最终行为 Gate、场景或运行预览；候选上的“accept”文字不等于有效通过。共享两次已耗尽，不人工修补 JSON、不增加隐形重试。

本轮两次真实角色纠错已进入职责投影路径且未再触发容量拒绝，只证明这些实际请求适配，不保证更长输出。下一工程切片调查 Harness 原生 JSON/结构化响应传输，不把解析宽容或文字修复当质量改进。

## 实测账本

| 指标 | 结果 |
| --- | --- |
| Harness 意图 / 实际 POST | 10 / 10：角色生成 6，独立 Verifier 4 |
| Jev 意图 / 实际 POST | 4 / 4 |
| 总预算记录 / 实际 HTTP | 14 / 14；无未知 HTTP 或 usage |
| 总输入 / 输出 Token | 106,043 / 7,768 |
| 总估算费用 | 0.030952776 USD |
| Harness 输入 / 输出 / 费用 | 69,565 / 7,126 / 0.0294207 USD |
| Jev 输入 / 输出 / 费用 | 36,478 / 642 / 0.001532076 USD |
| 有界场景 / 真实视觉 / 实体设备 / 完整需求 | 均未通过或未验证，不计完整良品分子 |

四次 Jev 为 uncertain 两次、当前客户端判定 arithmetic-drift 两次，均升级一次独立 LLM，本轮没有省去复核。派生算术一致性采用本地精度假设，不直接定性供应商计算错误。每运行总费用已经包含自身 Jev，不重复相加。CAMERA-05/06 历史总费用仍 unknown，不能用本轮完整计量倒填；不同工程配置的八次探索不是固定配置稳定性实验。

## 原始字节证据

| 文件 | SHA-256 |
| --- | --- |
| [run.json](run.json) | `bf1c660970d3fb83f3f093365161f2524b2a63ab7749c9b2021bd193b2cbafb2` |
| [evidence.json](evidence.json) | `0f68761b2ab307258755ceb7f350c564c61afa48ca1af6f674fca7d3aaa1c70e` |
| [delivery-manifest.json](delivery-manifest.json) | `d53939e81473471a4ea1a1158bef58fb6a0c513253ec797f4a64415b22962be8` |
| [platform-metadata.json](platform-metadata.json) | `e32d306cc839351cdc014a73a77c8798356206c15e94ee44733d38650e7aea2b` |

由终态 API 原字节下载，不重新生成或改写。预登记与该次运行保留自己的源码、Prompt、验证契约版本；之后平台修订另开版本与实验。
