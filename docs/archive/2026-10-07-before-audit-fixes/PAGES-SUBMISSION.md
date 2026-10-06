# 外网问卷 Demo 与申报准备

本批响应：API Key 改在页面填写；部署 GitHub 支持外网访问；准备命题申报材料及 3-5 分钟实际功能录屏。

## 体验与材料

- Demo：<https://litianyi-007.github.io/city-agent/>
- 人群模型设置：<https://litianyi-007.github.io/city-agent/#residents>
- 项目材料：<https://litianyi-007.github.io/city-agent/submission/index.html>
- 录屏：<https://litianyi-007.github.io/city-agent/submission/demo.mp4>
- 文字材料、PDF、来源原件、问卷、画像、Prompt、运行证据、账本集中在 `public/submission/`。

以 `docs/VALIDATION.md` 新增的外网健康检查为准，不以构建成功推定已发布。

## 运行边界

GitHub Pages 只托管静态页面。保留本机 Express / DeepSeek Harness 四角色工作台；另建 Pages 入口，共用人口编译器、任务契约、模板和问卷配置 UI。

公开页可编辑问卷、配置/复制人群、预检、覆盖抽样、逐人独立调用模型、校验答卷、计算未加权统计和导出证据。它不运行本机四角色研发流程、任意工具或独立 Chromium Gate，不代表完整 WP3-WP5 完成。

Key 由用户在预设编辑器输入，只放在模块内存 Map；不写 localStorage/sessionStorage、不包含在公开配置或导出中。刷新后重填，复制可继承本次会话 Key。Key 会发给用户指定的模型服务，须信任该地址。仅 Provider/Base URL/Model ID 等非密钥配置和草稿保存在该浏览器。

真实模式最多12人，顺序执行，每人1次，不自动重试，单次输出上限3000 Token，超时90秒；供应商错误停止后续请求，保留 failed/not-started 分母。接口必须允许 HTTPS 浏览器跨域访问，不能把 CORS/网络/鉴权失败静默降级为工程答卷。没有 usage 或单价时费用保持未知。

附带样例：AI生活服务会员15题、12个覆盖画像、seed42，全部来自有界规则夹具，API调用/Token/费用为0。不等于实际模型作答，更不代表滨江真实人口偏好。Mock HTTP 仅用于协议验收，不纳入模型实测材料。

## 人群与问卷方法

来源原件全部核对字节数与SHA-256，再复制四份官方PDF。历史人口框与近期区级总量分开。24个街道×年龄×性别逻辑单元为独立性推断；成年预设需切分15-59档，具体年龄标为假设，不能算出准确18+人口分母。业务资格与行为不由人口学分类自动推出。

本批是覆盖抽样而非概率样本，无总体权重。五题型严格检查稳定ID、必答、未知/重复选项、范围与居民ID；失败答卷不进入有效统计，但计划人数不丢失。原始答卷、Prompt原文与指纹、问卷/人口/画像指纹、模型公开配置及 usage 同时导出。

## 可复现命令

```bash
npm ci
npx tsx scripts/prepare-submission.ts
npm run build:pages
npm run preview:pages
npx tsx scripts/verify-pages.ts
npx tsx scripts/render-submission.ts
npx tsx scripts/record-submission.ts
ffmpeg -y -i output/submission-video/city-agent-demo.webm -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart -r 25 public/submission/demo.mp4
npm run build:pages
npx tsx scripts/publish-pages.ts
```

首次制作PDF须遵守所用PDF技能的操作标记要求；上述是项目生成器步骤，不替代技能要求。浏览器脚本需已安装 Chromium，视频编码需要 FFmpeg。

发布器只复制 `dist-pages` 白名单到独立临时 gh-pages checkout，通过普通 commit/push 发布并启用 Pages；不会提交主分支脏工作区，不上传 `.city-agent`、`.hopper`、内部文档、留底或用户密钥。更新不 force-push；此前哈希资产可以保留。发布后仍需检查公开链接与浏览器流程。

## 尚需补齐

1. 页面填写真实凭证，运行至少一份完整 live 问卷并保留 usage、耗时、失败和费用依据；现阶段未获凭证，未调用付费供应商。
2. 补跨题自洽、无缓存重复与价格/权益等单变量实验；规则夹具不能证明这三类社会合理性。
3. 将居民执行器与四角色 Harness 页面交付线连接，并评测至少两种实际模型。
4. 扩展交叉统计、画像/属性消融、数据驱动目标分母与权重；真人/业务对照作为后续增信。

原计划的记忆、dream、MCP外部现实输入与长期社会运行时仍未实现，未混入本批能力声明。
