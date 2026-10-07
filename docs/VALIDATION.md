# Demo 验证记录

## 自动化生产 VE-04 原生观测适配增量

本新批次只在 `feature/autonomous-production`，见[观测契约](production/VERIFIER-OBSERVED-TRANSPORT.md)。源代码、工程专项、本地完整演练和最终回归分别留证；不把本地替身当真实模型或公开部署。本次修改前[全文留底](production/archive/2026-10-07-before-verifier-observed/VALIDATION.md)。下文109等计数为各历史配置，不是新适配器的成绩。

冻结源码 `3a1bedf` 专项52/52（83.057秒）；[完整免费演练](production/experiments/VERIFIER-OBSERVED-01/RESULT.md)54决策、36实际Oracle、267.672秒，36loopback POST＋18内存Jev dispatch、0供应商调用/费用。实际模型usage/效益null；独立原始账本审计通过，原有虚拟社会浏览器回归在独立4421中保持通过。最终全量结果见[批次审查](production/BATCH-VERIFIER-OBSERVED-CHECKS.md)，不把当前免费成绩套到旧真实任务。

最终 `npm test`640/640、567.545秒；独立浏览器38/38、1.3分钟；TypeScript＋Vite生产构建、diff检查通过。没有新增收费模型成绩或更新公开v5；新材料与583原件的只读审计、目录scope迁移限制分别报告。

## 2026-10-07 审查补齐增量（以下旧批次记录不覆盖）

- 最新工程回归：`npm test` 109/109、`npm run test:e2e` 5/5、TypeScript 通过；Pages浏览器检查通过，无Key实测快照、历史恢复、导入核验、失败停机及390px布局均覆盖。
- 使用本机加密保存的凭证实际执行居民问卷。当前固定批次49次模型请求，44份有效、5份无效；12人×15题基准12/12有效。五次重复、19/29元单变量、画像消融、照护者、猫狗与未见场景全部原始答卷留存。
- 当前49次请求含缓存的输入84,916、输出13,120 Token；保守API估算0.274792元（非账单）。不包括此前尝试和四角色费用。旧批次缓存输入漏计，保留原件并标注其总Token/费用未知，不追写成零。
- 本轮六次四角色实测均未通过最终Gate。最后运行`d628361c-10fb-4209-8e67-cc453114a3e4`两次返修后仍失败。不同工程版本不能组成统一配置的成功率实验；最后新增的选择器契约校验仅做工程回归，尚未重新付费实测。
- 问卷与四角色账本分离。来源标记、角色输出、冻结断言、失败Gate和源码文本均可核查；不称通用L5已证明，不宣称现实选址、定价或猫狗市场份额已验证。
- 更新7页PDF与254秒实际浏览器录屏；实测快照画面明确说明不发起新请求。原材料保存在`docs/archive/2026-10-07-before-audit-fixes/`。

详见[审查补齐与未闭合项](research/AUDIT-FIXES-2026-10-07.md)。公开部署核验记录另见下方发布增量；不能从本机或Mock推断任意供应商支持公网浏览器CORS。

### 本次公开发布核验

- `gh-pages` 普通发布commit：`ca5cb37fa87b1613e1553c94ce33270eef0a7b12`；GitHub Pages状态built。部署构建期间第一次核验看到旧资产/404，待构建完成后重测30/30状态与SHA-256一致，未将构建中结果当作最终成功。
- `scripts/check-pages-public.ts`覆盖本次全部30个资产，包括真实问卷、13组当前实验、历史负结果、六次交付失败、PDF、MP4与四份官方PDF。
- `CITY_PAGES_URL=https://litianyi-007.github.io/city-agent/ npx tsx scripts/verify-pages.ts`通过实际Chromium公网实操：12人15题规则夹具、已发布12人实测读取、导航/刷新保留历史、v2证据导出、模型协议Mock、401停止后续请求、Key不落浏览器存储/导出且刷新清除、390px无横向溢出，无页面异常。该检查没有新增真实模型请求，不能证明供应商公网CORS已付费验证。
- 本机后端在确认无活跃任务后重启，最新契约校验生效，原加密配置与历史不变。源码另以隔离临时克隆、公开文件白名单、实际Key字节扫描进行普通main分支发布；不将用户脏工作区整体暂存，不上传数据库、密钥文件或原始内部文档。
- 干净克隆的默认shell曾选中Node20，npm给出engine告警；切换已声明的Node22.22.3后安装/构建通过。新增`.nvmrc`与README提示，不把错误运行时的安装当作支持证明。
- 安装阶段另发现锁文件5项告警（2 critical、3 high），已更新上游兼容范围内的MCP、sharp与source-map-js补丁，并为concurrently固定的shell-quote旧依赖增加`1.12.0`覆盖。DeepSeek SDK仍锁定`0.1.5-rc.3`、未改源码。`npm audit --audit-level=low`当前0项；此为已知依赖告警检查，不等于完整安全审计或现实效度验证。

日期：2026-09-23；环境：macOS、Node.js 22.22.3、DeepSeek Harness SDK 0.1.5-rc.3。

| 检查 | 结果 |
| --- | --- |
| `npm run build` | TypeScript 与 Vite 生产构建通过 |
| `npm test` | 52 项通过，无跳过或失败 |
| `npm run test:e2e` | 4 个浏览器场景通过，含两个业务mock、桌面/390px 手机宽度 |
| `git diff --check` | 通过 |
| 原文留底逐字节比对 | README、PRODUCT、ARCHITECTURE、ROADMAP 均与 `111027d` 相同 |
| 本机工作台实际操作 | 原通用示例保留；新增学生/宠物两个mock各完成四角色与真实Gate，各12个产物 |
| 人口包CLI预检 | ready，16/16结构检查，原件SHA-256与字节数通过 |
| 人口包冻结回归 | 追加每次run的population-pack.json后，8项编排/业务case测试再次通过 |

实际默认目录 `.city-agent/` 暴露出 Express 默认拒绝隐藏路径的问题，已在通过产物白名单与 realpath 检查后允许读取该精确文件，并增加隐藏数据目录的 HTTP 回归检查。

## 验证覆盖

- 11 项 API/存储：加密与脱敏、复制、冻结配置/输入、无效输入、单运行限制、Origin/Host、防路径逃逸、隐藏目录产物交付、取消、重启及实例锁。
- 6 项人口模拟：官方边际加总、样本/权重守恒、种子复现、共同样本价格响应、provenance、边界输入。
- 2 项页面模板：离线运行、任务/商品注入防护、价格交互、600 样本最大规模。
- 6 项 Gate：交互约束、实际 Chromium、无效价格交互失败、坏脚本失败、网络阻断和取消。
- 4 项 Harness：真实 SDK 的独立角色路由、OpenAI 兼容 SSE、Anthropic 原生 SSE、usage、失败脱敏、取消连接。
- 4 项编排：演示完整交付；真实 SDK + 本地模型替身 + 真实 Chromium 的失败返修；供应商失败；实际执行中取消。核对断言在研发前冻结且保持不变，模型快照不变，产物 SHA256 正确。
- 1 个 UI 场景：复制、改角色/模型/Key、保存后刷新、密钥不回传、城市事实、模式限制、运行、产物 iframe 交互、调研结果、记录恢复、手机宽度无横向溢出。
- 11 项通用人口模型/CLI：完整边际、口径冲突、缺失不填零、整数精度与汇总、引用/重复/年龄分组、真实联合表与公开零、零人口子区域、版本hash、确定性减法链、原件hash/路径与编译不覆盖。
- 4 项人口HTTP：独立近期数据、上传预检不激活、原件附件与指纹、拒绝私有路径和符号链接越界。
- 4 项研究case：学生和宠物各自完整四角色mock与真实Chromium；历史年龄不是在校生、文本注入；live结构校验拒绝省略needs-data并重试、系统断言不可移除。
- 3 个新增UI测试：人口逐格追溯/派生男性/原件下载hash/空模板阻止/mobile；证据损坏时隐藏数字；两个业务示例依次完整执行、切换假设与勾选补采计划，不出现接受率且不改变needs-data。

独立审查发现过一个真实缺陷：overview在原件hash失败时返回blocked，但前端曾只看结构审计，仍展示绿色数字。现已检查总状态及逐份原件结果，在失败时阻止数字展示；增加浏览器回归。源模型/调查接口本身已校验原件并拒绝损坏数据。

## 用户两例的实际运行留存

| 场景 | 本机运行ID | 工程结果 | 研究结果 |
| --- | --- | --- | --- |
| 小学生零食店 | `9bf7c5ae-7adc-449c-9381-68e54de439c2` | 四角色完成，Chromium Gate通过，12份产物 | needs-data；15+样本不适用，无学生偏好/具体选址/定价结论 |
| 宠物零食网点 | `e5d9295b-728c-4b50-92f2-a9941e66e4b6` | 四角色完成，Chromium Gate通过，12份产物 | needs-data；养宠、猫狗、线上客群与价格证据未补齐 |

以上在实际Chrome的4310工作台提交，不是只在临时测试目录运行；历史列表可回看。均为demo、modelCalls=0、realL5Evidence=false、marketResearchValidated=false。每份manifest记录population快照与sourceHashes；通用survey.json附applicableToTask=false，不设置run.survey、不进入商业结论。

本轮固定数据包：`hangzhou-binjiang-2020 / 2026-09-23.1`，SHA-256 `46433cba846a0a5314a26809e166b8203520188490bdd98b7ca52db98e16b6a0`。原件指纹、逐格事实与近期口径冲突见 `docs/population/`；不能把总量一致当作真实偏好验证。

## 证据解释

Harness 和 Chromium 均实际执行，测试模型回复由本地 SSE 固定服务提供；没有调用用户真实付费模型。真实供应商凭证、真实模型对需求的理解与产出质量，以及真实市场有效性，均不能从这些测试推出。

无 Key 工作台演示保留在本机 `.city-agent/`，文件被 Git 忽略。集成测试使用独立临时数据目录；不将测试假 Key 或固定模型回复混入用户团队配置。

## 2026-10-07 外网与申报批次

- `npm test`：100/100通过；`npm run test:e2e`：4/4通过。
- `npm run build` 与 `npm run build:pages`、TypeScript、`git diff --check`通过。
- `scripts/verify-pages.ts` 分别从本机4173与公开HTTPS网址完成实际Chromium操作：15题/12人完整规则答卷、预设编辑与复制、Key不在local/session存储或导出中、刷新清除原预设及副本Key、390px零横向溢出、无页面异常。
- Mock Chat Completions：验证凭证只发指定接口、模型ID、非流式与usage；模拟401后只请求1次，其余2人记not-started，usage/费用未知。不计为供应商实测。
- 七普与近期来源全部核验字节数/SHA-256后复制公开附件。新样例 `85665559-8d20-44d4-9d81-cd9b8b02349c`：12人、15题、规则执行14.894ms（不含启动/渲染/网络）、0次模型调用、0 Token、0 API费用；市场效度未验证。
- 项目申报PDF7页：最新版本逐页Poppler渲染目检；问卷、统计、技术参数、人口/角色方法、创新和业务价值、未完成项及体验链接完整留存。
- 实际浏览器录屏254秒，1600×900，H.264 MP4，中文字幕；抽查介绍、模型配置、结果、画像与导出画面，无真实凭证出镜。不以规则演示字幕冒充模型实测。
- GitHub `gh-pages` 发布commit：`21a0b2a41e910d761c5cbc7666917950e4c01fc6`；Pages状态built、HTTPS开启，网址 <https://litianyi-007.github.io/city-agent/>。首页、材料、PDF、视频、样例证据与七普PDF均返回200，下载SHA-256与本机构建一致；完整清单由 `scripts/check-pages-public.ts` 检查。

原始验收记录保持不变。本批只完成浏览器居民执行切片，未托管Harness后端、未验证实际模型回答质量，未完成跨题自洽/重复/变量实验，也未证明真实学生/宠物市场选址或售价。详情见[本批交付](research/PAGES-SUBMISSION-2026-10-07.md)。
