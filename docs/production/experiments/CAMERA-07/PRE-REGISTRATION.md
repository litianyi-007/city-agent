# CAMERA-07：生成反馈与独立评审上下文分离

2026-10-07，先于付费启动保存和提交；独立一次尝试，不覆盖 CAMERA-06，也不将不同配置探索合并为成功率实验。

## 不变的目标与门禁

原话、来源、背景、完整验收、kind=illustrative、difficulty=high及三项结构映射沿用 [CAMERA-06 输入快照](../CAMERA-06/run.json)，只将编号改为 CAMERA-07。不复用原角色答案作为本轮模型答案。全部内部角色重新生成，外层不改产物、不回退模板、不放宽Gate。六角色配置仍为 DeepSeek/https://api.deepseek.com/deepseek-flash，声明输入0.30/输出1.20 USD/M；页面已有本分支Key仅hasApiKey验证，不迁移或回显。

Jev jev-1.13.0、门限3/.5、输入.042 USD/M/输出0、24次/30秒、级联一次独立LLM规则不变；unknown用量仍停止，不把本地容量拒绝改成零或隐式跳过Jev。每阶段1候选、30条调用预算、共享纠错/返修2、500000 Token、6000单次输出、600秒。**本轮金额上限收紧为1 USD**，预测.03～.20 USD，不是实测。仍在已授权首批15 USD内部额度内，不启动54意图的Verifier对照实验。费用为声明费率估算而非供应商账单；旧unknown仍unknown，不能当作零腾出预算。

HTML v7 / camera v6、camera acceptance v2、mandatory behavior v2、Verifier phase ordinal v4/compact-output-v1、semantic v2、coverage-owners-v1、camera-test-semantics-v1、Jev request-layout-v2/candidate-v3、global-repair-v1、Harness0.1.5-rc.3/literal-transport-v1及固定资产不变。

## 唯一核心变更：production-review-context-v1

原角色收到完整 generationContext，包括上一轮被拒反馈。独立JeV与LLM只评当前合法候选和当前阶段完整业务事实：将控制面top-level `regeneration` 移到可追溯 generationFeedbackReference（原内容SHA、当前来源角色call IDs、被拒candidate IDs、原角色输入路径）。完整旧反馈/原始输出/返修记录继续保留；不是丢失历史、删除当前候选或裁剪业务目标。

不移除产品、研究、计划、原需求、验收、已冻结检查、实际Gate/反馈、平台事实、覆盖责任或预算剩余；候选JSON保持原字节意义。用户需求或候选内部同名字段不投影。生成器需要失败反馈，独立评审不把上一轮已被拒的答案再混入当前候选池。版本在validationContract/configHash/criteriaHash/frozenHash/manifest绑定；旧实验无此字段不回填。不是提高上下文上限或更宽评分策略。

免费反事实验证使用CAMERA-06实际第二版测试候选及真实上下文：原单题33,774 B/完整36,436 B，helper投影后单题29,664 B/完整32,326 B；实际pipeline再加入版本字段后单题29,718 B/完整32,380 B，单题余量2,282 B。完整当前候选、goal/acceptance和所有非生成反馈字段不变，原历史SHA不变。此为免费容量证明，不证明真实质量；更长输出仍按32k/64k/60k上限失败关闭。

启动前工程回归：全量Node378/378、独立新增pipeline集成2/2、浏览器38/38、TypeScript/Vite构建通过。集成测试使用实际Jev适配器和8次内存fake fetch（0 HTTP），验证来源引用、完整生成输入、当前候选评审、Gate失败反馈保留、manifest/frozen版本绑定及共享2次纠错池。空合法池仍按原规则拒绝，不派发评审；不是模板成功或真实模型交付。

## 成功判定

必须实际执行产品→研究→项目经理→测试预检与独立审查→研发前冻结→scene JSON研发→全部冻结CSS和强制Canvas/几何/合成21点Gate→项目经理按真实Gate交付→完整证据。纠错≤2、无人工改产物。

即便通过，也只称最小真实有界场景闭环。真实视觉、实体摄像头、完整需求仍false，等待用户主动实机验收；不称稳定L5/官方L4。所有启动/失败/取消/超时/截断/unknown进入账本。干净提交/构建及免费回归先完成，实际source commit/hash在原始API证据记录。
