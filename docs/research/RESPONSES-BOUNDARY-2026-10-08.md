# T27：Responses有界候选与独立审查报告

日期：2026-10-08，Node22.22.3，`feature/virtual-society-next`。用户确认继续后推进[已确认设计](../prd/F001-society-next/F001-responses-boundary-design.md)。这是本地工程候选，未激活API/UI，未提交/重新发布；main、旧Tag、L4/L5分支、原材料和两份closed实验账本保持不变。没有读取真实Key、实网模型调用、安装依赖或新增费用。

后续T29已完成：[四路取证验收](OFFLINE-SYSTEM-REVIEW-2026-10-08.md)504/504单测、19/19浏览器、122/122专项、双构建通过；完整日志与179历史/185源码起止见证保留。下文T27各轮数字和偶发失败不被覆盖；本次通过不证明旧失败根因已修复。

## 实施结果

- [增量文本SSE parser](../../server/research/responses-stream.mjs)：UTF8分块、CR/LF/CRLF、comments/multiline、多delta及可选in_progress；身份/索引/前序和末态文本一致性、唯一JSON属性、byte/event/depth帽。完整EOF前不释放text/usage；合法0与缺usage区分，缺失/矛盾/超限拒绝。
- [冻结wire与relay](../../server/research/responses-relay.ts)：完整17/18题schema、Prompt、model、输出限额及精确body绑定；持久预留包含全部body+1024 envelope。首attempt即耗尽调用，唯一转发、redirect:error、取消/超时，无纠正重试或fallback。子进程只持一次性localhost token，真实Key只留父进程。
- [真实DSH候选wrapper](../../server/research/structured-responses-harness.ts)与[plugin](../../server/research/structured-responses-plugin.mjs)：独立home/最小环境、host工具/llm-retry禁用、单dispatch；relay与adapter分别等EOF后验收。父进程独立比对wire/schema/raw/text hash、replay、SDK完整输入（非缓存input+cache）、total/reasoning及decoder。
- reservation保持pending直到child、relay和workspace清理结束，最终snapshot封存后再结算。取消、清理失败、迟到第二请求、SDK漂移、结构失败均停止账本并保留预留；不把缺用量结算成0。

答卷decoder只负责结构契约；conditional业务逻辑、资格和信息不足仍由独立研究审计负责。本候选没有将checked升级为研究/市场合格，也不修改旧数组答卷或旧评分。

## 明确支持子集

不再固定8事件或单delta，但仍是**已实现的文本研究子集**：sequence_number从0连续、created/可选一次in_progress、单assistant message和单output_text生命周期、终态completed。空annotations/logprobs可接受，非空、工具/refusal/reasoning输出事件、多项/多part、未知生命周期、failed/incomplete或终态之后的语义事件拒绝。usage要求完整input/output/total安全整数，cache/reasoning details可省略为0，显式不完整details拒绝。供应商合法但超出此子集的响应应失败，不暗中适配。

协议背景参考[OpenAI官方Streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)，本轮实际核对；固定DeepSeek目标来自[前批官方/SDK能力矩阵](HARNESS-CAPABILITY-MATRIX-2026-10-08.md)。本轮DeepSeek官方页读取超时，未据搜索摘要新增供应商能力结论。当前固定目标及schema关键字执行仍需T28实网登记验证，不能把OpenAI协议或本地夹具外推为DeepSeek支持。

## 独立审查与关闭问题

质量、安全和后端由非作者交叉审查，另有真实DSH故障注入。未找到`docs/lessons`历史经验；保留原B001，不删除受保护文档。

| 优先级 | 发现 | 修复及实际复验 |
| --- | --- | --- |
| P1 | provider response.id可回显Key，拒绝后的public witness仍会泄露 | 删除原始ID，只导出SHA；literal/escaped/前序ID后非法UTF8流回归均无Key |
| P2 | 超限原文可能把前缀hash当完整原文 | 语义invalid后仍hash完整有界流；字节超帽hash=null，不假称完整原文 |
| P2 | 预取消原因或误贴requestId可能泄露Key | 预取消静态错误、预留前检测已知Key标识；不落账、不启动 |
| P2 | 清理前success结算允许过早释放预算 | 清理阶段仍pending，并发reserve实际拒绝；清理故障返回受控错误/停止账本 |
| P2 | 清理期间迟到第二请求可能遗漏在成功快照外 | 清理后封存并对比snapshot；实际late POST409，上游仍1，调用失败且账本停止 |

修复后三个实现模块独立审查无剩余阻断。额外plugin内存攻击、cleanup/迟到请求故障注入和parser攻击不加算为注册测试条数。CLI质量审核确认未知参数、失败/超时/源码漂移在导出前拒绝；失败/漂移门控是静态审核，不冒充已做动态故障注入。

## 验证、稳定性记录与产物

- 专项：91 parser＋12 relay＋19真实DSH wrapper＝122/122；2条CLI回归纳入全套。五种SDK注入（total/cache拆分/reasoning/text/replay）分别拒绝，保留预算预留且仅一次上游fixture请求。
- 全套先486/486（25.48秒）；最终单独复验486/486（23.58秒），随后全套/CLI/Pages构建并行复验486/486（27.18秒）。本机双构建、TypeScript、diff检查通过。
- 浏览器19/19通过（报告器1.1分钟），使用独立临时数据库和合成Key/localhost，无真实API。
- 稳定性余项：全套/浏览器/CLI/构建四路并行时曾485/486（32.90秒）；该次工具输出截断，无法定位失败项。之后单独及三路并行均未重现。**不宣称已确定负载原因或修复这次偶发失败**；后续发布门保留完整全套日志再做同条件复验，不删除此负记录。

完整本机专项导出：`output/offline-review/responses-gYdsgJ/`，包括report.json、tests.tap、test-warnings.txt、historical-integrity.json；122/122、179历史文件及14关键源码起止hash一致，20,418.04ms包含审计与测试，不含导出。实网模型请求/Token/费用均0；测试内部usage/账本为模拟计数，不充当业务耗时或收费证据。报告最后写入，前置附件失败不留下通过标记。先前HnEYeN、D4fSfc和repository范围p3MkV1记录独立保留。

复现（已安装锁定依赖，Node≥22.19）：

```sh
npm run review:responses:offline
npm run review:responses:offline -- --local-full
```

默认只依赖42项仓库历史证据；local-full核验本机179项原件。命令不接收Key、endpoint或真实预算，只运行固定三个本地测试文件，模型测试及git子进程均剥离秘密环境。新目录wx导出，不修改历史原件。它证明客户端安全/协议工程，不证明供应商schema执行、CORS、偏好或市场效度。

## 下一步

1. 全套日志留底、四路并行工程复验已完成（T29）；下一次发布前仍用固定命令保留完整日志，不以丢失失败详情推断根因。
2. T28[最小真实能力探测草案](RESPONSES-LIVE-PREFLIGHT-2026-10-08.md)已整理：先完整两场景各一次，请求schema接受/本次答卷合规/关键字执行三层分别记账。故意违规control须独立安全协议另行授权，当前decoder不松绑；不能凭一次合规认定供应商强制。当前仍unknown，旧预算不续用。
3. 获新预算后先能力探测；通过后再独立确认两场景10＋10、规划/CORS及后续30人。规则保持完整，失败停止，不删约束、不重试/补样/换模型。
4. 再设计API/UI显式候选协议选择与已验证能力登记，默认旧路径不被静默迁移。现实桥、记忆/wiki/dream继续另阶段，不能替代现实资料或消费者校准。
