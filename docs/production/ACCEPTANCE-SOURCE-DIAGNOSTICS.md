# 原文引用诊断：grouped v6

## 动机与边界

[HTML09](experiments/HTML-09/RESULT.md)三次合法结构计划都改动同一原文标点；严格拒绝保留，旧反馈未定位失败条目。本切片只提高通用诊断的可操作性，不修模型答案、不增加调用、不证明交付或节费。旧v1～v5、legacy、camera提示及验收Schema保留原字节。

新增 `production-acceptance-source-diagnostics-v1`：仅完整JSON/完整围栏可解析、实际 acceptancePlanSchema 合法且至少一处 quote 不是其source原文连续子串时返回。字段只含version/phase/kind、callId/candidateId、完整raw UTF8 SHA、实际outputContractHash、brief/acceptance SHA、mismatchCount及最多24个 `{obligationIndex,source}`。索引从0开始；不包含quote、原文片段、义务ID或修改后的答案。undefined不是通过。

模块纯函数，不读文件/Store/Key，不调用模型；拒绝Proxy、getter、额外/非数据字段、坏绑定，raw≤128KiB，brief≤6000/acceptance≤3000 UTF16，另验UTF8边界。完整围栏语法同现有parseJson，不抽取合法前缀、不统一空白/Unicode/标点。数据深冻结；控制面落盘前仍走现有脱敏。

## 编排与安全

1. 严格 `parseAcceptancePlan` 仍先拒绝；结构错误/语法错误沿用原诊断，不被source诊断冒充。
2. grouped-only PM acceptance-plan 将安全诊断附在真实call与返修反馈；每次后续请求前，核对call/反馈原文SHA、诊断深相等，并从原始raw、完整run.input和实际schema hash重新计算，篡改则在下一模型请求前失败。
3. 共享全局返修上限仍2；合法候选仍须独立Verifier、实际分组检查、冻结和最终Gate。没有“quote正确即交付”的捷径。
4. 新 `production-html-grouped-v6` 仅在验收计划提示增加179-byte严格引用/零基定位说明。完整提示纳入启动和免费预检同源秘密碰撞守卫；原六种凭据长度、工作阈值不扩大，不裁掉尾字节。
5. 新字段均optional，旧run/archive无需迁移。旧协议literal数组原样保留，新增literal单独保护，历史凭据碰撞仍失败关闭。固定研究源集v10只在旧55项末尾追加诊断模块，共56项，不是全导入图/主机真实性证明。

## 验证与限制

纯单测包括18项（含HTML09三raw只读重放）；原件仍 `plan-source-quote`，只新增位置解释。编排回归明确使用test-owned候选/用量和注入角色，不进入真实成功统计；其中行为Gate如运行真实Chromium，也不改变候选是夹具的事实。

首次较长提示901-byte触发原碰撞扫描100000工作限额，工程回归失败；最终新增提示压缩为179-byte，旧计划8114-byte不动，当前完整8294-byte经原六种长度守卫验证，不提高阈值、不拆掉检查。独立审查还捕获启动循环旧变量名，已统一当前SOURCE_BOUND完整提示。最终结果以[BATCH-HTML09-CHECKS](BATCH-HTML09-CHECKS.md)为准。

原费用页工程见证仍只在tests，不进入模型Prompt/预置答案。下一步真实试验应先干净commit/build/boot与免费预检，再独立确认有限预算，全部尝试入账；本切片没有新增HTML10授权。
