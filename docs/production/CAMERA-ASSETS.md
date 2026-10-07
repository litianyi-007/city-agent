# 受控摄像头资产准备（mediapipe-hand-v1）

本页仅描述平台开发者审查并准备的依赖，不是模型生成代码、真实摄像头测试或 Agent 自主交付成功证据。资产准备和生成代码执行必须分开；不运行 npm 安装脚本，不引入项目依赖，不采集摄像头或私人视频。

## 冻结来源与许可

- 固定 `@mediapipe/tasks-vision@0.10.32`，npm 发布时间为 2026-01-22。2026-10-07 查询时 latest 已是 1.1.0（前一天发布），本切片沿用文档和经典 Worker 可验证的 0.10 API，不自动升级大版本或使用 latest。升级须新资产配置与回归。
- 官方 release `v0.10.32` 对应完整 commit `8317ba78778738ba90a521e7e4580a2ba0129c81`。[源码快照](https://github.com/google-ai-edge/mediapipe/tree/8317ba78778738ba90a521e7e4580a2ba0129c81)
- npm 包无 `gitHead`。上述 tag 是源码关联标识，不证明 npm 二进制可从该 commit 逐字复现。包 SHA256、npm SHA512 integrity、成员 SHA256 均在 [冻结清单](../../shared/camera-asset-manifest.ts)。
- 官方模型 `hand_landmarker/hand_landmarker/float16/1` 来自 Google Storage，不使用滚动 latest。[官方任务概览](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker)
- 完整 Apache-2.0 `LICENSE` 从上述固定 Google 仓库 commit 下载并保留，含末尾文件特定许可；生成的 `NOTICE` 标明作者、版本、路径扁平化与未改字节。官方概览所链 2021-10 模型卡也标 Apache-2.0，原 PDF 留底；其日期不是当前 `.task` 包发布时间，不推断二者可复现构建关系。

第三方源码治理技能已用于来源 commit、留底和升级边界核查。本切片无 fork、源码定制或上游同步，故不创建伪造的源码工作副本及 commit cache；真实身份是 npm 版本＋完整性值＋逐资产 hash。未来定制源码时再按技能完整建立源码治理文档。

## 准备与离线核验

在独立生产 worktree 内使用 Node 22.22.3：

```sh
/Users/litianyi/.nvm/versions/node/v22.22.3/bin/node --import tsx scripts/prepare-camera-assets.ts --self-test
/Users/litianyi/.nvm/versions/node/v22.22.3/bin/node --import tsx scripts/prepare-camera-assets.ts
/Users/litianyi/.nvm/versions/node/v22.22.3/bin/node --import tsx scripts/prepare-camera-assets.ts --verify
```

运行目录必须显式设置为 `/Users/litianyi/Documents/Code/_ai-goods/city-agent-autonomous-production`。输出仅为本分支已忽略的 `public/camera-assets/`。已有资产先逐项核验，正确则复用；缺损、额外文件、symlink、hash 变化或部分完成均失败，不覆盖、不自动修复。运行 `--verify` 不联网；它比对源码 pin，不信下载后的 manifest 自报值。

脚本只访问冻结 exact URL：官方 npm registry tarball、Google Storage 模型及模型卡、Google 官方 GitHub 固定 commit LICENSE；拒绝重定向、URL 自定义及安装脚本。流式下载每项上限 8 MB、30 秒，tarball 限 6,939,067 B，解压上限 26 MB/100 成员；只解析普通文件，拒绝 symlink、路径穿越、重复与不支持的 tar 元数据。全部 hash 通过后写分支本地 staging，独占创建目标，manifest 最后落盘。失败留下的部分目标不会被当作可用依赖，应先检查原因再明确处理。

|运行资产（全部扁平存放）|字节|SHA256|
|---|---:|---|
|vision_bundle.mjs|137160|de83c48ff329717a27aeb528d5ef5f47f077c628a5302dc483aca5b513e7464b|
|vision_wasm_internal.js|204816|6f6b86509cf9e163ea1cfec7edc8cf53732699c04781e4c21c557c1ba402310e|
|vision_wasm_internal.wasm|11453626|cb3ec20026a9aecc2a81a93c25630ceb5389297ddb7a5f0bd61dd09cde606b9b|
|vision_wasm_nosimd_internal.js|204669|9f8fc960e363f0fb2f42f7937b97ae9cf9a5630490f71031fa90caa9bb121938|
|vision_wasm_nosimd_internal.wasm|10647962|924274fcd5ac8985f6570a8573e7971b7bd2d580ba1b8f3beb0ba8f95db6347c|
|hand_landmarker.task|7819105|fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1|

另保留 `PACKAGE.json`、`MEDIAPIPE-README.md`、`LICENSE`、`MODEL-CARD.pdf`、`NOTICE` 与 `manifest.json`。完整 hash 与长度由源码及准备后的 manifest 给出。二进制总量约 30.5 MB（十进制）；首次下载约 15.1 MB（含压缩包），不据此承诺设备帧率。

## 固定可信 Worker 接入

后端只能从源码 pin 的普通本地文件返回 `/api/production/camera-assets/:filename`，不得允许任意路径或 runtime 下载；没有有效准备资产须明确不可用，禁止 CDN 回退。`application/wasm`、模块 JS MIME 应正确返回。`FilesetResolver` 根目录就是扁平 asset route，不是 `wasm/` 子目录。

建议经典 DedicatedWorker（默认 `new Worker(url)`），在异步初始化内 `await import('/api/production/camera-assets/vision_bundle.mjs')`。0.10.32 的 loader 使用 `importScripts`；直接改 module Worker 会遇到缺少 `document`/`importScripts` 运行方式冲突，不能未经实测声称兼容。不改 vendor 字节。

初始化采用 `FilesetResolver.forVisionTasks('/api/production/camera-assets')` 和 `HandLandmarker.createFromOptions(fileset, {baseOptions: {modelAssetPath: '/api/production/camera-assets/hand_landmarker.task', delegate: 'CPU'}, runningMode: 'VIDEO', numHands: 1})`。传入 `detectForVideo(frame, timestampMs)` 的时间戳须递增，重复帧不重复推理；同步调用在 Worker 单并发执行，限频并关闭帧引用。GPU/跨设备优化另开验证，不借用官方手机 benchmark 作为本机测量。

模型只输出 21 个关键点及 handedness，不直接给张掌/握拳/捏合标签。手势分类、平滑、滞回、失手状态和控制映射属于独立平台策略，应版本化、冻结、测试。设备帧不进 Prompt、日志、证据或交付包。

## 外传和证据边界

固定包的 browser bundle 与两个 loader JS 静态检索未发现 telemetry/analytics/sendBeacon 或 HTTP URL 字面量；loader 含 `WEBGL_SHADER_CALC_METRICS` 本地 GPU 查询计时字段，文件仍含本地资产 fetch/loader 能力。这不能证明编译 WASM 无遥测。[当前官方隐私声明](https://github.com/google-ai-edge/mediapipe#privacy-notice) 说输入在设备处理，但 Tasks APIs 可能传输使用与性能指标。

必须以受控 runtime 的外联阻断、严格本地资产许可与实际请求账本做回归，不能仅用 CSP 或字符串扫描宣称绝对安全。当前 prepared manifest 的 `runtimeEgressVerified` 为 false：准备成功不等于浏览器推理/真实摄像头通过。合成关键点、授权录制视频、假摄像头 E2E、真实实机项分别记证据；禁止混合成自主生成成功率。
