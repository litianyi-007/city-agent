# 评委安装、访问与自主测试指南

## 先选体验方式

| 我想做什么 | 入口 | 是否需要 Key |
| --- | --- | --- |
| 直接操作一个固定案例 | [在线体验](https://litianyi-007.github.io/city-agent/production/) → “在线体验固定案例” | 不需要 |
| 查看最新实验、PDF、MP4、原始证据 | 同一页面 → “材料与复现”；使用页面给出的固定版本链接 | 不需要 |
| 输入一句话需求，让六角色实际开发 | 自己设备安装 → `http://127.0.0.1:4420/#production` → “新建自定义需求” | 自备模型 Key、单价与本次预算 |

GitHub Pages 是静态入口，不运行 Harness 后端、不收 Key、不启动新开发任务。在线交互只执行平台注册且字节一致的可信固定 Mock；不是实时模型产物。普通 HTML 模型产物仅提供受控截图与文本下载，不能在公开站点执行任意生成脚本。

本指南对应 v6 评委材料；实际部署版本以在线 `publication-manifest.json` 为准。固定版本位于 `reviews/<完整 publisherCommit>/`，不要将“最新入口”当成旧实验配置。已提交 [MD 主稿](SUBMISSION-REPORT.md)保持原始申报时点；[最新质量合同](QUALITY-V6-DESIGN.md)、[本批审核记录](BATCH-QUALITY-V6-CHECKS.md)与 [REAL-02](experiments/VERIFIER-REAL-02/RESULT.md)分别说明增量。更新前完整指南[留底](archive/2026-10-08-before-quality-v6/REVIEWER-GUIDE.md)。

## A. 无需安装的五分钟审阅

1. 在线固定待办案例可添加、完成、删除、筛选和测试空输入；查看三个 Mock 输入、冻结 Gate 和工程产物。它证明管线工程及行为验收，不计真实自主交付良品率。
2. “材料与复现”下载 PDF、主稿 MD、安装指南、完整 ZIP 与 `package-manifest.json`；核对材料版本、来源 commit 和文件 SHA-256。
3. MP4 是约 3 分 26 秒的历史免费 Mock 录屏，继承原始字节与来源 commit；不是最新代码或真实模型成功视频。不能播放时下载到本机。
4. REAL-02 为 18 个候选池的三策略真实选优对照，52 HTTP、54 决策、36 次实际行为 Oracle。它不是完整需求研发实验：B 好12／坏4／弃权2；C 好11／坏2／弃权5。C 估算费用高于 B 3.26%，预登记的高性价比条件不成立。完整原件和复算入口在附录，不能把弃权或未知当成功。
5. CAMERA-09 的声明式场景通过 11 项实际 Gate、0 返修，和实体摄像头／真实视觉／完整硬件需求分别验收。三 Mock、不同配置探索、选优对照分别使用自己的分母。

v3–v5 旧 PDF、视频、源码与负结果不覆盖；本次新材料和 Jev v4 工程修补不会追认 REAL-02 的 v3 策略成功。原虚拟社会入口独立保留。

## B. 安装：在自己设备输入新需求

已验证环境为 macOS、Node.js 22.22.3；最低要求 Node.js ≥22.19、Git、npm、现代浏览器，以及 GitHub/npm/Chromium 下载网络。Linux、Windows/WSL 全新安装未在本批完成验证；不要求 Docker，不允许因此在宿主执行模型生成的 Node/shell 脚本。

在线安装按钮**只复制命令，不执行命令**。其命令固定到该版完整 40 位 publisherCommit，并在新目录中失败即停止。已有同名目录时先另选新目录，不进入或清理旧目录。

在新的空父目录执行：

```bash
(
  set -e
  echo 'Paste the full 40-character publisherCommit from the public manifest (not an API Key):'
  IFS= read -r production_review_commit
  case "$production_review_commit" in ''|*[!a-f0-9]*) exit 1 ;; esac
  if [ "${#production_review_commit}" -ne 40 ]; then exit 1; fi
  if [ -e city-agent-production-review ] || [ -L city-agent-production-review ]; then
    echo 'Install directory already exists; use a fresh parent directory.'
    exit 1
  fi
  git clone --branch feature/autonomous-production --single-branch https://github.com/litianyi-007/city-agent.git city-agent-production-review
  cd city-agent-production-review
  git checkout --detach "$production_review_commit"
  node --version
  npm ci --engine-strict
  npx playwright install chromium
  npm run build
  npm start
)
```

该代码块会先要求输入完整 publisherCommit，缺失／格式错误时在克隆前退出，不默认安装浮动 HEAD。推荐首先使用公开页复制的**完整固定命令**重现该版，然后按自己的选择再试最新工程。

打开 `http://127.0.0.1:4420/#production`。首次下载需要网络、时间和磁盘；失败保留报错，不绕 lockfile。默认 Node20 不足。默认独立数据目录为仓库 `.city-agent-production`；不复制作者数据库、Key、主密钥、日志，不共享可写目录。端口冲突不停止其他服务，可以换整组：

```bash
PRODUCTION_API_PORT=4520 PRODUCTION_WEB_PORT=5520 PRODUCTION_PREVIEW_PORT=4522 PRODUCTION_E2E_PORT=4521 PRODUCTION_DATA_DIR=.city-agent-review npm start
# http://127.0.0.1:4520/#production
```

先运行 MOCK-01／02／03，纯 Mock 不要 Key、没有模型费用。查看计划、候选、冻结契约、实际 Gate、源码和证据。另一个终端的免费回归：

```bash
npm test
npx playwright test --config docs/production/baseline.playwright.config.ts
```

浏览器测试使用独立 4421（或 PRODUCTION_E2E_PORT）和独立测试数据。更新源码／checkout／准备资产／build 后退出**本项目**终端，再启动服务；真实任务要求启动时干净源码及 HEAD 一致的构建。旧进程不会自动获得新身份，不删除历史证据或关闭身份检查来继续。重启中的任务标为 interrupted，不自动恢复收费。

## C. 六角色真实任务自测

1. 本地“研发团队”创建或复制 Agent，分别设置产品、项目经理、研究员、研发、测试、Verifier 的 Provider、Base URL、有效 Model ID、Key 和输入／输出每百万 Token 单价及币种。允许同厂商同模型；不同 ID 不证明权重独立。
2. Key 只在页面密码字段输入；保存后看脱敏状态，不回显完整 Key。本项目不提供作者 Key；暴露过的临时 Key 需持有人轮换，不发到 Git、Prompt、录屏或申报附件。
3. 新安装／新建 Agent 默认 deepseek-flash、`https://api.deepseek.com`；既有保存配置不会迁移。默认值不是可用性或费用承诺，仍需确认自己账户的有效 Model ID 和单价。作者已有实验输入0.30／输出1.20 USD每百万 Token仅为历史估算快照，不保证未来价格或账单；当前默认的官方依据见[API入门](https://api-docs.deepseek.com/en/)和[更新日志](https://api-docs.deepseek.com/updates/)（2026-10-08核查）。
4. “决策设置”可填独立托管 Jev Key；已有实验是 `jev-1.13.0`。置信度是分布集中度，不是业务正确率；未知 usage、价格、协议错误按记录停止，不静默放宽。
5. “新建自定义需求”填写原话、编号、实际来源类型、背景、完整验收，避免沿用 Mock 的来源。选择真实模型、受控能力和验证引擎。示例有限预算：每环节1候选、30条调用、500000 Token、600秒、共享最多2次修订／返修、1 USD估算停止阈值；不是供应商账单硬上限。
6. 可选“启用条款证据门禁（LLM）”：仅 live 离线 HTML + LLM 引擎，研发和返修须提供候选 hash、原始要求／产品条款覆盖、短源码引用、冻结业务断言索引。引用校验不证明语义正确，最终浏览器 Gate 必需。与 Jev 不兼容时明确阻止提交；不静默降级，不追加隐形模型调用。该新配置本批工程验证和已有真实实验分别报告。
7. 最后勾选本次有限预算授权，单次提交消费同意；配置变化需要重新确认。跟踪阶段原始输出、候选选择／弃权、冻结 hash、行为 Gate、返修、Token、费用和 unknown。只有实际交付通过冻结 Gate、没有外层改产物／模板回退才能记录成功。失败下载完整证据；取消停止相关调用与执行资源，不用重启当免费重试。

原始 HTML 下载为文本附件；在平台外运行不再受平台限制。任意仓库、生成 Node/shell、依赖安装与容器执行器属于下一阶段，不绕过宿主安全边界。

## D. 摄像头（可选，不属于普通安装）

只有选择 camera-scene-v1 才准备固定可信资产；在线页不会申请摄像头。另在同一新仓库执行：

```bash
(
  set -e
  npx tsx scripts/prepare-camera-assets.ts
  npx tsx scripts/prepare-camera-assets.ts --verify
  npm run build
)
```

约30MB固定版本资产逐文件验 hash、保留许可证；需访问官方源。错误／不完整目录拒绝而非覆盖，见源码 [CAMERA-ASSETS.md](CAMERA-ASSETS.md)。准备后重启本项目。

真实任务通过声明式场景 Gate 后才进入可信运行时。先用手动按钮，设备持有人再主动启动摄像头；需要 localhost／HTTPS、用户授权和实体硬件。假摄像头／合成手势不能代表完整视觉验收。新安装不带作者运行数据库；重做需求会新建任务并产生新费用，不等于回放 CAMERA-09。

## E. 可复现与问题反馈

- 对照 manifest 做 `shasum -a 256 文件名` 或 `sha256sum 文件名`；hash 证明字节一致，不证明日志防篡改或结论真实。
- 归档中的 REAL-02 可用源码的只读核验器检查，不会重放收费请求：`npx tsx scripts/inspect-production-verifier-study.ts --archive <归档路径> --sha256 <RESULT.md给出的SHA>`。
- 安装问题检查 Node、lockfile、下载与端口；模型问题检查端点、有效 ID、Key 状态、单价与预算。脱敏反馈，不发送 Key。
- 用本次终端 Ctrl+C 退出，不停止他人服务；分享材料排除整个控制面私有数据目录。材料有分歧先核对版本／commit，不回写历史失败。
