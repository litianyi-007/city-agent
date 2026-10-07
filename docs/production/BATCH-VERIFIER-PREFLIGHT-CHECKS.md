# VE-04：免费完整wire和费用提案批次

独立分支`feature/autonomous-production`，源码冻结`7bc387fc88162ec7196ede59757ee7d4a25fe428`。仅新增生产预检模块、CLI/测试与文档；未动原线目录/服务、main、冻结Tag、旧实验、申报稿或公开v5。5份现有文档按7bc387f逐字[留底](archive/2026-10-07-before-verifier-preflight/)。

## 本批实现

- 锁定真实Harness SDK→固定dummy-key loopback provider的完整请求捕获，不外呼真实模型。保留公开Base URL的SDK兼容语义，原system/user/candidates/nativeJSON/thinking参数和hash精确校验。
- 18池公开配置严格前检、参数白名单、独立会话，source/config检查点、先行fsync初始记录/intent、捕获/取消/失败留痕。
- immutable费率/请求/源码提案，工程Token/费用代理、1 USD待批额度；不提供live/授权入口，不套创建默认值、迁移Key或自动续跑。
- [39份免费原件](experiments/VERIFIER-WIRE-01/RESULT.md)，全部独立审计一致；远程Token/模型效益未知，0模型供应商费用不含机器/外层成本。

## 对抗审查

使用specs-review，独立code-quality、安全及server-reviewer；`docs/lessons/`不存在，已有传输/unknown/持久化边界按本线文档核对，未跨worktree查询。以下P2在冻结前修复，最终无未关闭P1/P2：

1. localhost替换上游URL丢失SDK兼容语义：公开URL只编码本地path，增加官方URL对照fake-fetch等值回归，不能外呼上游。
2. 公开配置缺失/ownundefined触发创建默认值：全关键字段显式存在且非undefined，首次SDK调用前strict parse。
3. 提案引用旧wire导致hash后可修改：deep-clone＋freeze，返回/保留引用突变反例。
4. nested秘密元数据/伪boolean/重复JSON键/额外填充/伪字节值：严格7字段及类型、固定SDK序列化、实际UTF8重测、完整body/hash比对。
5. 费用求和被命名为单池上限：分开whole-batch和max-pool，LLM61,440＋4,096满足本地65,536窗口。
6. 最后await后未再核来源：所有异步边界及报告前增加检查，只称检查点一致，Key轮换身份unknown。

最终独立纯预检7/7（质量1.565秒、安全1.556秒、服务端1.482秒），此前独立SDK8/8（6.824秒）。这些都是外层工程检查，不是内部模型评审成绩或安全认证。

## 验证口径

源码专项 **15/15，8.697秒**，TypeScript/diff通过；日志`output/production-html02/preflight-special-final.log`。正式免费18池capture **11.949秒**，18localPOST/0external、完整wire最大30,671 B，33source SHA、18capture SHA及39原文件由独立Agent逐项核对。

| 验证 | 冻结源码实际终态 | 本机日志 |
| --- | --- | --- |
| 完整Node工程 | **604/604，529.372秒**，失败/取消/skip均0 | `output/production-html02/node-full-preflight-final.log` |
| 独立4421浏览器 | **38/38，1.3分钟**，包含既有人口/问卷及生产工作台回归 | `output/production-html02/browser-preflight-final.log` |
| 专项 | **15/15，8.697秒**，完整wire及配置/预算/突变/秘密字段反例 | `output/production-html02/preflight-special-final.log` |
| 来源与归档 | 5备份逐字等于7bc387f、39原件逐字等于本机原文件 | 独立源码/原件审计及byte compare |

源码/测试5文件在7bc387f后未修改；回归期间仅补文档和归档。529文本文件秘密前缀扫描0疑似，39JSON字段扫描0非白名单；唯一`authorization:null`为显式未批准预算状态，不是凭据。扫描仅覆盖声明字段/可识别前缀，不识别所有opaque秘密。工程验证不计真实模型效果、收费用量、物理相机或新自主交付。

首轮免费诊断source dirty，不用作冻结结果，原件目录保留；审查期间各目标单测先后通过不当同配置稳定性实验。Jev输入协议的32k/64k单位是Token，仓库32,000/64,000是本地字节预检；费用/Token工程代理非精确Tokenizer。Jev没有vendor output limit，免费输出仍须观测usage；正式adapter与确认独立预算后才收费。

## 后续

下一免费切片完成真实study transport、按引擎预留、真实HTTP观测、精确Key脱敏和取消/unknown/半截/重启反例。随后确认1 USD/30分钟/4096输出及Jev响应后输出停止策略，重新冻结后一次执行VE-05/06，不返修候选、不重跑失败、不覆旧证据。公共v5不因源码推送而更新；HTML真实交付、实体相机、容器与受控仓库分别验收。
