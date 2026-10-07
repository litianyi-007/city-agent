# 虚拟社会主线：发布后的离线推进报告

日期：2026-10-08（Asia/Shanghai）。工作分支 `feature/virtual-society-next`。用户反馈发布完成后恢复研发；本批不重复提交申报、不改原里程碑截止时间、main或L4/L5分支。两个真实实验账本保持关闭，没有读取真实Key、实网模型请求、安装依赖或费用。

## 本批交付

| 任务 | 当前离线交付 | 验收边界 |
| --- | --- | --- |
| 1 目标/单位/证据 | [两场景矩阵](OBJECTIVE-EVIDENCE-MATRIX-2026-10-08.md)，覆盖全部17/18题及登记输出 | 儿童原文/照护采购、个人/家庭/儿童分母、零食/主粮、街道/候选点分开；不伪造现实资料 |
| 2 诊断/历史 | 四类状态，独立逻辑/资格/内容诊断，固定起止hash | 新审计不重判旧成绩，checked不等于passed |
| 3 Harness路线 | [四层能力矩阵](HARNESS-CAPABILITY-MATRIX-2026-10-08.md)，真实SDK Responses transport及自有schema adapter localhost slice | 原profile schema透传阻碍已定位；完整schema穿过DSH自定义adapter，仍不冒充供应商执行/生产接入 |
| 4 答卷compiler | [新契约](ANSWER-CONTRACT-2026-10-08.md)，全部题ID/显式null/五题型/排他/hash与独立oracle | 24夹具无损回放、20结构mutation双拒绝；条件逻辑仍独立审计，不改旧生产协议 |
| 5 安全前置 | [B001](../bugfix/B001-provider-usage-wire-boundary.md)：provider usage/SDK核对、冻结wire、首attempt、完整body预算、CORS解析 | 原包见证限受预算路径，普通Harness/UI不自动升级为已认证 |
| 6 内容/校准 | 合法未知单列information-insufficient；来源/不可达/输入缺失分类与现实留出/人格消融设计 | 不设置非未知配额或补答；非未知仍是情景信息，不当消费者事实 |

结果页增加“研究内容与执行状态”只读面板和独立JSON导出；历史用当时冻结规则，原证据格式不变。组件按需加载，对稳定结果memo计算，不在草稿每次按键时重跑。

## 复现与本机产物

Node≥22.19、已安装锁定依赖：

```sh
npm test
npm run build
npm run build:pages
npm run test:e2e
npm run review:offline
```

默认离线CLI不依赖私有output或Key，固定核验42项仓库历史文件；没有网络/预算参数或付费路径。`npm run review:offline -- --local-full`额外读取本机1.1原始24文件、公开投影27文件及离线V2的84文件/manifest，总计179文件；缺原件或漂移明确失败，不补造。

当前完整导出 `output/offline-review/review-ZJ1VHd/`：report、historical-integrity与24份fixture-answer-contracts。179历史文件及14个关键源码hash在起止核验一致，覆盖新增adapter wrapper/plugin；schema转换明确不是供应商响应，旧raw不改。该次审计200.88ms含校验/诊断/compiler回放，不含文件导出；实网模型请求/Token/费用0，不覆盖旧运行时长。先前`review-fKBAaL`及其209.13ms/11源码记录独立保留。

静态Pages实际浏览器截图与复核 `output/offline-review/ui-3SSqcH/`：1280/375px，溢出0、外网请求0、页面错误0；12份checked仍明确9份情景信息/3份信息不足。导出及刷新历史恢复由浏览器回归验证。原申报PDF/ZIP/录像和真实原文保留。

## 验证与独立审核

Node22.22.3：最终冻结复验362/362单测（22.64秒）、19/19浏览器（44.6秒）、双构建、TypeScript及diff检查通过。新增契约/witness/adapter三文件组合32/32（15.71秒），离线CLI更新14源码快照后专测2/2通过。先前首切片341/341（24.29秒）、19/19（39.5秒）以及中间362/362（22.41秒）保留为独立记录，不混用旧303/300门限。浏览器使用新临时数据目录、合成Key/本地fixture，不连接真实模型；localhost HTTP不是付费API验证。

初审有安全、质量、后端三个独立视角；Prompt漂移、坏JSON后重试、nested/body预算和CORS不完整usage均修复。非作者最终复核21项安全回归及四种额外攻击，攻击全部上游0请求。compiler/oracle/hash及UI接线亦由非作者复核，无阻断发现。原先无docs/lessons，根因与回归另存B001，保护文档不删除。

自有DSH schema adapter新增19项真实子进程回归；第二调用consumed guard、wire/schema/replay raw hash在运行时执行。独立审核发现前序created/added中的tool/refusal、ID漂移等可能与末态不一致，作者修复后14类异常流均在发布内容前失败（contentChunks=0）。非作者另做8类内存mock攻击，全部拒绝；它们是额外攻击证据，不作为19项测试数量叠加。实现只接收自有localhost且只认识固定8事件序列，任何“通用生产Responses parser已认证”的结论均超出证据。

## 历史不改写与下一步

新审计重述1.1：小学1份实际逻辑conflict、9未启动；宠物3已检查、1结构阻断、6未启动；资格未评估9/7、实际资格conflict0。联合仍0/10和3/10，不用新compiler使旧失败变通过，不扩30人。

已完成仅localhost的自有`ctx.llm.registerAdapter` slice，使schema真正穿过DSH；不接生产或真实Key。本批工作仍在feature worktree，尚未提交或再次发布；main、旧Tag、已发布材料和L4/L5分支不改。

下一安全实施项T27：将Responses候选接入冻结单请求/预算原包见证，另实现可接受分块/多delta/合法事件差异且拒绝所有tool/refusal/failed/incomplete的通用parser。冻结真实任务/居民Prompt、完整schema/body/input上限；原文usage缺失或矛盾全局停止并保留reservation。第二请求、重试、重定向、漂移或任何内容先于终态发布都必须拒绝。它先以本地正负夹具及独立攻击审查过门，默认不激活生产/付费路线，不能直接部署当前固定fixture parser。

之后的能力探测需新版本/源码hash/预登记矩阵及新预算授权。nullable/排他/完整17/18题探测与10＋10调查、现实留出、30人扩容分别过门。现实桥MCP、长期记忆/wiki/dream及自主居民保持后续阶段，不替代当前问卷可靠性主线。
