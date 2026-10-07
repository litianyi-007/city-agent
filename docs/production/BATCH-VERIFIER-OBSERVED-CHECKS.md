# VE-04 原生观测适配批次审查

冻结实现：`3a1bedfa8369f2032bb3b943b393dfbeaee3a456`，独立 `feature/autonomous-production`。配置/边界见[契约](VERIFIER-OBSERVED-TRANSPORT.md)，旧申报稿、Pages v5、旧实验和其他 worktree 不变。

## 实际完成

单一 study 内核兼容旧 injected-v1；新 factory 品牌、官方端点/完整固定输入、原生 Harness/Jev、独立 running manifest＋先行 intent、逐请求实际 dispatch/响应身份/usage、两把 Key脱敏、一次冻结同意、39项实际源码 fresh checker、分引擎预留和未知/超限停止。增加无 live 开关的免费18池 CLI，不新增 API/页面收费启动、不迁移凭据。

旧代码与历史结论保留；关键文档更新前5份原文与 `eea8352` 逐字节核对5/5，后续更新根README也独立留底（共6份），见[archive](archive/2026-10-07-before-verifier-observed/)。

## specs-review 对抗审查及修补

固定质量、预算、security/server 三类独立审查；无 `docs/lessons/`，没有跨目录检索。外层建设平台的开发/审查 Agent 不是平台内部评审成绩。

| 复现问题 | 修补与验证 |
| --- | --- |
| Jev abort 的第二次 cancel 可在底层首次异步 cancel 未结束前返回 | 原生 reader relay 持有首次 cancel Promise；25 ms transport＋40 ms完整 runner反例，终态前等待清理 |
| 双 Key 属性脱敏重名，旧单 Key sanitizer 可提前隐藏冲突 | 在原始 Jev JSON和统一 redactor检查重名并拒绝；已知费用/dispatch仍保留，text=null不选答案 |
| 替换 LLM Key 后可能新合成含 `[REDACTED]` 的另一把 Key；数字/数组序列化也可能残留 | factory拒marker Key；字符串与最终完整JSON二次残留扫描，fail-closed非无限重写；纯内存反例通过 |
| 空回复失败时SDK规范usage为null，完整raw-wire usage却已报告13/7 | 失败/取消路径采用可信完整wire计账；成功仍要求SDK交叉匹配。empty/length/完整wire后teardown取消用例保留13/7，仍失败且text=null |
| source checker硬锁开发目录名会阻碍评委独立安装 | 根由模块URL确定，无caller路径；允许不同目录名的独立生产clone/冻结detached只读工程模式，real仍要求生产分支与clean |
| 仅usage complete不足以排除HTTP/绑定unknown | 成功响应另验 engine/source/pool/request/config/count及cleanup；失配保留观测并停止，不开始fallback |
| 初稿误称解压到新目录可直接Ledger.open | marker绑定原绝对目录scope；已改为原scope只读open、迁移包SHA与JSON链检查，统一归档导入工具另列后续，不修改原marker |

最终独立质量/预算与security/server复审无未关闭确定P0/P1/P2；不等于完整安全认证。安全反例只调用dummy loopback/内存替身，没有真实Key或供应商请求。

## 工程验证记录

首轮50项49通过，唯一失败是新测试错误读取不存在的 `events.jsonl`；实际账本v2是独立event/commit-marker，改为重新打开账本读取，不更改产品证据格式。首轮76.048秒。TypeScript发现新测试使用ES2023 `findLastIndex`，改为现有ES2022兼容写法，未提高环境门槛。

随后50/50专项77.042秒；审查新增两项安全回归后，冻结源码专项 **52/52、83.057秒**。没有跳过/取消。独立policy8/8、transport15/15、source5/5及security针对性5/5分别记录，不把重复运行计成独立模型样本。

独立安装验证：在本分支ignored output内 `git clone --no-hardlinks` 到 `city-agent-production-review`，不共享可写目录；Node22原生strip-types只读source模块。生产分支clean source成功、checkout该冻结commit detached工程成功、detached真实fresh拒绝，固定39文件一致。没有改主worktree/refs，没有安装或迁移Key。此检查不是新设备完整安装/模型鉴权证明。

完整[VERIFIER-OBSERVED-01](experiments/VERIFIER-OBSERVED-01/RESULT.md)在冻结源码实际完成：54决策/调用、36实际Chromium Oracle、267.672秒；36网络loopback POST＋18内存Jev dispatch，外部供应商请求0/费用0。真实模型usage/费效null。原始started/receipt及完整290事件账本压缩包留存，不重建响应。

独立只读[机器审计](experiments/VERIFIER-OBSERVED-01/independent-audit.json)：583原件（581账本文件＋started/receipt）完整链核验；最后决策seq217、首Oracle seq218；Oracle healthy36、实际16通过/20负例逐项匹配；usage、summary、freeze及39源码SHA重新计算一致，两把dummy凭据不在原件。A/B/C各8/18通过只属于固定回复演练。

最终全量Node **640/640、567.545秒**，无失败/取消/跳过；浏览器 **38/38、1.3分钟**。浏览器隔离4421和独立临时数据，含原有虚拟社会回归，未运行或停止别线服务。`npm run build`（TypeScript＋Vite）和`git diff --check`通过；仅有既有Zod注释提示。提交后另重建clean build stamp并仅重启无活跃任务的本线4420，避免旧boot身份冒充新源码。当前工程日志位于ignored `output/production-html02/observed-study-*`，不纳入供应商费用。

583原件文本扫描：实际Key常见模式和本次两把dummy凭据命中0。源码/文档按明确文件白名单提交，压缩包成员全部为run目录下581普通JSON，无链接/路径逃逸；三原件SHA、manifest/terminal/marker与独立审计匹配。秘密扫描不是完整安全认证。

## 未验证与下一切片

真实study HTTP/用户同意持久化入口、boot/构建新鲜度与页面Key轮换失效尚需接入；凭据 presence 不能当鉴权/轮换身份。当前导出的guard是可信控制面代码接口，不是远程用户权限系统；factory构造本身不代表获准付费。

归档跨设备可下载/解压读取并核验包SHA，但当前Ledger.open保留原目录scope约束，未实现迁移后的统一只读导入器；不能要求评委伪造原目录或重写marker来恢复运行。

真实Verifier效果、Jev省费、供应商账单、安装环境完整attestation、实体相机、任意生成仓库及泛化仍分开验收。1 USD是声明价工程估算停止额度、Jev4096仅事后观测、30分钟取消需等待清理。下一次收费配置须绑定新源码和明确用户额度，不沿用旧任务授权。
