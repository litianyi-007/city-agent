# 评委快速开始：选择正确的体验路径

**2026-10-08独立更新：[直接体验](https://litianyi-007.github.io/city-agent/#research) · [最新工程/接口摘要和三分钟路径](https://litianyi-007.github.io/city-agent/review-updates/2026-10-08/) · [本批固定版本下载](https://github.com/litianyi-007/city-agent/releases/tag/society-responses-review-2026-10-08-rc3)。** 本批固定Tag为 `society-responses-review-2026-10-08-rc3`，完整SHA以Release/Tag核对。以下RC1/RC2实测各自保持历史记录，不再称为本批接口探测；新Responses仍是候选而不是页面默认路径。新增页面费用确认，真实模式默认1人，变更问卷/样本/seed/单价会撤销同意；无Key核心流程保持零费用。

原始响应、授权及本机 `output/` 证据不在GitHub源码中；公开白名单摘要提供各轮运行ID/hash，不以404的私有原件链接作为评委入口。旧PDF和视频保持原样，来源及五层方法可通过上面的公开页直接访问。

**无需安装即可查看：[公开 Demo](https://litianyi-007.github.io/city-agent/) · [RC1完整申报材料 · 历史保留 · 契约1.0](https://litianyi-007.github.io/city-agent/submission-next/index.html) · [RC1契约1.0真实测试报告](https://litianyi-007.github.io/city-agent/submission-next/live-proof/report.md)。** RC1 部署记录见[发布审查记录](../research/LIVE-REVIEW-2026-10-07.md)；[旧冻结材料](https://litianyi-007.github.io/city-agent/submission/index.html)保留。契约1.1（小学联合0/10、宠物联合3/10、¥0.042032）不在这个 RC1 链接里。

本指南随虚拟社会续作 F001 公开评审候选提供。新工具源码分支为`feature/virtual-society-next`，拟固定Tag为`society-review-2026-10-07-rc1`；须在发布记录确认Tag和完整commit SHA后下载，不把浮动分支或拟定Tag写成已验证安装来源。旧Tag`submission-milestone-2026-10-07`只有原基本启动方式，**没有`doctor`或`start:review`命令**。材料ZIP是材料及证据，不是程序安装包；源码ZIP须另核对它的版本/清单。

RC1 / 契约1.0 历史真实 API 测试（不是契约1.1）已执行：7确认请求（3居民、2规划、2CORS），input15,418/output6,881 Token，保守估算¥0.085884，不是供应商账单。20计划居民只有1份结构/跨题/资格联合通过、17未启动；小学联合0/10、宠物联合1/10，两个10人门限均失败。规划0/2可应用候选，2次CORS HTTP200只证明协议。未重试、补答、替换样本或执行30人扩容；合成居民仍不是真人市场验证。RC1原文、失败、参数和账本见上述报告及[JSON](https://litianyi-007.github.io/city-agent/submission-next/live-proof/report.json)。契约1.1另册为小学联合0/10、宠物联合3/10、15未启动、5次请求、¥0.042032。

## 三种路径

| 希望验证 | 准备 | 实际执行与边界 |
| --- | --- | --- |
| 看界面、规则演示和真实实验留档 | 浏览器；无需 Key | 新版材料另册公开7请求及失败/未启动；旧12人15题及49次实验保留。快照不是评委此刻的新运行；工程夹具始终0调用，不是 LLM 证据 |
| 在线重新运行居民问卷 | 页面填写自己的 Provider、Base URL、Model ID、Key及有限预算；模型接口允许浏览器 CORS | 浏览器直接调用供应商，不经过 Harness；Key仅本次页面会话使用，刷新清除。已做2次真实Pages origin协议HTTP200，未验证新版UI完整长问卷链，不保证其他供应商/账户CORS |
| 本机复现 Harness 问卷及四角色流程 | 源码、Node 22.22.3、npm依赖；页面验收另需Playwright Chromium；真实调用另需模型 Key/余额 | 本机后端使用锁定 Harness SDK 0.1.5-rc.3。无需本地GPU、模型权重或全局 dsh。四角色六次真实交付均未通过最终 Gate；安装成功不证明自主开发交付成功 |

## 先准备运行环境

- Git、Node.js **22.22.3**（本项目实测版本；最低22.19.0，Node20不满足要求）。更高版本满足最低检查，不代表项目已在该版本实测。
- 能访问 GitHub、npm、Playwright 浏览器下载源。真实实验还需访问自己的供应商 API；无需安装本地模型。
- 已完成项目实测的操作系统：macOS。Windows/Linux代码路径与下列命令可供复现，**未完成本项目干净机器验收**；doctor会提示而非无条件阻止。
- 如使用macOS/Linux的nvm，在源码根目录执行 `nvm install && nvm use`，再确认 `node --version` 为 `v22.22.3`。Windows可安装对应Node发行版；不要假设Unix nvm命令适用于Windows。

## A. 现在就能下载的旧冻结版源码

在新的目录执行，避免覆盖已有项目：

```bash
git clone --branch submission-milestone-2026-10-07 --depth 1 https://github.com/litianyi-007/city-agent.git city-agent-review
cd city-agent-review
node --version
npm ci
npm run setup
npm run build
npm start
```

打开 `http://127.0.0.1:4310/#research`。保持终端运行；用Ctrl+C停止。若该端口占用，不要终止别人的服务，可按下文显式配置独立端口、专用数据目录。冻结版仍使用原启动入口，不能运行下节新增的 npm 命令。[冻结版源码说明](https://github.com/litianyi-007/city-agent/blob/submission-milestone-2026-10-07/README.md#启动)。

## B. 本批独立固定源码的评委启动

先核对本批GitHub Release的 `society-responses-review-2026-10-08-rc3` 与完整commit SHA。如尚未取得该固定版本，先用公开页面或历史A路径，不下载同名浮动分支。确认发布后在新的目录执行：

```bash
git clone --branch society-responses-review-2026-10-08-rc3 --depth 1 https://github.com/litianyi-007/city-agent.git city-agent-review-rc3
cd city-agent-review-rc3
git rev-parse HEAD
```

将输出的完整SHA与发布记录比对，再在该源码根目录安装。也可用交付的源码ZIP解压到新目录；`SOURCE-SNAPSHOT.json`或发布打包清单记录具体文件与字节指纹，不含Key/数据库。旧离线候选ZIP只代表其原生成快照，不自动等于最新固定Tag；材料ZIP不能直接运行程序。`npm ci`会下载/安装锁定依赖，需操作者明确执行，源码校验不等于跨OS验收。

```bash
node --version
npm ci
npm run setup
npm run build
npm run doctor
npm run start:review
```

打开 **`http://127.0.0.1:4320/#research`**。启动器先自检再启动已构建的服务；不会自动下载、构建、换端口、复制Key或调用模型。默认使用本源码下独立的 `.city-agent-review/` 数据目录，不使用其他工作目录数据。该目录Git忽略；不要作为交付物发送给别人。

可以同样在Windows PowerShell、macOS/Linux终端使用跨平台CLI覆盖：

```bash
npm run doctor -- --port 4330 --data-dir .city-agent-review-4330
npm run start:review -- --port 4330 --data-dir .city-agent-review-4330
```

对应访问 `http://127.0.0.1:4330/#research`。不要仅修改Vite端口而仍连接另一项目的API。

`npm run doctor -- --json` 输出结构化报告；npm本身会先打印命令头，自动化要纯JSON时直接执行 `node --no-warnings scripts/doctor.mjs --json`。

退出码：`0`前提就绪（允许有平台未实测警告）；`1`某项检查失败；`2`参数错误。doctor只读检查Node、SDK/dsh同版解析、SQLite模块、dist资源、Chromium文件、端口与目录前提；不读取私有配置、不创建数据库、不安装或请求模型。Chromium文件存在不证明Linux共享库或实际启动可用；dist文件存在也不证明源码已重新构建。

### 第一次页面体验

1. 打开“虚拟社会调查”，选择一个问卷模板和目标人群，进行资格与数据预检。
2. 先运行明确标注的规则夹具，验证界面、统计、保存和导出，无模型费用。
3. 如需真实调用，在人群Agent页面填写自己的模型连接与Key；用供应商实际支持的Model ID，不保证预填ID可用。
4. 明确限定样本数、调用与Token预算，主动点击真实运行。不要将Key输入研究文本或问卷题目。
5. 检查逐份原文、无效与失败答卷、usage与费用口径，导出证据。usage未返回不等于免费，统计成功不等于真人市场有效。

页面中费用确认不是供应商钱包硬限额，结构无效也不会自动停止所有后续居民。受控实验CLI另用持久预算账本、冻结计划和单请求代理，未知/超限/失败会全停；不能把此保护宣称为任意页面调用都受金额硬限制。请先选1人，核对价格和原文后再自行决定下一轮。不要直接运行付费实验脚本来“自动复现”：该脚本需要操作者专用注册材料与授权，不是普通安装入口，旧账本不可自动恢复或清除重跑。

本机Key由服务端加密保存；同机账号仍可访问密钥文件。不要公开监听该服务，也不要复制数据库、密钥或本地日志到申报附件。

## 开发与测试端口

本续作默认API4320、Vite5180、浏览器回归4321，与原工作目录隔离。开发时API和Vite代理读取同一个 `PORT`；`CITY_AGENT_WEB_PORT`指定前端端口，`CITY_AGENT_DATA_DIR`指定独立数据目录。Vite设置strictPort，测试不复用已有服务器；占用时失败，不自动杀进程或静默换端口。

如需改端口，macOS/Linux：

```bash
PORT=4330 CITY_AGENT_WEB_PORT=5181 CITY_AGENT_DATA_DIR=.city-agent-dev-4330 npm run dev
CITY_AGENT_TEST_PORT=4331 npm run test:e2e
```

Windows PowerShell：

```powershell
$env:PORT='4330'
$env:CITY_AGENT_WEB_PORT='5181'
$env:CITY_AGENT_DATA_DIR='.city-agent-dev-4330'
npm run dev
```

浏览器回归有单独临时数据目录；不指向评委或另一worktree数据库。日常评委体验不必运行测试。

## 故障处理：不要绕过检查

| 症状 | 处理 |
| --- | --- |
| Node20、缺node:sqlite或SDK启动失败 | 切换Node22.22.3，重新执行 `npm ci`；切换Node后旧原生模块需要重新安装 |
| SDK/dsh版本不一致 | 使用锁定源码的 `package-lock.json` 执行 `npm ci`，不装全局dsh、不手工升级其中一个包 |
| 缺dist或资源 | 执行 `npm run build`；`build:pages`生成的dist-pages不是本机应用 |
| 缺Chromium | 显式执行 `npm run setup`。已有普通Chrome不等于项目锁定的Playwright浏览器 |
| Linux启动浏览器时报缺共享库 | 请管理员参考Playwright官方系统要求及 `npx playwright install-deps chromium`；该操作可能改系统包并要求管理员权限，不由doctor或启动器自动执行 |
| npm安装原生模块失败 | 先检查平台/CPU、Node版本与下载网络。仅在明确出现编译回退时，按node-gyp官方要求安装Python和本机编译工具；macOS通常为Xcode Command Line Tools，Linux为make/C++工具链，Windows为相应Visual Studio C++构建工具。不要将其视为所有机器都必须安装 |
| 端口已占用 | 用 `--port`/`PORT`指定独立空闲端口，不结束不属于本项目的进程 |
| 目录被另一服务持有 | 选择新的专用数据目录，或由所属用户正常停止该服务；不得直接删数据库或锁 |
| 浏览器真实请求被CORS拒绝 | 改用本机Harness路径，或使用供应商明确支持的浏览器接口；不要禁用浏览器安全限制、把Key发给公共代理 |
| 401/403、模型不存在、额度不足 | 核对页面配置和账户权限；减少样本/预算。不要把供应商报错当作空答卷或零成本成功 |

安装命令的下载和系统变更必须由操作者明确执行；自检/启动器本身不代执行。官方参考：[Harness SDK](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/sdk/client/README.md)、[Playwright浏览器及系统依赖](https://playwright.dev/docs/browsers)、[node-gyp安装要求](https://github.com/nodejs/node-gyp#installation)。文档链接不代表本项目已在所有上游支持系统验收。

## 验收时请核对

- 当前是公开快照、规则夹具还是本次真实模型运行？记录ID是否可追溯？
- 是否保留全部失败、取消、无效答卷与未知费用，而非只展示成功？
- 人口事实、联合推断、人格假设与模型答复是否被明确区分？
- 两个开店案例目前仍缺现实业务证据，不能给出可信铺位、猫狗主营比例或盈利承诺。
- 本机安装/工程测试成功不代表四角色真实最终Gate通过，也不代表Windows/Linux已实测。
