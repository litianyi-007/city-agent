# M0.5：调查工作区与人群预设交付记录

日期：2026-09-24。这是配置层增量，不是居民仿真完成记录。继续 [TASKS](../TASKS.md) 原六个工作包；修改前原文与实现见[留底](../archive/2026-09-24-before-research-workspace/README.md)。

## 已实现

- `/#research`：独立调查页，三模板、空白问卷、五类题型编辑/重排、稳定 question/option ID、问卷 JSON 导入/导出、总体筛选、证据声明、人口框预检、本机草稿新建/更新/重载。
- `/#residents`：人群预设管理，默认一般成年居民、小学生照护者、养猫家庭购买者、养犬家庭购买者；支持自定义、复制、编辑、启停、删除。每个预设独立 provider、base URL、model ID、Key。
- 人群预设与产品/研究/研发/测试 Agent 独立表、独立 API；四角色旧流程保留。居民没有工具、持续执行、社会关系或长期记忆。
- Key 在本机服务端 AES-GCM 加密；响应仅含 `hasApiKey`。省略 Key 保留原值，明确清除会删除；提供方/地址变更且未重新提交新 Key 时清除旧 Key。复制在服务端解密后重新加密，不向页面回显。
- 编辑问卷、选择人群、修改人群预设会令当前预检失效；问卷与预设修改均有离开提示。保存成功采用写响应刷新状态，避免二次列表请求失败留下旧结论。

## API 与持久化

| 路由 | 作用 |
| --- | --- |
| GET `/api/research/templates` | 原三份问卷模板 |
| GET `/api/research/resident-templates` | 四种人群配置模板，不包含真实居民或 Key |
| GET / POST `/api/research/resident-agents` | 列表 / 创建预设 |
| PATCH / DELETE `/api/research/resident-agents/:id` | 修改 / 删除预设；已有草稿引用时删除返回409 |
| POST `/api/research/resident-agents/:id/clone` | 复制完整配置与加密凭据；只接受空对象 |
| GET / POST `/api/research/projects` | 列表 / 保存新调查草稿 |
| PUT `/api/research/projects/:id` | 更新已有草稿，不创建运行 |
| POST `/api/research/projects/validate` | 问卷及各人群预设的 AND 交集预检，不持久化、不调用模型 |

调查请求体为 `{ task: ResearchTask, residentAgentIds: UUID[] }`，最多30个不同预设。新增 `resident_agents(id,data,secret)` 与 `research_projects(id,data)`；预设只初始化一次。草稿仅保存问卷、所选 ID、stage=draft 和时间，不存 ready 或模型执行结果。问卷导出不包含这些模型连接与密钥。

问卷和预设的地区、时期、统计单位不相容时明确缺证；资格 AND 条件共用原 M0 预检。总问卷框通过并不意味着每个预设通过，页面分别展示。现有15–59岁年龄档不能直接还原18+；照护、养猫、养犬资格仍无完整观测支持。

## 不能据此声称的能力

- `executorAvailable:false`、`modelCalls:0`、`marketResearchValidated:false`。开始居民调查禁用，新问卷不转交旧 `/api/runs`。
- 预设数量不是样本量；预设可以重叠，没有人群规模、权重或代表性认证。模板名与行为说明是设定，Key 保存也不等于服务已连通。
- 问卷仅结构验证，`semanticValidation:not-performed`。人工核对题干中跨题编号、金额单位、购买者/使用者及情景含义；重排保留 ID 但不会重写题干中的“第几题”。
- 当前只保存结构合法的草稿；不合法的编辑保留在当前页面，离开前可取消操作修正。没有自动保存、多人并发合并、草稿历史版本或软删除。已保存草稿可解除引用后删除预设，不提供历史回收站。
- 草稿引用的是可编辑预设；不是不可变执行快照，跨标签页修改不会实时推送。本次页面中的预检仅对应检查时刻。执行器接入前须补配置/画像/问卷快照、版本冲突及最终执行前复核。
- 尚缺自然语言自动拆卷、居民模型作答、追问、确定性统计、三类完整合理性评测、通用问卷四角色交付。没有真实人口数据新增或真人市场校准。

## 本批验证

- `npm test`：96/96；其中新增 `resident-agents.test.ts` 11项、`research-draft.test.ts` 3项。最终修订后再次以 `npx tsx --test --test-reporter=dot tests/*.test.ts` 运行同一套测试。
- 通过项目生产构建（TypeScript + Vite），Sites 构建辅助脚本仅调用项目既有 `npm run build`，未迁移框架或部署公网。
- 只读独立审查聚焦凭据隔离、事实语义与 UI 状态，两个 UI 缺陷已修复；新增 UI 未进行浏览器点击、截图、移动端或可访问性验收。旧 Gate 自动化仍包含真实 Chromium，但不等于新编辑器已验收。
- 测试使用临时 SQLite 与假 Key，本地模型替身仅验证既有 SDK/编排；无外部模型调用、无真实凭据消耗。
- 本轮预览：`http://127.0.0.1:4312/#research`、`/#residents`，数据目录 `/tmp/city-agent-research-preview.8jloWE`，与现有4310服务完全分离，未复制原凭据或运行记录。已通过页面入口及新增读取 API 的 HTTP 健康检查；这不等于浏览器交互通过。临时目录可能被系统清理，正式使用请结束旧服务中的任务后重启原服务，保留原数据目录。

## 下一批

继续 T2.2 最小画像契约 → T3.1/3.2 的10人执行工程冒烟，隔离上下文、五题型答卷校验、失败分母、取消、限次重试和居民预算；并行 T5.2 的明示夹具页面交付，随后接 T4.1 确定性统计。实际供应商调用须另行确认可用配置与额度。

家庭/活动/人格假设与有限自主性放第二阶段；隔离记忆与 kata 整理按需求接入。外部现实桥 MCP 放再下一阶段，先有来源、时点、口径、版本审计再驱动世界事件，不使用区块链，不把 dream 产物写成人口事实。
