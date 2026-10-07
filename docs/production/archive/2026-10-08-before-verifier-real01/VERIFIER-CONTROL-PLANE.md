# Verifier 评估控制面与离线核验

本切片把上一批原生观测内核接入本机工作台，不另建一套选优或 Oracle。页面中的 **决策设置 → Verifier A/B/C 评测 → 展开评测并测试** 用于比较固定18池的 A/B/C 策略；它不是需求开发编辑器，不能把评估完成算成软件交付成功。软件需求仍在 **生产工作台** 输入。

## 本机体验

在本生产分支的独立安装目录运行 Node 22.19+：

```sh
npm ci
npx playwright install chromium
npm run build
npm start
```

打开 [本机生产工作台](http://127.0.0.1:4420/#production)。默认端口4420/5420/4422/4421以及独立数据目录见 [安装指南](REVIEWER-GUIDE.md)；若目录和端口已有他方服务，不覆盖或停止。

1. 打开决策设置页，找到 Verifier A/B/C 评测并点击“展开评测并测试”。默认是免费本地替身演练。
2. 先准备配置，核对来源、模型公开配置、预算、完整 freeze hash 和有效期。准备不等于执行，不调用模型，也不读取真实 Key。
3. 明确点击启动后才执行；查看状态、已落盘事件和摘要，可以取消。取消等待执行资源清理后终态。
4. 免费运行使用固定 dummy Key、真实 Harness→本地 SSE、内存 Jev 协议替身和实际隔离 Chromium。没有外部供应商请求；替身 Token/声明价只作工程账本，不是模型费用或质量测量。
5. 真实来源需选择页面中启用的 Verifier，配置 DeepSeek 官方地址、实际 Model ID、Key、USD声明价，并启用 Jev及其Key。只显示脱敏配置；不从虚拟社会线复制密钥。
6. 真实启动需再次明确同意该次冻结配置，以及“估算停止额度并非供应商账单硬上限”和“Jev输出门限是响应后观测”的边界。没有后台自动启动或恢复按钮。

GitHub [公开入口](https://litianyi-007.github.io/city-agent/production/)仍是静态体验和安装/申报材料入口，不运行这些后端API。未发布本批功能到Pages，不把线上旧版当成本机新版本。

## 运行与授权

每次 prepare 使用新的可信工厂 plan，冻结完整18池×3策略、实际源码、公开配置、调用/Token/估算费用/时限及原始请求hash。控制面将授权绑定当前boot和凭据代次；内部凭据代次通过加密配置的私有等值标记判断，不导出明文、Key哈希或标记。

配置/Key轮换、源码/HEAD/构建变化、过期、重启和已消费的同意均不能继续使用旧preparation。单次授权消费及running状态独立持久化并fsync，先于任何模型/Oracle调用。完整内核账本继续逐项记录intent、原始响应、已知/未知usage和terminal确认。

服务与普通软件生产、Jev基准互斥。重启识别中断，不自动重发收费调用；取消等待原生清理。新一轮需新prepare及用户操作，不复用旧答案缓存。

默认真实计划最多54意图（36 LLM＋18 Jev）、30分钟取消触发、1 USD声明价估算停止额度；LLM请求max_tokens=4096，Jev4096为响应后观测停止，不是供应商输出限制。依照用户声明价格计算，不保证实际账单；unknown不记零。真实来源只有使用原生transport实际观测时才可记录，不接受调用者注入端点、回调或“通过”标签。

## 跨设备只读证据核验

原账本marker绑定原绝对目录。归档不能用 `VerifierStudyLedger.open()` 当作新设备可续跑的账本，也不能重写marker或放宽原scope。独立只读核验器只读取压缩包，验证包SHA、受限tar结构、原始manifest/event/marker hash链及记录scope一致性，不解压、不修复、不调用供应商。

示例（安装依赖后，在clone根目录运行）：

```sh
npx tsx scripts/inspect-production-verifier-study.ts --archive docs/production/experiments/VERIFIER-OBSERVED-01/run-ledger.tar.gz --sha256 a1d171a2e9106327a0a4d758b5e32b3f1cdf0f159c514c538efa37ad8baed987
```

核验成功表示“这些字节符合指定SHA与账本结构”，不表示源SHA来自可信签名，也不证明模型判断正确、供应商鉴权或完整产品验收。未完成记录保留中断/未知含义，不生成成功报告，不自动恢复。

原包的macOS PAX/xattr与AppleDouble侧车在下一节更正说明中列明；只按受限白名单校验/忽略，不应用到本机。

## 原归档审计补充（不重写历史）

对 VERIFIER-OBSERVED-01 的原生tar头检查发现：原包除了581个有效ledger JSON和run目录，还含macOS归档元数据。此前系统tar可见清单“不含其他文件”的描述不完整。

完整原包SHA仍是上面的 `a1d171…ed987`，没有删除、重打包或改变实验内容。新核验器区分账本有效载荷与PAX/AppleDouble元数据：1746个原生header＝581个JSON＋1个run目录＋582个PAX＋582个AppleDouble。此补充修正归档清单口径，不改变54调用、36真实Oracle、免费替身或原始负例结论；详见[补充核验说明](experiments/VERIFIER-OBSERVED-01/ARCHIVE-INSPECTION-ADDENDUM.md)。

## 本批与下一步

本批仅免费工程/API/浏览器和原归档核验。真实18池对照仍需一次性确认该次完整公开配置及估算额度，再生成新的clean source freeze；不要继承历史任务额度或用本切片的free fixture成绩宣称模型效果。

之后对真实A/B/C的有效选中率、错误接受、弃权、升级比例和完整/未知费用进行归因，再回到真实软件需求交付验证。容器仓库执行、实体摄像头和通用L5不由本评估替代。
