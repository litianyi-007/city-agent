# 虚拟社会调查续作跟踪

2026-10-07最新追加：契约1.1真实调查已完成，新授权账本closed；小学联合0/10、宠物3/10，15未启动；5请求、input15,704/output1,328 Token、保守估算¥0.042032。两场景首个质量失败后停止全部该场景后续请求，规划/CORS均未启动，不重试、不补样、不扩容。付费前300单测/19浏览器（38.4秒）/双构建通过；新自然语言规划只完成离线契约验证、未完成真实验证。[独立负结果补充](docs/research/CONTRACT-TRIAL-2026-10-07.md)。下面RC1数据仍为独立历史记录，F001继续doing。

最新发布已完成：固定源码Tag`society-contract-review-2026-10-07-rc2-ui1`、Pages `2245245531b44891e8a00c7b08876dccf74c27ca`及公开预发布Release；303单测/19浏览器（37.7秒）/双构建、35本地UI/34公网UI检查通过；155文件实际字节覆盖由151项初检与4项补验合并，原失败记录保留。[发布实证与下一批](docs/research/CONTRACT-PUBLIC-RELEASE-2026-10-07.md)。没有新增付费调用、正式申报或新版真实视频；[6项离线任务及门限](docs/research/STRUCTURED-OUTPUT-NEXT.md)待实现，下一次付费需重新授权。

| ID | 类型 | 标题 | 优先级 | 状态 | 完成日期 |
|---|---|---|---|---|---|
| F001 | Feature | 评委复现、候选规划、业务证据及五层人群自证 | P0 | doing | — |

基线、历史成果与全部合并待办见 [当前主线计划](docs/SOCIETY-NEXT.md)。本分支不跟踪另一会话的自动化生产内部任务。

2026-10-07历史初批：工程实现/188单测/14浏览器及双构建通过；当时无新增真实调用。[历史交接报告](docs/research/NEXT-BATCH-REPORT-2026-10-07.md)不被后续结果回填。

同日历史评审补齐：安全/评分/空审计/终态竞态修复；17/18题工程示例及原规则恢复；239单测/19浏览器和候选材料另册。[历史评审报告](docs/research/REVIEW-COMPLETION-2026-10-07.md)保留原结果。

历史RC1公开评审候选：已执行非mock真实合成居民测试轮，全部确认请求7次（3居民、2规划、2CORS），input15,418/output6,881 Token，保守估算¥0.085884；20计划居民仅1份结构/跨题/资格联合通过，17未启动，两个10人门限均失败；规划0/2可应用候选，CORS2次HTTP200仅协议验证。原文、失败、未启动及预算均保留，不自动重试/扩容。[历史RC1报告](https://litianyi-007.github.io/city-agent/submission-next/live-proof/report.md)与[JSON](https://litianyi-007.github.io/city-agent/submission-next/live-proof/report.json)为部署后的公开入口。

源码分支`feature/virtual-society-next`与固定Tag`society-review-2026-10-07-rc1`已推送，Pages与公开预发布Release已上线；284单测、19浏览器（37.0秒）、双构建、119公网文件字节与独立页面体验、335源码同机新目录安装均通过。[发布实证记录](docs/research/PUBLIC-RELEASE-2026-10-07.md)与[本轮真实测试](docs/research/LIVE-REVIEW-2026-10-07.md)分列。`main`、旧Tag、L4/L5分支不改，正式申报未提交。真实调查首批失败、市场/人格贡献/30人门限未验，因此F001仍doing，不以材料完整或工程通过标全部done。
