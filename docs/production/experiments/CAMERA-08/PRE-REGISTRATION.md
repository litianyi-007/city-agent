# CAMERA-08：研发前有限再规划

2026-10-07，先于真实启动提交。独立一次新配置探索，旧01～07原始结果不覆盖，不合并为稳定性实验。

## 目标、权限与预算

完整原话、来源、背景、验收、illustrative/high及scatter/gather/rotate约束沿用[07原始输入](../CAMERA-07/run.json)，只改编号CAMERA-08。完整内部角色重新真实生成，不复用旧答案或由外层修改产物。

六角色仍DeepSeek / https://api.deepseek.com / deepseek-flash，输入0.30/输出1.20 USD/M声明估算；本分支页面Key仅hasApiKey确认。Jev jev-1.13.0、门限3/.5、输入.042/输出0 USD/M、24次/30秒、uncertain或可信派生算术异常后最多一次独立LLM规则不变。单次1 USD、30条调用、500000 Token、6000输出、600秒、每阶段1候选、共享纠错/返修2。预测.03～.25 USD不是实测，不启动独立54意图Verifier效益实验；旧unknown不当零。

## 新配置

HTML prompt v8 / camera prompt v7，新增production-planning-loop-v1；将既有可信运行时的确定手势文案/防抖规则完整提供给角色，不让其误当必需用户设计选择。其他Gate、schema、semantic/coverage、Jev布局与门限、review-context-v1、Harness literal transport和固定资产不变，runtime/Gate hash不改。

初始PM的stop继续终止。合法revise进入同一产品→研究→PM，完整上一轮规划、来源ID、修订原因和产物送原角色；只为用户未指定且权限内的细节自主定稿，不虚构必要外部资料、权限或用户批准。未proceed不得测试冻结或研发。规划修订、角色非法候选纠错、最终Gate返修共用最多两次池；不增加隐藏循环或自动付费重跑。

上一轮未批准规划反馈置于控制面regeneration，独立评审保留当前合法候选和完整当前业务事实；另机械保留上轮研究全部observations/constraints/unknowns及完整PM计划供评审核对，不把必要外部缺失藏在不可读取的哈希里。旧完整反馈以当前来源call ID/原Prompt路径/SHA引用，原PM调用输入可追溯上轮研究。角色进一步结构纠错时保留原规划反馈子项。原输入/验收/权限不修改；不将revise直接改proceed，不手写场景或回退模板。

## 工程与真实验收

启动前冻结干净commit并构建，验证revise→真实角色再规划→proceed、stop/耗尽/unknown/取消停止、无提前freeze/dev、规划与结构纠错叠加、来源/hash/manifest版本及原档不变。全部免费夹具结果单列，不能算内部真实模型交付。

免费CAMERA-07完整输出反事实加上旧研究/PM事实和完整固定label：最大单题31,189 B，距原32k余量811 B；这不是实际再规划成功或全请求无损压缩，真实新输出更长时仍失败关闭，不裁剪必要事实。

启动前最终工程结果：全量Node397/397（54.610秒），浏览器38/38（1.3分钟），TypeScript/Vite通过；新增规划专项10/10及独立规划＋07历史证据15/15均免费。首轮一个新增文案源码测试因tsx Unicode转译表示差异失败，已修正测试的等义文本解码，原运行时/门禁/失败日志不变；第二轮全量通过。

真实成功必须六角色独立评审后冻结验收，研发产生严格scene JSON，通过预先冻结CSS及平台Canvas/几何/合成21点Gate，PM基于实际Gate交付，完整证据/成本。返修≤2，无外层人工改产物。即便通过只称最小真实有界场景闭环；实际视觉/实体设备/完整需求仍未验证，等待用户主动实机验收。不启用相机、不授新权限、不宣称稳定通用L5或官方L4。
