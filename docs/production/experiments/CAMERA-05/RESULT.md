# CAMERA-05：真实尝试与模板传输阻断

2026-10-07。一次本地浏览器从“新建自定义需求”输入并启动，runId=`b1a44700-26a2-4479-9aad-69891bfdf568`；干净构建与实际服务均为 `6c7fa4df9c9defd0f8f5bc7bbc39c556a5e12c93`。终态 **failed**，39.567秒；没有再次付费重跑。

## 实测进度与结果

- 产品、研究、项目经理候选通过阶段审查。研究员第一份JSON后存在多余内容，按原始错误反馈由同一研究员自主重生成；共消耗1/2次全局纠错额度，无人工改产物。
- 三次Jev均uncertain，分别升级一次独立LLM Verifier。候选reason实际251/186/182字符、总体reason80/50/59字符，严格长度/ID/分数协议通过；仅说明本次三阶段格式，不能证明判别准确率或通用效益。
- 测试角色请求的systemPrompt含反例字面 `{{particleCount}}`，Harness的personaPrefix模板解析器将其当变量并在模型POST前拒绝。它不是Tester生成了错误占位符，也不是Verifier/Gate弃权；是平台提示传输缺陷。
- 未生成测试候选、未冻结验收、未调用研发、未执行Gate、没有scene/可信预览。场景、视觉、实体设备、完整需求均未通过，不计真实良品。旧实验结果不覆盖。

## 调用、Token与成本口径

8次Harness调用意图，其中7次实际模型POST、最后测试意图实际POST=0；3次Jev真实POST。共 **10次实际HTTP尝试**，11条预算记录不等于11次付费请求。

已报告小计：输入61,317 Token、输出4,842 Token，按声明费率估算 **0.01776294 USD**（非发票）。最后Harness失败没有模型usage报告，原总账保持 **unknown**，不以观察到0 POST推造已报告的0 Token/费用；该小计不是替代总额。未知停止进一步调用，无隐藏重试。

## 版本与原始证据

本次Prompt camera v6、Verifier phase ordinal v4、compact-output-v1、acceptance semantic v2、coverage-owners-v1、camera acceptance v2、mandatory camera behavior v2、Jev candidate v3/request-layout-v2，Harness SDK0.1.5-rc.3。runtimeHash=`569a4a8326a5cdb528bfb99d7e550e8b598ba57528aa63c6f794f8e766143eaa`；Gate源hash=`9d4826052d66afe5a3e8e4bbb2a0278520439ebd90b9c9b549103e09fd1e4345`。

| 原始文件 | 字节 | SHA-256 |
| --- | ---: | --- |
| [run.json](run.json) | 329004 | `61cb1e48477e0bbf4bc28e7e53cf5e55bce01c5a0b70e258f3796c9dc91e0d8f` |
| [evidence.json](evidence.json) | 363206 | `c8c7c2f78ce5354e8dd7544fe1489344adea40f454ed59b13e360515589bf5d2` |
| [delivery-manifest.json](delivery-manifest.json) | 12632 | `958b3af5c977c91018e31000901595a4b95fff0b66f243b5ac930bf4b95a269f` |
| [platform-metadata.json](platform-metadata.json) | 3339 | `928e1e97361750456e0abe106e1b11c04a19ed73e11fa580e7efa8efaea7224d` |

文件按API原字节下载，完整原始Prompt/输出/阶段拒绝/纠错/Jev原响应和账本保留；秘密扫描通过，无Key。预登记 [PRE-REGISTRATION.md](PRE-REGISTRATION.md) 已先于启动提交。

## 下一步（新配置，不重解释本次失败）

先用真实SDK＋仅本地假provider验证系统提示无损传输：合法/非法变量字面、双括号、中文、内置变量样式均保持原字节且不递归解释，不降为user角色、不开放工具。已确认SDK无普通字面转义，不能仅替换一个示例来掩盖通用问题。修复必须记录独立transport版本并跑免费回归，下一次真实任务另开实验版本与预登记；本批不自动重跑。

CAMERA-01～05是五次不同工程配置探索，不是固定成功率实验。此前四次已知估算0.039796806 USD＋本次已报告小计0.01776294 USD＝已知小计0.057559746 USD，含未知的总成本仍unknown。完整/场景交付仍0；三Mock只证明工程链路。
