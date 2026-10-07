# CAMERA-04：真实请求完成，完整自主交付失败

本次按 [预登记](CAMERA-04-PREGISTRATION.md) 从前端仅启动一次。平台源码 `96d5ca6f0d2e8dc1d49e548ed22125ba50caa16c`，干净构建时间2026-10-07T03:34:58.178Z。run `6d347d58-022b-4910-b8a7-649e9ab907b4`，创建03:36:16.318Z，结束03:36:57.812Z，墙钟41465ms。

## 结果与计量

终态 failed，错误为 `acceptance Verifier 校验失败，未默认为通过`。7次Harness角色请求+4次Jev=11次实际请求；输入73875/输出6366Token，usage已知。角色费用0.018642300 USD，Jev0.001457820 USD，总估算0.020100120 USD，非供应商账单。自动返修0次、系统内介入登记0次；后者不能证明系统外行为。

实际调用了产品、研究、项目经理、测试、Verifier五种角色，研发未开始。仅前三阶段有选中输出；没有冻结契约、最终Gate、HTML或scene交付。所有摄像头合成行为/视觉/实体设备/完整验收标记均未通过。

Jev四次状态依次 uncertain/accepted/uncertain/uncertain，三次不确定升级一次独立LLM；未触发v3算术异常分支。因此不能说本次验证了真实协议漂移恢复或真实自主研发成功。

## 原始失败与因果边界

验收Verifier call `67bfdc2e-e869-4b48-94b6-9df6dd18307e` 返回完整JSON，输入8790/输出854Token；不是输出截断。`scores[0].reason` 长1428，超过既有1000字符上限，整条决策被拒绝。没有裁剪原文、再发第二个Verifier或修改门禁。原始输出含abstain/低评分，不等于平台取得了合法弃权决策。

测试候选有未展开的 `{{particleCount}}`，并要求scatter后粒子总数改变，与计数守恒业务冲突；启动/停止只检查可见性不足以证明状态切换。其CSS引号/选择器本身合法，不把JSON序列化的转义显示误判为非法CSS。Verifier也存在覆盖责任误判：要求CSS读取内部场景数据、像素检查等当前动作不支持的行为。必须区分角色验收与平台schema/必需几何Gate、真实视觉/实体设备。

产品候选仍有 `palmX rotate|none` 等把必要映射写成可选的语义风险，Verifier早期高分未充分识别；项目经理后来给出rotate，但研发未运行，不能推断最终产物会如何实现。

## 证据与后续

[run.json](experiments/CAMERA-04/run.json)、[evidence.json](experiments/CAMERA-04/evidence.json)、[delivery-manifest.json](experiments/CAMERA-04/delivery-manifest.json)、[platform-metadata.json](experiments/CAMERA-04/platform-metadata.json)保留结构化原始值，JSON格式化不宣称HTTP字节完全相同。免费 [replay测试](../../tests/production-camera04-replay.test.ts)检查实际schema、11请求、全部usage、未触发漂移及无交付，未发新HTTP。

下一批先紧凑Verifier输出提示（保持硬上限）、明确覆盖责任、加入测试语义预检与原测试角色的有限纠错；免费验证后再冻结新配置/预登记CAMERA-05。本结果不自动授权第五次付费调用。用户随后优先要求材料补齐和在线MP4，作为独立材料版本发布，不改变本实验“启动时不发布”的授权快照。
