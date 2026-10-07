# VERIFIER-WIRE-01：免费完整 SDK 请求捕获

源码：`7bc387fc88162ec7196ede59757ee7d4a25fe428`，开始时工作树干净。Node 22.22.3；2026-10-07 **13:49:09.911Z → 13:49:21.860Z，11.949秒**。SDK capture 合计9.899秒。源码33项hash前后检查点一致，并由独立外层开发Agent按git show复核；不是内部平台Agent自主交付。

18固定人工池、每池一个独立真实Harness SDK会话，访问固定假凭据的loopback fake provider。**18本地POST、0外部模型请求、实际供应商费用0**。fake响应的13输入/7输出Token只用于工程usage反例，真实模型Token、效果和费用收益都未测；机器/外层开发成本unknown。不是正式收费选优实验、认证测试或六角色开发。

## 实际结果与原件

39份JSON原文件逐字归档：初始[started.json](started.json)、18池intent＋18池capture、完整[proposal.json](proposal.json)及[receipt.json](receipt.json)。全部system/user/candidate内容、7字段完整wire和hash核对，不导出Headers/Key。独立审计重建提案逐字段全等，18 UUID无复用；source/config/request及capture文件hash血缘一致。

| 测量 | 结果 |
| --- | ---: |
| 完整wire最大 / 合计 | 30,671 B（H11）/ 486,836 B |
| 输入字节工程预留最大 / 合计 | 31,695 / 505,268 |
| 单次LLM输出拟限额 | 4,096 Token |
| 最坏36 LLM＋18 Jev的字节代理估算 | 0.496148640 USD |
| 上下文工程ceiling估算 | 0.890044416 USD |
| 待批准额度 | 1 USD |

“输入预留”是完整JSON UTF-8字节＋1024工程overhead，**不是已校准Tokenizer、实测Token或供应商计费上界**。费用为页面声明价乘工程预留；没有计费请求，不表示真的花费上述金额。Jev输出免费，但Token上界未知，不记成0 Token。完整提案仍fee-unapproved、ready=false；真实adapter/Token语义及本评估独立授权尚需完成。

| 原件 | SHA-256 |
| --- | --- |
| started.json | `62063fe8b2251d99b1ddebee933a972d6b8f46b692cfe1f332fa8b33c9ea7e14` |
| proposal.json文件 | `a74742261ef777f11f897f6cb731333b7a42d7d8ccb7e11d8c84e996ec2d86bb` |
| proposal内部逻辑hash | `4c98892e1b9c7e83fe6aeab43b2328ac808b264e3ee2a323bb9df2eccc79ac99` |
| receipt.json | `21d18816d6cd2376a425c30e2e13a5668bba77d7b32589e997a240fa81e47391` |

原receipt逐项包含18capture文件SHA。原目录是本机独立 `output/production-verifier-wire-pGbDFa`；这套归档供离线审计，不作为收费恢复/自动续跑输入。新设备依[预检说明](../../VERIFIER-WIRE-PREFLIGHT.md)从自己的公开设置生成新目录/UUID，不覆盖原件或重打旧hash。

## 其他尝试与范围

冻结源码前运行过一次免费诊断，保留本机 `output/production-verifier-wire-CcmT58`；当时source dirty，提案明确附source-worktree-dirty阻断。它不是同冻结配置的模型重复实验，不并入上述证据；也没有外部模型请求。

缺失usage、截断、HTTP拒绝、明确零usage和实际连接取消分别在免费工程测试中验证，不能将本成功capture推导为所有远程条件已测。固定ID不冻结供应商权重，hasApiKey不证明鉴权或轮换身份；未独立枚举SDK OS进程，也不声称容器/任意恶意脚本隔离认证。原18候选内部未随机、无答案缓存/改写/标签提示；三策略真实选优尚未执行。

旧模型探索、VERIFIER-PREP-01、VERIFIER-MOCK-01、已提交申报稿及公共v5没有改动。[批次工程/审查](../../BATCH-VERIFIER-PREFLIGHT-CHECKS.md)不计真实模型效果。
