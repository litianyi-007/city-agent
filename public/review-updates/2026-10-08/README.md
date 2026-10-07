# City Agent：2026-10-08独立评委体验更新

[直接体验 Demo](https://litianyi-007.github.io/city-agent/#research) · [评委路径/安装/费用](https://litianyi-007.github.io/city-agent/review-guide.html) · [固定版本下载](https://github.com/litianyi-007/city-agent/releases/tag/society-responses-review-2026-10-08-rc3) · [工程与真实接口摘要](status.json)。

## 重点材料

- 数据来源：[官方人口来源和原件清单](../../submission-next/population-sources.json)，[可复用区域录入方法](../../submission-next/methods/population-methodology.md)。2020街道人口结构与后续区级总量分别登记，不静默拼为同一时点。
- 人群及角色：[五层构建方法](../../submission-next/methods/resident-construction.md)，[科学依据](../../submission-next/persona-source-register.json)。采用Big Five倾向、成长经历多选、教育、当前家庭、社会分工/收入；全部情景假设可未知/编辑/复制，资格不从人格推导。
- 问卷与结果：[17/18题、各12人的完整工程自证](../../submission-next/business-proof/proof-report.md)。固定题ID、五题型、跨题与资格审计、原文/统计/失败分母，0模型调用。它自证软件流程，不冒充真人或LLM新作答。
- 技术与参数：本机固定Harness SDK `0.1.5-rc.3`；候选Responses见证器 `responses-text-stream-1.1`。完整schema透传、单assistant message/output_text、可选且一致的 `phase:final_answer`、完整EOF/usage、输入输出预留、首异常停止和持久账本。默认API/UI仍为既有协议，不静默迁移。
- [历史真实调查原文与用量](../../submission-contract11/)独立保留。本批新的真实能力记录在status单独编号，固定DeepSeek Flash、每场景完整问卷一次、输出最多3000 tokens、期限90秒、每批≤2请求/≤¥1、无重试/补样/换模型/10＋10扩容。

## 含义与追溯边界

status为审查后的白名单摘要，与本机真实报告及全套离线日志核对；不是完整原始响应。每个真实报告的SHA与运行ID独立登记，失败及未启动不抹去；事后回放不能改变原实网失败账本。费用缺失保持null，保守估价不等于实际账单，完整预留也不是实付。若仅部分请求报告usage，已知Token/估价只覆盖该子集，不代表全轮费用。

历史独立复验 `143651dd-3e97-42d1-bf38-3ef3dcc603d8` 实际2请求：两场景协议/结构均通过，完整能力1通过/1失败；首质量异常后封闭。9677输入＋288输出tokens，3038.936792ms受控总时长，保守估价¥0.021658（非发票）。宠物把居住街道推成未给定的可达范围，检查将其阻断；定义理解题也存在输入/预期不对称。该轮原失败保留。

最新独立复验 `50992659-bdbc-4c2a-a3eb-ee288768b40e` 使用Prompt1.1：提供定义≠观察到居民理解，居住地≠消费可达资料；缺确认记录的主观理解题保持未知。非作者审核、独立手写输入依据与反例通过后，新注册1.3冻结执行一次，真实2请求、完整能力2/2通过，9942输入＋287输出tokens，3263.045583ms受控总时长，保守估价¥0.02218（非发票），账本closed。没有把答案表塞进模型输入，也未松结构/跨题/资格/未知门。两场景业务题分别已知0/12、0/14，正确保持信息不足；此结果不证明滨江市场偏好或选址。

新接口能力的两固定合成资格角色只验证本次生成/未知边界合规，不是人口抽样cohort，不证明Schema逐关键字因果执行。消费资料未给定时typed unknown是正确出口；不能由人格、收入或街道人口补造现实消费偏好。无Key示例使用显式规则生成情景答卷，模型路线与现实调查各自分栏。

工程计数来源为固定工作树字节的完整日志，source inventory与发布源码核对；HEAD变成新发布commit不意味着该commit当时已被供应商实测。字节hash不认证现实真值、模型权重或供应商发票。

原始SSE、授权回执、私有账本、数据库与Key不公开。Pages自备Key仅本次内存会话、刷新清除，直接调用供应商且须允许CORS，不经过Harness。页面费用确认不是钱包硬限额，结构无效也不是实验CLI的全局停止门；先用1人检查，再自己决定下一轮。

## 演示与推广价值

[2026-10-07的4分33秒零费用流程视频](../../submission-next/demo-next.mp4)与[历史项目PDF](../../submission-next/project-materials.pdf)保持原件，本页为独立进展，不假称视频记录新的付费复验。

可推广的部分是版本化地区数据、可解释分群、完整问卷和可回查的研究诊断，帮助商业团队预演问题、比较合成情景并缩小现实补采范围。现实选址、销量与人格贡献另做校准；MCP现实桥、记忆/wiki/dream保持延展设计。正式提交状态以比赛回执为准。
