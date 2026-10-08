# 实际步骤事实与完整评审契约

2026-10-08；基于 `4c3feaa7aea6dc2d55521071f75c5dea90ae9922`。仅显式 `planned-groups-v1` 策略的新运行使用 `production-html-grouped-v3`；旧 grouped v1/v2 导出、计划/组/构建 v1 Schema、严格四字段 Verifier、原12项×20步与两次全局返修均保持。

## 事实层与语义层

宿主 `production-acceptance-step-audit-v1` 从本轮真实原组、计划与无损拼接 checks 派生，不调用模型、不修改候选。每个 slot 保留原顺序、group/check ID、obligation 引用、stepBudget、实际 `steps.length`、全部 actionKinds，以及零起点断言/精确动作/操作索引。`assertChanged.after` 内 fill/click 记为同一索引的 embedded 操作，仍只占一个外层数组元素。精确动作仅指 `assertTextExact` / `assertCount` 类型，不认证其业务含义。

审计绑定 planHash、attemptId、compositeCandidateId、checksSha256 和成功组的实际 call/candidate/raw/value hash；仅输出机器元数据，不复制 selector/value/提示原文。纯 builder 检查结构、计划/组/无损拼接和 hash；真实原文与调用身份由 pipeline 对原始调用核对，不以“64位字符串合法”证明供应商来源。保存独立 stepAuditSha256，预检/完整 Verifier 前后均重算，不允许删除、换索引或仅篡改后重打 hash。

| 可机器核验 | 不能据此认证 |
| --- | --- |
| 实际19步不是PM声称的14步；21步仍由原 Schema 拒绝 | 所有明确业务条件是否测到、预算是否足以表达全部要求 |
| 操作和断言确在当前数组的这些位置 | setup 有效、其它字段合法、跨项已有状态可复用 |
| assertTextExact/assertCount 类型存在 | 是否只测提示/输入、CSS别名是否指向同一输入、断言业务正确 |
| 所有计划义务被 slot 引用 | PM 是否遗漏了原需求的某个状态、边界或负例 |

不能给审计加 `coveragePassed` / `businessProven` 真值。合法初态或静态 check 不强制点击，不能为每槽一刀切增加操作。

## 一次完整 Verifier，与原 Gate 分工

`production-acceptance-review-projection-v1` 保留完整原 brief/acceptance、完整计划与唯一完整候选。评审 context 的 groups 仅投影来源 ID/hash；完整 checks 在 candidates 中只传一次，归档仍保留原组全文。请求60,000 UTF-8字节、Verifier响应32,000字节上限不变；超限失败关闭，不截断需求/候选或提高上限。12×20的紧凑合法夹具验证可容纳，不承诺任意最大长度字符串也可容纳。

完整 Verifier 必须按原需求直接审查全部实际 steps，而不是仅核对 PM 的 obligation IDs 或 audit 索引。多负例×前置状态要分别建立状态与其它合法字段，并逐次验证要求的内容、统计、数量及提示；一次最后总计不能证明此前各次拒绝未改记录。缺条款、状态混淆、跨 check 借状态或证据不足须低于3并弃权；输出仍仅 decision/selectedCandidateId/scores/reason。合法弃权可用原两次共享修复新建完整轮次；协议错误、源/审计漂移、超限上下文、unknown usage 和取消不消费质量重试。

静态 LLM 仍可能误判。此切片没有可信外部 case registry，也没有机器强制逐状态语义门禁；如需增加该能力，须另定来源/版本，不能让 PM 自报义务成为成功定义。只有经完整静态审核后冻结的独立浏览器行为 Gate 实际通过，才可按原真实交付口径计数；工程夹具接受不证明真实模型质量改善。

## 版本、秘密与成本

免费预检与运行 validationContract 增加审计/评审投影版本，manifest/evidence 保存同一审计及 hash，freeze 绑定全构建证据。新 Agent/Jev Key 禁止与受保护协议字面量或其≥16字符子串碰撞；旧合成加密凭据通过完整新固定指令/字段的首调用前守卫验证，真实 Key 不导出或迁移。

没有新增角色、调用槽、自动重试或固定模板回退；初始最多16、原有最坏28逻辑调用包络不变，用户实际限额不自动提高。审计本身无模型费用，但新增提示与事实可能增加输入 Token，只有新真实实验能衡量净质量/成本；不以移除重复传输先声称省费。本批0新增供应商请求，外层开发 Token/平台费用 unknown。

工程结果见 [本批审查](BATCH-STEP-AUDIT-CHECKS.md)。原始负结果保留；[HTML05](experiments/HTML-05/RESULT.md)没有跑到分组与 Gate，不能后验变成此新版本的效果证据。下一次真实运行须独立预登记、免费预检和有限授权。
