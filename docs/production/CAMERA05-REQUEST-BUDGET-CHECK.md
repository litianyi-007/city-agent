# CAMERA05 上游输出的免费请求容量验证

日期：2026-10-07。检查时平台代码基线：`373e4b7`。这是工程反事实验证，不是新一轮真实模型交付，也不改变 CAMERA05 的失败结论。

## 输入与证据边界

只读 [CAMERA05 原始运行](experiments/CAMERA-05/run.json)，按照 `outputs.selectedCandidateId` 匹配真实已选择的产品、研究、项目计划原文，分别为 4,046、3,940、2,752 个 UTF-8 字节。研究使用第二次合法且被选择的输出，不拿首次失败输出冒充成功。

原始 `run.json` SHA-256 固定为 `61cb1e48477e0bbf4bc28e7e53cf5e55bce01c5a0b70e258f3796c9dc91e0d8f`；验证前后均检查原字节与 hash。原输入、上游输出和原失败记录不编辑。

测试、研发、Verifier 和 Gate 使用明确的免费注入夹具：具体粒子总量、手动散开/聚合、左右旋转、重置、三项映射（张掌散开、握拳聚合、掌心横移旋转），以及合成边界与固定文案。使用当前 `ProductionPipeline`、真实 `buildJevCandidateRequest` 与 `evaluateJevCandidates`。只有后者的 fetch 被替换为内存 `Response`；全局 fetch 拒绝外部请求。没有 Harness 模型请求、外网 HTTP、真实 Key、浏览器或实体摄像头操作。

`providerRequests` 在注入的 Jev evaluator 中代表模拟 fetch 派发，不是物理 HTTP；不能据此申报真实调用量、账单或成功率。运行始终标注 `injected-test`，实体摄像头和完整需求验收均为 false。人工提供的候选与 Gate oracle 不证明模型能自主生成它们。

## 免费实测

阈值采用当前适配器的 UTF-8 十进制字节限制，不是 tokenizer Token 数，也不是 KiB：角色 system + 换行 + user ≤60,000 B；Jev state + 最大单题 ≤32,000 B；完整请求 ≤64,000 B。

| 合法检查项数 | 最大角色请求 | 最大 Jev state + 单题 | 最大完整 Jev 请求 |
|---|---:|---:|---:|
| 7 | 38,497 B | 25,219 B | 27,881 B |
| 8 | 38,786 B | 25,508 B | 28,170 B |
| 9 | 39,071 B | 25,793 B | 28,455 B |

三个实际适配器预检路径均通过，完整执行 8 个阶段：产品、研究、计划、测试契约、研发、失败反馈、研发返修、通过反馈。每条链路的注入 Gate 先失败后通过，共享修复池消耗 1 次，冻结检查与 hash 保持不变。另做三次只为下游计量的诊断重复，其尺寸一致；诊断路径不用于证明实际适配器通过。共 6 条免费工程链路，不属于稳定性实验。

9 项检查的逐阶段计量：

| 阶段 | Jev state + 单题 | 完整 Jev 请求 |
|---|---:|---:|
| product | 14,675 B | 17,337 B |
| research | 19,167 B | 21,829 B |
| think-design | 21,630 B | 24,292 B |
| acceptance | 24,218 B | 26,880 B |
| implement | 24,983 B | 27,645 B |
| feedback-0 | 14,101 B | 16,763 B |
| repair-1 | 25,793 B | 28,455 B |
| feedback-1 | 14,100 B | 16,762 B |

本组最窄余量为 Jev 单题的 6,207 B，无需提高上限、删候选、删业务内容或静默跳过 Jev。更长的合法角色输出、更多失败详情或更大场景配置仍可能超限；本测试不能保证任意需求长度均可执行，现有上限继续失败关闭。

## 永久回归

新增 [production-camera05-request-budget.test.ts](../../tests/production-camera05-request-budget.test.ts)，只保留最大 9 项的一条实际适配器路径，避免将 6 条诊断链路重复加入日常测试。该测试逐阶段核对字节门限、实际 evaluator 的请求体、一次冻结 Gate 返修、上游原文、历史 SHA 和证据分类。

在本生产 worktree 使用 Node.js 22.19+：

```sh
node --import tsx --test tests/production-camera05-request-budget.test.ts
```

测试在本 worktree 独立临时目录写入合成配置和注入证据，结束后只清理自己创建的目录。它不启动 4420/4421 服务、不读取已配置密钥、不修改平台源码、旧实验或申报附件。
