# 评委安装、访问与自主测试指南

本指南对应材料源码 `production-materials-v5`；公开部署是否已更新以publication-manifest为准。公开页不需要 Key；本地真实运行需自备 Key、网络和明确预算。最新真实结果见 [CAMERA-09](experiments/CAMERA-09/RESULT.md) 与 [进度](POST-SUBMISSION-PLAN.md)。09已通过有界场景闭环，真实视觉/实体摄像头/完整需求分别验收；安装成功不保证任意新任务交付成功。

v3/v4固定在线页、PDF/MD/ZIP和MP4保留；新材料加入09七份原证据，安装命令固定到本版publisherCommit。部署后核对publication-manifest完整commit，不把三Mock/旧录屏source c21c588或09运行source24256f9改成新导出版本。更新前全文[留底](archive/2026-10-07-before-camera09/REVIEWER-GUIDE.md)。

## A. 不安装：先看公开材料（约5分钟）

1. 打开 [生产线评审入口](https://litianyi-007.github.io/city-agent/production/)，首屏三个入口区分固定案例、本地新需求与材料。已提交[MD主稿](SUBMISSION-REPORT.md)保持v3叙述，最新过程与结果以本版本实测附录为准。
2. 当前可用：手动体验待办添加/完成/删除、筛选、空输入与两项提交；查看各 Mock 的实际Gate和输入。交互页面是平台注册的可信固定夹具，不是此时模型在线生成。
3. 在线“材料与复现”查看该版PDF/ZIP/MP4，按各附件来源commit解释；历史录屏不证明后续版本或真实模型交付。
4. 进入固定版本入口，下载主稿MD、PDF、指南、完整ZIP，核对 `package-manifest.json` 的发布commit、材料版本与SHA-256。正式评审使用PDF给出的 `reviews/<完整commit>/` URL。播放 `demo.mp4`，这是**免费Mock**历史录屏，不是六角色真实成功视频；不兼容可下载播放。
5. 展开真实场景逐次账本，下载 `real-camera-runs.json`；仅含该包实际归档终态。v5的CAMERA-09含run/evidence、交付manifest、启动metadata、scene.json、runtime manifest与index.html.txt，11项实际Gate通过，0返修。摄像头模型交付声明数据，由固定可信运行时渲染，不是任意软件源码；TXT仅审查下载。不要混合Mock、合成行为、完整硬件需求或不同配置探索分母。

公开 GitHub Pages 没有 Harness后端，不接收 Key、不开新生产任务、不申请摄像头。原虚拟社会入口另行保留，不表示本生产线获得了其人口与记忆的新能力。

## B. 自己设备安装：免费工程体验

已验证的开发环境为 macOS、Node.js 22.22.3；最低要求 Node.js≥22.19、Git、npm、支持本机 localhost的现代浏览器，允许访问 GitHub/npm/Playwright浏览器下载源。以下为 macOS/Linux 的 POSIX shell 命令；Linux/Windows全新安装兼容性未在本批完成验证，不能视为承诺。Windows可使用已有 WSL环境，新增系统权限请自行审核。本项目不要求安装Docker，也不会因此允许宿主执行生成脚本。

在**新的空目录**执行，不覆盖已有 city-agent、数据库或配置：

```bash
git clone --branch feature/autonomous-production --single-branch https://github.com/litianyi-007/city-agent.git city-agent-production-review
cd city-agent-production-review
node --version
# 建议先 git checkout 本版PDF/manifest给出的完整publisherCommit，再安装。
npm ci
npx playwright install chromium
npm run build
npm start
```

打开 `http://127.0.0.1:4420/#production`。首次下载依赖与 Chromium需要网络、时间及磁盘空间；失败时保留报错，不绕过 lockfile或用未知依赖替代。默认 Node20不足，请先自行安装满足要求的 Node。若端口占用，不停止其他服务，退出本项目后换一组端口，例如：

```bash
PRODUCTION_API_PORT=4520 PRODUCTION_WEB_PORT=5520 PRODUCTION_PREVIEW_PORT=4522 PRODUCTION_E2E_PORT=4521 PRODUCTION_DATA_DIR=.city-agent-review npm start
# 打开 http://127.0.0.1:4520/#production
```

默认独立数据目录为本仓库 `.city-agent-production`；不复制原项目的任何数据、Key或日志，不建立可写目录符号链接。不同端口的开发/测试命令应使用同一组环境设置。

在页面选择 `MOCK-01`，运行“工程演练/Mock”，再完成02/03。纯 Mock不需要六角色 Key或Jev，不产生模型费用；查看计划、候选、冻结契约、实际Gate、源码附件和原始证据。只把浏览器实际通过计为工程验证，不算模型自主完成。

可另开终端，在同一仓库执行免费回归：

```bash
npm test
npm run test:e2e
```

Playwright使用独立4421端口；不要把测试指向他人的服务。未完成的本地任务在重启后标为 interrupted，不自动继续收费。

## C. 真模型自测：自己的 Key、有限费用

1. 在本地“研发团队”页创建或复制 Agent，为产品、项目经理、研究、研发、测试、Verifier分别设置 Provider、Base URL、有效 Model ID、Key及输入/输出每百万Token单价与币种。同厂商同模型允许；不同ID不自动证明权重独立。公开页不能配置。
2. Key只在页面密码字段填写；保存后看脱敏配置状态，不通过回显完整Key验证。不要写命令、Prompt、Git或提交附件。本项目不提供作者Key；会话暴露的临时Key需要持有人轮换。
3. 本轮作者实测选择 deepseek-flash，端点 `https://api.deepseek.com`，费率为输入0.30/输出1.20 USD每百万Token的保守配置；这是本轮估算快照，不保证未来ID可用或供应商账单价格。请以自己服务账户的当前有效配置为准。
4. “决策设置”可启用托管Jev，填写独立Key，固定版本本轮为 `jev-1.13.0`。未知usage、价格或协议错误会停止；不关闭安全检查伪装成功。建议先独立 LLM Verifier的小HTML任务，再比较Jev混合路径；两条路径分别记录。
5. 返回“生产工作台”，先点“新建自定义需求”，选择受控能力，再填原话、编号、来源类型、背景和完整验收，不沿用Mock来源/验收。选择真实模型和验证引擎；预算示例为每环节1候选、30条调用、500000Token、600秒、共享2次修订/纠错/返修及1 USD估算限额。检查全部配置后才勾选本次授权，授权一次提交即消费；修改或重新启动需要重新确认。过低预算可能提前失败，不要设无限重试。
6. 跟踪原始角色输出、来源、Verifier选择/弃权、冻结hash、功能Gate、返修和费用。真正成功须完整产物通过冻结行为Gate且没有外层修改；失败则下载证据、查看unknown与缺口。点击取消检查终止状态，不用重启当免费重试。

HTML预览是平台受控截图，原始HTML下载为文本附件；在其他环境运行下载的源码不再受平台限制。未验证容器前不支持任意仓库的生成Node/shell/构建脚本与依赖安装，不能为了体验在宿主绕过。

## D. 摄像头场景：另有资产与实体设备验收

只有主动选择 `camera-scene-v1` 才涉及摄像头需求；公开页不申请摄像头。先在仓库执行可信固定资产准备器：

```bash
npx tsx scripts/prepare-camera-assets.ts
npx tsx scripts/prepare-camera-assets.ts --verify
npm run build
```

下载约30MB固定版本资产，逐文件验证hash并保留许可证；需访问官方源。准备器拒绝已有错误/不完整资产目录，不在本指南指导强制覆盖；查看 [CAMERA-ASSETS.md](CAMERA-ASSETS.md)。准备后重建以包含资产。只有真实任务产出并通过场景数据Gate，才进入本机可信运行时主动点击启动摄像头；需要HTTPS或localhost安全上下文、用户授权及实体摄像头。以所选真实run的scene/Gate为准，不能拿默认/演示场景冒充交付。

合成手势场景行为、假摄像头SDK集成、真实视觉模型、实体硬件、完整原需求是分开的证明层次；假摄像头通过不能勾选完整硬件通过。相机拒绝、资产缺失、视觉未验证均须保留而非删去。

独立安装不会复制作者本地运行数据库，也不会自动出现CAMERA-09历史。可以先审查该版归档与固定源码；页面重新输入需求并启动真模型会创建新运行、产生新费用，不等同于回放历史。作者机器保留原运行时，可选CAMERA-09→“门禁与交付”→“打开受控场景预览”，先用手动按钮，再由设备持有人主动开启摄像头。

## E. 离线审阅与故障排查

- ZIP内可独立阅读主稿/PDF、播放历史Mock MP4、检查三个Mock、九次真实场景探索及09有界交付证据。离线材料不是可执行的完整后端安装包，历史视频不是09真实研发录屏。
- 文件校验：macOS `shasum -a 256 文件名`，Linux `sha256sum 文件名`，对照manifest相应条目；hash证明字节一致，不证明结论真实或日志防篡改。
- 安装故障：检查Node版本、依赖下载、Chromium安装及端口；模型故障：检查有效ID、端点、单价、Key状态和预算。报错可脱敏反馈，不截图/发送Key。
- 退出服务用本次终端Ctrl+C，不停止其他项目。需要保留数据时不要清理数据目录；分享材料时排除整个控制面数据、主密钥、配置、私人日志。
- 材料结论与在线内容不一致时，优先核对材料版本/commit，不以“最新页”覆盖旧实验。每次新实验需要新配置版本和单独原始记录。
