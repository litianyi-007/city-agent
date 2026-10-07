# RC3：固定源码、Pages与评委体验发布实证

日期：2026-10-08，北京时间。正式比赛提交状态以用户的比赛回执为准；本文记录工程发布及独立模型能力验收，不替代用户验收或现实市场验证。

## 可访问入口与固定版本

- [直接体验调查 Demo](https://litianyi-007.github.io/city-agent/#research)
- [最新材料与三轮独立接口记录](https://litianyi-007.github.io/city-agent/review-updates/2026-10-08/)
- [安装、三种模式与费用指南](https://litianyi-007.github.io/city-agent/review-guide.html)
- [固定源码下载](https://github.com/litianyi-007/city-agent/releases/tag/society-responses-review-2026-10-08-rc3)

固定Tag `society-responses-review-2026-10-08-rc3`，源码commit **`f12293c81632a930842d2545fc2f7cf98e06f5fb`**；只推现有 `feature/virtual-society-next`，没有推main或移动旧Tag。后续文档证据提交不移动此安装基线。

Pages commit **`a53ace36d72d0e8f33091ae6c4aab7b86fe2fc7c`**，前一commit `2245245531b44891e8a00c7b08876dccf74c27ca`。GitHub报告built，时间UTC20:57:13—20:57:51；没有修改Pages配置。

## 工程、实网和业务意义分层

| 层次 | 本批证据 | 含义 |
| --- | --- | --- |
| 完整离线工程 | `system-udYnvf`：589/589单测、20/20浏览器、149/149 Responses专项、Pages类型构建；58357.471792ms | 197运行源码起止hash匹配、179历史原件不变、8完整日志匹配；0模型请求 |
| 原协议失败 | f3：1实际请求、0通过/1失败/1未启动，unknown用量和¥0.06465预留封存 | 事后phase回放不升级原实网失败或补结算 |
| 旧知识契约轮 | 143651dd：2实际请求、1通过/1失败，9677＋288tokens、保守¥0.021658 | 可达街道无依据推断被阻断；理解题输入/判定不对称另修，原failed保留 |
| 新契约独立轮 | 50992659：2实际请求、完整17/18题能力2/2，9942＋287tokens、3263.045583ms、保守¥0.02218，closed/finalized | 未重试/补样/换模型；完整协议、结构、登记逻辑、合成资格及unknown边界合规 |
| 内容充分性 | 新轮业务题分别已知0/12、0/14 | 缺消费资料时保持合法未知；不认证儿童口味、猫犬销量、价位或选址 |

新Prompt1.1明确“定义提供≠居民理解已观察”和“住址≠消费可达资料”，没有答案表入模型输入，没有放宽schema/逻辑/资格或未知门。两名非作者及根代理复核；独立手写gold与6类反例通过。新注册1.3封存0-call与前两真实原件链、私有授权回执和独立预算；默认同类小额授权不重开旧账本、不扩10＋10。详见[知识契约与实验实证](KNOWLEDGE-CONTRACT-REVIEW-2026-10-08.md)。

预算估价采用冻结高峰非缓存价，不是供应商发票。未知费用保留null，部分已知usage不代表整轮金额。Responses仍为有界实验候选，未激活默认API/UI；Schema逐关键字强制执行、市场/人格贡献与真人校准不由能力通过认证。

## 安全发布和实际公网复验

独立发布器不读任何模型Key/DB、不调用模型。dry-run校验全部原始工程日志、当前源码、179历史与三轮闭合报告/账本。execute检查源码/Tag/远端HEAD、每个运行源文件与已提交字节、公开三载荷和guide、现有Pages配置后，隔离浅clone部署。

既有 **502个tracked文件** 全部取hash；仅index和guide更新且先原字节归档，其余文件逐个保持原样。归档路径 `milestones/before-society-responses-review-2026-10-08-rc3/`。发布器选择17载荷（15条实际变更，2项已有相同hash资源）；未删除文件，不force、不改仓库设置。旧PDF、ZIP、视频、负结果、账本与L4/L5分支不由本批更改。

真实公网HTTP核对 **61文件** 全部200、bytes/SHA256匹配：17本批载荷＋42仓库历史证据＋历史PDF/视频；另4历史目录/PDF入口HTTP200。公网浏览器新context完成两场景17/18题各12画像的fixture完整运行、证据/独立诊断下载、刷新历史恢复、390px无横向溢出与最新摘要三轮记录展示；pageerror/失败请求/越界请求均0，供应商请求0。这不是新的付费Pages CORS实测。

本机固定Tag新目录完成git clone、npm ci（608包、审计0已知漏洞）、setup、build、doctor八检查、start:review独立4336端口及同样两场景浏览器流程。实测macOS arm64 / Node22.22.3，SDK与实际dsh均0.1.5-rc.3；没有原配置或Key复制。只代表同机新目录，不宣称Windows/Linux或评委电脑已实测。

首次发布因最小子环境未带GitHub CLI配置位置，在只读Pages配置检查处停止、未改线上。随后以私有operator工具明确复用既有GH配置目录，没有复制token/模型Key、不改源码/Tag。第一次本机smoke在IndexedDB异步加载前立即数option导致断言失败，负记录保留；改为等待后通过，没有产品改写或付费重跑。CLI成功null stopReason的控制台fallback也已单独修正，原真实JSON不改。

## 本机留档（不上传私有原件）

以下output路径仅本机有效，公开审查请用顶部URL及精简status；hash用于获授权后核对原件，不作为现实真值或发票认证。

- 发布回执：`output/pages-review-publish/review-tLgClw/receipt.json`。
- 公网字节复验：`output/offline-review/rc3-http-oQWaxg/report.json`。
- 公网流程、4下载及移动截图：`output/offline-review/rc3-browser-rIbmFg/`。
- 固定Tag安装后的本机流程：`output/offline-review/rc3-browser-L8Q6AE/`；首次负记录 `rc3-browser-zXckCU/failure.json`。
- 完整工程proof：`output/offline-review/system-udYnvf/`。
- 新真实原件：`output/live-capability-proof/50992659-bdbc-4c2a-a3eb-ee288768b40e/`（0700/0600）。

## 下一研究门

工程公开体验与最小接口能力已完成。候选API/UI显式选择、Schema因果对照、10＋10/30人研究、语义盲评/题序重测/人格消融、现实采购与可达观测继续按独立计划验收；不因同类费用默认支持而省略设计或扩大样本。MCP现实桥、独立居民记忆/wiki/dream和有限自主接管保持远期路线，另会话L4/L5保持独立。
