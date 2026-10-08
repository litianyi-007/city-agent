# HTML06原档与公共启动守卫修复批次（2026-10-09）

## 结论与变更边界

[HTML06](experiments/HTML-06/RESULT.md)由真实前端仅提交一次，启动守卫工作量超限，在首模型请求前终止：failed / 286ms / 0调用 / 0Token / 0模型费用。它是实际启动尝试，不是模型质量样本或自主交付成功。旧实验/已提交申报/公开v6保持原件，0消费不自动重跑。

新增[公共碰撞guard v2与启动同源guard v1](PUBLIC-COLLISION-GUARD.md)、16份公开原档字节清单及只读收据测试。分长度扫描和公共候选加密前缀预筛保留全历史Agent/Jev集合与完整认证判断；100000扫描/实际加密及新1000000前缀比较有明确独立口径。免费预检检查与真实启动同样的完整固定材料，不解密/持久化/调用模型，报告结果入hash，实际启动仍重检。

新版主启动身份包含两个新模块；对照当前study-selected固定集合v7/53仅增加实际store碰撞依赖，不宣传完整递归import闭包。Guard新标识和v7的凭据子串保护验证保留；旧纯预检无回调仍保持原序列化/hash。原八项业务、12×20 Gate、独立Verifier门限、2次共享返修及旧Prompt字节未改。

## 免费工程验证（按真实轮次保留）

| 验证 | 实际结果 | 口径 |
| --- | --- | --- |
| fba源码启动前纯预检专项 | 24/24，554.507ms | HTML06前准备；不验证启动全部固定材料 |
| 新修复首轮7文件 | 44/46，15.691秒 | 缺费率报告中的nested undefined被新scanner拒绝，父/子两项失败；随后恢复原JSON省略/数组null语义，未改未知费用 |
| 新修复8文件中间轮次 | 129/130，159.099秒 | 新测试额外引入第7种合成凭据长度，误要求超出已定义扫描容量仍完成；不是模型调用失败 |
| 修正后8文件最终专项 | **130/130，159.768秒，0skip** | 历史24代际使用既有合成product凭据长度；不提高生产上限。两种长度的精确超限反例仍拒绝，纯13项含480同长度密文代际及全量认证差分 |
| 全量Node工程回归原轮次 | **992/993，1226.289秒，0skip，exit1** | 唯一失败是上述原第7长度夹具期待；该子进程在修订前已加载。最终8文件130/130复测其修订及全部受影响接线，不将专项通过伪称为一次全量全绿 |
| 独立端口浏览器回归 | **65/65，约1.8分钟** | 4421独立临时数据；含Agent配置/复制、需求输入、预检、取消/账本及虚拟社会入口，不访问原目录服务 |
| TypeScript / Vite | 最终通过 | 初轮新增测试类型断言报错已改为正式可选版本字段；构建成功，第三方Zod注释Rollup提示不影响产物 |

独立安全非作者复测纯guard/startup/HTML06收据 **20/20，1.096秒**；745个新增标识可用凭据子串在schema/Agent新增/Agent修改/Jev修改均被拒绝。闭包作者9/9（8.757秒）另经安全非作者逐diff复核；条件server非作者startup/收据7/7（501.005ms）另核接线。重复测试不当成额外需求交付或样本。

以上模型供应商请求/模型Token/声明价模型费用均0；loopback API、注入role和真实Chromium行为是工程验证。合成usage/费用不是供应商usage，外层开发Agent Token/费用及人工增效未统计。

可复核命令（Node22、新worktree）：

```bash
npx tsx --test --test-concurrency=1 tests/production-public-collision-guard.test.ts tests/production-startup-public-contract.test.ts tests/production-launch-preflight-api.test.ts tests/production-launch-preflight.test.ts tests/production-study-credential-generation.test.ts tests/production-verifier-study-source.test.ts tests/production-html06-evidence.test.ts tests/production-acceptance-groups-pipeline.test.ts
PRODUCTION_E2E_PORT=4421 npx playwright test
npm test
npm run build
```

本机原日志在忽略目录 `output/production-html06/`：`free-precheck.tap`、`free-fix-targeted.tap`、`free-fix-final-targeted.tap`、`free-fix-corrected-targeted.tap`、`free-full-engineering.tap`、`free-browser-regression.log`、`free-build.log`、`free-build-final.log`；不将私有browser profile或状态目录纳入提交。

## 对抗性审查

使用 `specs-review` 的固定质量、安全、条件服务端与历史经验检索。`docs/lessons/` 不存在，没有相关历史经验条目；不编造插件审查结果。审查包含本批所有修改，模块/闭包作者不以自评代替独立复核。

- P2：全代际重复扫描可使完整启动材料触发容量拒绝；用合成配置复现后版本化改计数/预筛，保留认证与硬边界。
- P2：免费预检缺少真实启动固定材料；抽同源集合，API和startup均覆盖全部完整指令/历史密文，固定失败不透露私密信息。
- P2：新模块引入store的实际依赖未纳入对照固定源码集合；v7/53追加新模块，旧缺项集不能执行新实验，原档不重写。
- P2：新scanner严格验证回归了缺费率的unready报告；保留原nested undefined语义、属性名碰撞和费率unknown/null，最终专项复测关闭。
- P3：费用预测不能因守卫优化而暗示节费；HTML07沿用HTML06的0.04–0.35 USD预测范围并说明守卫不减少模型调用。

当前独立审查无未解决P1/P2。合成第7长度用例期望修正不作为生产缺陷放宽，原失败日志/全量轮次保留；这不证明任意规模Key集合或任意软件可靠性。

## 提交、服务与下一次实验

提交前 **43文件** 范围及常见秘密扫描、三份文档留底字节、历史实验/public/申报/冻结tag不变检查通过；两张截图已视觉检查，profile/private状态未读或导出。扫描是启发式，不声称任意编码秘密不存在。只推送 `feature/autonomous-production`，不发布新Pages、改main/tag或另一worktree。

干净提交后重新构建，确认本分支4420服务无活动任务且PID/cwd匹配再重启；只读复核HTML05/06 API及原始artifact字节、22运行/2基准/3study，并再次免费预检新的guard版本。服务实测收口另由提交后的检查记录确认，预先不把这些步骤写成已通过。

下一次收费仍须[HTML07新单次授权](HTML-07-PROPOSAL.md)。任何启动拒绝、取消或失败都留账；没有模板回退、外层改生成HTML或临时降低Gate，不宣称已实现通用L5。
