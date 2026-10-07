# HTML-01：真实通用网页探索记录

## 结果与边界

2026-10-07，通过本地 `http://127.0.0.1:4420/#production` 的“新建自定义需求”填写并启动一次。原句、验收及有限预算见已提交的 [预登记](PRE-REGISTRATION.md)；没有发送 demoCaseId、模板或现成断言。输入类型为用户授权自拟演示需求，不是业务工单。

运行 `fb6e1e6a-d8b8-4f50-80c8-c557793fbddd` **failed**。源 commit `967bbba15c92dc07cf40fd2b2f5affebf1493b12`，干净构建 `2026-10-07T09:34:31.496Z`，实际重新启动本分支服务后核对 metadata 一致。创建 `09:41:55.158Z`，结束 `09:43:14.740Z`，记录耗时 **79,544 ms**。没有外层改生成代码、模板回退或门禁变更，没有记录到中途人工介入；一次自动 Gate 返修，不是一次额外付费重跑。

研发前冻结四个测试角色检查，hash `555cb6dcd506cf17ecfe9f73e4e7ff581e4efed9ea628c81f02ad24aea8d48be`，冻结 `09:42:33.049Z`，首次研发 `09:42:33.299Z`。唯一 Chromium Gate 的五项结果为页面加载、初态通过，添加、完成、删除失败；返修后评审未通过容量预检，因此没有第二次 Gate，也没有可交付 HTML。

## 分层归因

1. **平台执行事实未充分传递。** 两份原始候选只监听原生 form.submit；现有 Gate 的 `sandbox allow-scripts` 不允许表单提交。实际添加后列表为0，与该机制相符。归档时仍为强静态解释，新的免费浏览器对照另记；不把新的对照结果补成旧运行事件，不放宽 CSP。
2. **冻结 DOM 契约不一致。** 添加要求 `#todo-list li.todo-text`，首稿为 `span.todo-text`，返修仅在已完成时给 li 加类；整 li 的精确完成文本还包含操作按钮文字，不能满足冻结的 `准备发布 ✓`。Unicode escape `\u2713` 合法，不作为缺陷。
3. **评审未可靠识别。** 首稿独立 LLM Verifier accept/4 未捕捉上述契约冲突；测试评审 accept/4 同时提到应补缺项。硬 Gate 没有被评分覆盖。冻结检查完成后没有再次断言总数/条目数仍为1，未完全覆盖预登记第3条；刷新缺口已事先披露。
4. **返修评审重复上下文。** 最后 Jev 请求36452B，state33420B，最大question647B，合计34067B超过原32000B门限。旧HTML7190B在 `feedback.previousHtml`，当前完整返修候选另保留。没有截断候选、增大容量或改用隐式 fallback；最后评审在本地拒绝，0 POST、无响应、用量unknown，后续停止。

## 真实调用与费用

六角色使用本分支页面配置的 DeepSeek / deepseek-flash；Jev 为 jev-1.13.0。每阶段1候选，不能证明多候选选优效益。13条 Harness 意图均观察到一次 POST；7条 Jev 意图中6次 POST、最后容量拒绝0次，共20条预算记录、19次实际 POST。前六次 Jev 中5次算术一致性拒绝、1次 uncertain，均升级一次独立 LLM。返修候选没有后续 LLM 评审或 Gate。

已报告19条用量小计：**87,975 输入 / 10,098 输出 Token，0.028835172 USD**；其中 Harness 0.027448500，Jev 0.001386672。价格是配置的输入0.30/输出1.20 USD/M及Jev输入0.042/输出0，不是发票。原run总Token/费用均null、complete=false，因为最后登记的评审用量unknown；即使观察到0 POST，也不把该条未知用量改为零，不把小计称总额。原1 USD单次上限保留，不自动再跑。

## 原字节与复核

| 文件 | SHA-256 |
| --- | --- |
| run.json | 29a46e05b5e50a3585d91c2f4e13846c92023ce84951d6bc80b408660ff4c9f6 |
| evidence.json | 5db19a9a043a53dc8da5c03c935b5859fc259f7fc56d5f4afafe769a123a564a |
| delivery-manifest.json | 1150074b88b137113821a5dcfae4a9854f96a72552072994b36cb6dc2a0179da |
| platform-metadata.json | 2b5d66d23aa6ba858485a4418b79f26592973884ee2a55580f31ee3e7f4db8f2 |

四档分别为API原字节及启动前metadata原字节。失败只导出manifest/evidence，没有index.html；下载接口404，不伪造不存在的产物。两份完整模型HTML仍在原角色rawOutput中。纯历史测试 `tests/production-html01-evidence.test.ts` 7/7、540.975 ms通过，TypeScript通过；不是新增真实生成、行为复跑或成功实验。

后续修补在新源码版本验证：公开受限HTML执行契约；区别文本节点与操作控件；只从候选评审上下文移除绑定原文来源的旧代码，保留完整新候选、业务事实、Gate反馈和规划阻碍；付费阶段前检查启动源码/构建身份漂移。旧冻结验收、记录、结果不变。后续真实实验须新编号和预登记，不能把本次追认成功。
