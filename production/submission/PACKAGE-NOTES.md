# 材料包阅读说明

原 Mock 运行平台 commit：891fedcab0f3c5994c7e92f7874e610b3b6354b8。材料导出与审查工具 commit：b899b0e4d7ae9b3cd91efa9a55969ab57c954215。原始运行、候选、Gate、输入、Prompt/config与所有失败保持原版本；重新渲染不重新实验。

## 体验入口

公开静态入口：https://litianyi-007.github.io/city-agent/production/，只运行可信固定 Mock 和材料浏览，不运行 Harness 后端、不收集 Key、不执行模型生成产物。

本机管线：http://127.0.0.1:4420/#production，需按 RUNBOOK 启动服务并配置。

## 三种证据与费用

三条 Mock 仅工程夹具，行为 Gate 3/3；零生成请求不表示全包零付费请求。六角色真实生成任务记录 0；不认证无人干预、L4达标或稳定L5。全包真实 Jev 5 请求，输入 15027 / 输出 874 Token，估算 0.000631134 USD（非供应商账单，不含外层开发/设备/录屏）。v1/v2不同配置分别统计；protocol error、skipped、uncertain与混合失败均保留。详见 materials-summary.json、jev-benchmarks.json、mixed-and-live-runs.json。

## 录屏与安全审查

历史录屏（平台 891fedc）：继承原 demo.webm；当时 iframe 预览边界已发现自导航外联风险，现已关闭，不能作为现版本安全证据。原视频没有重录或改写。

旧iframe预览可自导航外联，已撤下；不可信HTML只下载为附件，本机预览为受控Chromium截图。公开门户只用固定可信Mock。截图和worktree不是任意代码安全容器；容器/受控仓库/Node与shell仍不支持。临时Jev凭据须用户轮换，材料不包含密钥。

## 申报硬缺口

≥3真实业务需求当前未满足；正式团队姓名、官方L4参考线、六角色真实自主交付、代表性稳定实验、校准集、同范围人工与无Verifier对照未完成。人口与虚拟社会线独立，不把它们的结果挪作本线证据。AnyJev SDK未接入，L0/L1/L2不等于研发L4/L5。

## 复现与血缘

离线使用 --from-package 先验证原manifest并复制原证据到新目录；不访问API、不重发供应商请求。新Mock录制另起任务，不能静默重跑并覆盖失败。原始包SHA256：a8831c7c631b7fe6ef30c13c0952e48c50964ad7fe3ba9e51668e40bf6018d2e。文件hash只用于一致性检查，不是防篡改签名。文档来源见manifest.documentOrigins；运行JSON中的platformCommit不改写成publisherCommit。
