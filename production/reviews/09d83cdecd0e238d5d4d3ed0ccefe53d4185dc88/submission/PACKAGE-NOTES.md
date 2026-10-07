# 材料包阅读说明

原 Mock 运行平台 commit：c21c588632d04dc7ed9dfa8cb265606400d2b522。材料导出与审查工具 commit：09d83cdecd0e238d5d4d3ed0ccefe53d4185dc88。原始运行、候选、Gate、输入、Prompt/config与所有失败保持原版本；重新渲染不重新实验。

## 体验入口

公开静态入口：https://litianyi-007.github.io/city-agent/production/，只运行可信固定 Mock 和材料浏览，不运行 Harness 后端、不收集 Key、不执行模型生成产物。

本机管线：http://127.0.0.1:4420/#production，需按 RUNBOOK 启动服务并配置。

## 三种证据与费用

三条 Mock 仅工程夹具，行为 Gate 3/3；零生成请求不表示全包零付费请求。六角色真实生成任务记录 4；不认证无人干预、L4达标或稳定L5。全包真实 Jev 15 请求，输入 81970 / 输出 2411 Token，估算 0.00344274 USD（非供应商账单，不含外层开发/设备/录屏）。v1/v2不同配置分别统计；protocol error、skipped、uncertain与混合失败均保留。详见 materials-summary.json、jev-benchmarks.json、mixed-and-live-runs.json。

## 录屏与安全审查

历史录屏（平台 c21c588）：继承原视频；原片使用受控截图，但仍不证明新版本或真实模型交付。原视频没有重录或改写；转容器格式不是新实验。

旧iframe预览可自导航外联，已撤下；不可信HTML只下载为附件，本机预览为受控Chromium截图。公开门户只用固定可信Mock。截图和worktree不是任意代码安全容器；容器/受控仓库/Node与shell仍不支持。临时Jev凭据须用户轮换，材料不包含密钥。

## 申报硬缺口

≥3真实业务需求当前未满足；正式团队姓名、官方L4参考线、六角色真实自主交付、代表性稳定实验、校准集、同范围人工与无Verifier对照未完成。人口与虚拟社会线独立，不把它们的结果挪作本线证据。AnyJev SDK未接入，L0/L1/L2不等于研发L4/L5。

## 复现与血缘

离线使用 --from-package 先验证原manifest并复制原证据到新目录；不访问API、不重发供应商请求。新Mock录制另起任务，不能静默重跑并覆盖失败。原始包SHA256：19dc20d9aadc140acc851fc1c24860311956dbe169cb401d97401f129d403645。文件hash只用于一致性检查，不是防篡改签名。文档来源见manifest.documentOrigins；运行JSON中的platformCommit不改写成publisherCommit。

## 评委独立安装（报告版本）

```text
Node.js >=22.19 (validated 22.22.3); an available local port 4420.
git clone --branch feature/autonomous-production --single-branch https://github.com/litianyi-007/city-agent.git city-agent-production-review
cd city-agent-production-review
git checkout 09d83cdecd0e238d5d4d3ed0ccefe53d4185dc88
npm ci
npx playwright install chromium
# Optional camera-scene-v1: prepare pinned assets BEFORE a paid run
npx tsx scripts/prepare-camera-assets.ts
npx tsx scripts/prepare-camera-assets.ts --verify
# Mock/offline review may skip the two camera preparation commands
npm run build
npm start
Open http://127.0.0.1:4420/#production
Model/JeV keys are newly entered on the LOCAL page; public GitHub Pages neither receives keys nor runs this backend. Do not run generated Node/shell scripts or reuse another worktree's credentials.
```

Report commit: 09d83cdecd0e238d5d4d3ed0ccefe53d4185dc88
版本材料: https://litianyi-007.github.io/city-agent/production/reviews/09d83cdecd0e238d5d4d3ed0ccefe53d4185dc88/submission/

## 四次真实任务附录

真实已实测 4 次；完整交付 0/4。不同配置调优，不是稳定性实验。real-camera-runs.json和CAMERA-01..04/保留完整输入、角色原文与失败；未到Gate明确not-reached。run.usage已包含该run的Jev，不能再加全包Jev总账；roleOnlyUsage才是生成/Verifier角色单独费用。未知计量仍unknown，Harness逻辑调用不冒充供应商POST。camera合成通过不等于真实视觉、实体设备或完整需求通过。

正式业务需求≥3、官方L4标准与同范围人日对照仍缺；AnyJev SDK仍仅规划。
