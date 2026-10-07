# 控制面实际页面免费演练

这是工程fixture，不是供应商模型、选优准确率或自主交付成功。新控制面通过实际本机页面准备、明确启动、观察终态；源码冻结`f93dbd2d9dfd1cbf20c45a5c650d84e4ee0dafdf`，没有与后续修复版本混为同配置实验。

控制面ID `e6214c9f-3063-4afd-a17c-fbc02502e19f`；原生ID `8c42fd10-ed6d-401e-b37c-1ab699aafa46`；freeze `db8239d0647af4837a16e62e0c5be056d1288e1a624a7a5731b1317be6db53c6`。

- completed，317.938秒，54决策/54调用意图，36实际隔离Chromium Oracle，290事件。
- [工程观测receipt](engineering-receipt.json)：36本机HTTP POST＋18内存Jev dispatch，外部供应商请求0。不能把54dispatch写为54HTTP。
- 5454输入/378输出Token、0.001469556USD是固定模拟用量/声明价，不是实际模型消耗；真实模型费用仅在本free工程范围为0，机器/外层开发费用unknown。
- A/B/C均固定首候选，各8行为通过/10失败，不是测量模型选择能力。
- [原账本包](run-ledger.tar.gz) SHA256 `d18da1d95aa0e47e0a7a05d5ba7451824fe20dd2b1d2ef76be54b9b9a897d9e8`；[只读核验](archive-inspection.json)通过，581ledger JSON、1164原生tar headers（含582PAX，无AppleDouble）。不重写原目录scope，不导入/恢复。

```sh
npx tsx scripts/inspect-production-verifier-study.ts --archive docs/production/experiments/VERIFIER-CONTROL-ENGINEERING-01/run-ledger.tar.gz --sha256 d18da1d95aa0e47e0a7a05d5ba7451824fe20dd2b1d2ef76be54b9b9a897d9e8
```

同源码全量Node发现macOS系统路径别名兼容问题（645/672，27启动失败），而此页面演练成功；两类证据均保留，不把局部成功代替全套。修复`eb83022`完整676/676 Node、45/45浏览器和独立路径审查见[本批记录](../../BATCH-VERIFIER-CONTROL-CHECKS.md)。此后[真实实验](../VERIFIER-REAL-01/RESULT.md)独立归档，不能将此合成结果晋升为真实模型成功。
