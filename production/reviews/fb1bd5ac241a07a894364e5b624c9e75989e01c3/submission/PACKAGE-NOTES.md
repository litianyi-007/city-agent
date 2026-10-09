# 材料包阅读说明

原 Mock 运行平台 commit：c21c588632d04dc7ed9dfa8cb265606400d2b522。材料导出与审查工具 commit：fb1bd5ac241a07a894364e5b624c9e75989e01c3。原始运行、候选、Gate、输入、Prompt/config与所有失败保持原版本；重新渲染不重新实验。

## 体验入口

公开静态入口：https://litianyi-007.github.io/city-agent/production/，只运行可信固定 Mock 和材料浏览，不运行 Harness 后端、不收集 Key、不执行模型生成产物。

本机管线：http://127.0.0.1:4420/#production，需按 RUNBOOK 启动服务并配置。

## 三种证据与费用

三条 Mock 仅工程夹具，行为 Gate 3/3；零生成请求不表示全包零付费请求。本包归档真实生成调优记录 17；不认证无人干预、L4达标或稳定L5。不含 REAL-02 的旧候选池／生产 Jev 账本 41 请求，输入 unknown / 输出 unknown Token，估算 unknown USD（非供应商账单，不含外层开发/设备/录屏）。v1/v2不同配置分别统计；protocol error、skipped、uncertain与混合失败均保留。详见 materials-summary.json、jev-benchmarks.json、mixed-and-live-runs.json。

## 录屏与安全审查

历史录屏（平台 c21c588）：继承原视频；原片使用受控截图，但仍不证明新版本或真实模型交付。原视频没有重录或改写；转容器格式不是新实验。

旧iframe预览可自导航外联，已撤下；不可信HTML只下载为附件，本机预览为受控Chromium截图。公开门户只用固定可信Mock。截图和worktree不是任意代码安全容器；容器/受控仓库/Node与shell仍不支持。临时Jev凭据须用户轮换，材料不包含密钥。

## 申报硬缺口

≥3真实业务需求当前未满足；正式团队姓名、官方L4参考线、完整摄像头需求交付、代表性稳定实验、校准集、同范围人工与无Verifier对照未完成。人口与虚拟社会线独立，不把它们的结果挪作本线证据。AnyJev SDK未接入，L0/L1/L2不等于研发L4/L5。

## 复现与血缘

离线使用 --from-package 先验证原manifest并复制原证据到新目录；不访问API、不重发供应商请求。新Mock录制另起任务，不能静默重跑并覆盖失败。原始包SHA256：bda6ca45643ab8b76b9b35cf594cea37fec2304128d8ee486bd05bf03d828f34。文件hash只用于一致性检查，不是防篡改签名。文档来源见manifest.documentOrigins；运行JSON中的platformCommit不改写成publisherCommit。

## 评委独立安装（报告版本）

```text
Node.js >=22.19 (validated 22.22.3), Git, npm, a supported Chromium browser environment and an available local port 4420. Installation downloads dependencies/browser; fixed Mock review needs no model Key. Real requests require your own local model/JeV configuration, declared prices, one-use consent and a finite budget.

(
set -eu
if [ -e city-agent-production-review ] || [ -L city-agent-production-review ]; then
  echo 'Install directory already exists; use a fresh parent directory.'
  exit 1
fi
git clone --branch feature/autonomous-production --single-branch https://github.com/litianyi-007/city-agent.git city-agent-production-review
cd city-agent-production-review
git checkout --detach fb1bd5ac241a07a894364e5b624c9e75989e01c3
npm ci --engine-strict
npx playwright install chromium
npm run build
npm start
)
# Open manually: http://127.0.0.1:4420/#production

Optional camera-scene-v1 only: prepare pinned assets BEFORE a paid run (downloads fixed official assets, not a model call):
npx tsx scripts/prepare-camera-assets.ts
npx tsx scripts/prepare-camera-assets.ts --verify

Model/JeV keys are newly entered on the LOCAL page; public GitHub Pages neither receives keys nor runs this backend. Do not run generated Node/shell scripts or reuse another worktree's credentials.
```

Report commit: fb1bd5ac241a07a894364e5b624c9e75989e01c3
版本材料: https://litianyi-007.github.io/city-agent/production/reviews/fb1bd5ac241a07a894364e5b624c9e75989e01c3/submission/

## 真实任务附录

本包归档真实生成调优 17 次；有界场景行为 1/9；本包完整需求交付 0/17。本包不同配置调优，不是稳定性实验，也不是全部历史生产分母。真实摄像头研发产物是模型生成的声明式场景 DSL＋平台可信 runtime，不是任意软件源码。只记录合成场景行为 Gate；真实视觉、实体摄像头和完整需求仍未验收，不认证稳定 L4/L5。

额外离线HTML实验的独立原档通过固定来源链接提供：[HTML-01](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-01/RESULT.md)、[HTML-02](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-02/RESULT.md)；与上述相机分母分开，不合并跨配置率。本包聚合计数按mixed-and-live-runs.json、real-camera-runs.json与HTML-DELIVERY-STATUS.json的run IDs去重；各类分母分别展示。

首次有界通过：CAMERA-09 / 24256f96165f0be3156be037a2fea42492e31117。real-camera-runs.json重新计算汇总，各CAMERA原档逐字继承，存在旧/当前字节冲突就拒绝。CAMERA-09含七原档：run/evidence/delivery-manifest/platform-metadata/scene/camera-runtime-manifest JSON与index.html.txt。文本源只下载，不公开执行模型代码。未到Gate明确not-reached。run.usage已包含该run的Jev，不能再加不含REAL-02的旧候选池／生产Jev账本；roleOnlyUsage才是生成/Verifier角色单独费用。未知计量仍unknown，Harness逻辑调用不冒充供应商POST。camera合成通过不等于真实视觉、实体设备或完整需求通过。

历史 Mock 视频来源 c21c588632d04dc7ed9dfa8cb265606400d2b522，原视频字节不变，不能作CAMERA-09录屏。新结果说明：[CAMERA-09](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/CAMERA-09/RESULT.md)；[免费 DEV 池](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/VERIFIER-DEV-CORPUS.md)不计正式质量实验。

正式业务需求≥3、官方L4标准与同范围人日对照仍缺；AnyJev SDK仍仅规划。

## 当前HTML真实调优附录

[HTML原run/hash索引](HTML-DELIVERY-STATUS.json)与[当前进度](CURRENT-PROGRESS.md)列出HTML01～08，保留全部八次启动。上文只列HTML01/02是历史链接摘要，不是当前分母。HTML08实际18 HTTP/179634 Token/0.0658755 USD估算，PM两次返修耗尽，未到研发/freeze/Gate；当前v5仅免费工程验证，不能追认旧成功，也没有自动新模型请求。索引另三件原档通过完整publisher来源链接和hash核对，包/发布与固定源码明确32件一致后才放行；hash不是独立签名。SUBMISSION-REPORT.md保持申报原文逐字；当前appendix、PDF与静态页是新的衍生展示；历史MP4仍原源版本。

[HTML-01](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-01/RESULT.md) · [HTML-02](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-02/RESULT.md) · [HTML-03](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-03/RESULT.md) · [HTML-04](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-04/RESULT.md) · [HTML-05](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-05/RESULT.md) · [HTML-06](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-06/RESULT.md) · [HTML-07](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-07/RESULT.md) · [HTML-08](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-08/RESULT.md)

## 独立 REAL-02 选优研究账本

另列 52 观测HTTP（18 Jev、34 LLM），342986/8557 Token，0.077296446 USD声明费率估算，非账单。54盲决策/36实际Oracle/286链式事件；12算术漂移和4正常不确定升级、1错弃权保留，高性价比=false。此研究不计软件良品率，不在上文旧Jev账本，不得重复累计生产run.usage（已含本run的Jev）。原jev-candidate-v3记录不证明当前v4/可选源码绑定模式真实实测。原始十档与完整hash随包提供，旧视频未重录。
