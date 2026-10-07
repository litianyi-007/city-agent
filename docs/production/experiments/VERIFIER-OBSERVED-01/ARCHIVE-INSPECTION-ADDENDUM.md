# VERIFIER-OBSERVED-01 归档清单补充

原始 started/receipt/ledger 压缩包与旧实验结果不改写。完整压缩包SHA仍是 `a1d171a2e9106327a0a4d758b5e32b3f1cdf0f159c514c538efa37ad8baed987`。

原生tar头检查补充：1746个header＝581个有效ledger JSON＋1个run目录＋582个PAX扩展头＋582个macOS AppleDouble元数据侧车。系统tar显示的582条有效载荷清单隐藏了元数据，因此旧“只含JSON”的归档描述不完整；原始研究运行文件583个（581 ledger＋started/receipt）仍成立。

新[只读核验器](../../VERIFIER-CONTROL-PLANE.md)不解压、不应用xattr或PAX属性，仅检查允许的mtime/provenance及对应元数据，再验证全部有效载荷和marker链。拒绝路径/链接/大小改写、未知扩展、重复/孤立文件和不完整确认。

目录scope取原marker记录值并检查全链一致，不替换成本机新路径。核验成功不认证来源真实性、不生成新的模型质量/计费数据、不恢复运行或重放调用。该补充是外层工程审计，不是新的模型实验。
