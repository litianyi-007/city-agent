# 研发前再规划与公开体验指引批次

2026-10-07，独立生产worktree/branch，原主线、4321服务、冻结Tag和已提交正文/ZIP不修改。

## 实际结果

[CAMERA-07](experiments/CAMERA-07/RESULT.md)由本地编辑器一次启动，f303363干净构建，30.299秒failed：产品/研究/PM及三次独立LLM完成，PM合法revise后控制器未执行交回产品任务。9次HTTP、53513/3844 Token、0.014684256 USD完整声明价估算；尚无test/freeze/developer/Gate。原四JSON按字节存档，5项历史回归固定SHA、来源与费用。不同配置探索不混为稳定性实验。

## 实现

- production-planning-loop-v1：PM revise实际重调原产品→研究→PM，不偷改proceed；stop仍立即止。所有规划修订、角色结构/质量纠错及Gate返修共享两次，不提前冻结或开发，不改变用户硬约束/权限。
- 完整旧研究三数组和完整PM计划机械留在planningReviewContext，核其真实selected PM raw与userPrompt来源hash；独立Jev/LLM不能仅凭新版候选或不可读取引用忽视原外部缺失。完整旧产品/规划反馈保留生成Prompt和来源SHA，避免不必要重复；进一步纠错保留规划反馈。
- 将既有可信运行时手势文案及实际防抖常量完整供角色使用，避免把固定UI文案当用户必需输入。HTML8/camera7，validation/config/frozen/manifest绑定版本；运行时与Gate hash不变。
- 门户/本地指南明确八步：新建自定义需求、选择能力、填来源与完整验收、配置本地六角色/价格、可选Jev、一次有限预算、启动、真实Gate/失败/账本。新出版器要求materials-v4与完整publisher匹配，允许逐字归档05～07，不让v3 PDF冒充新源码。旧v3正文与历史视频来源仍分列；新版本另目录，不覆盖旧附件。

## 工程验证

Node397/397（54.610秒）、浏览器38/38（1.3分钟）、TypeScript/Vite通过。规划专项10项及独立审查规划＋历史15项均免费；公开入口专项26项通过，另新增出版v4/commit守卫纳入全量。未知用量、取消、停止、共享耗尽、早冻结和外部缺失被隐藏的反例覆盖。首轮一个新增源码字符串测试因Unicode转译表示不同失败；等义文本解码修正后全量通过，未改实际runtime/Gate/断言意义。

CAM07完整输出反事实最大Jev单题31189 B，余量811 B。仅证明这些免费输入适配，不保证更长输出。未具Docker/Podman或已验证等效容器，不执行宿主生成Node/shell。真实硬件权限等待用户主动操作。

## 下一独立实测

[CAMERA-08](experiments/CAMERA-08/PRE-REGISTRATION.md)一次预登记，1 USD/30条调用/500k Token/600秒/共享2次。原六角色重新生成，评审与最终功能Gate决定结果；不会模板回退、外层改产物或隐藏失败。即便场景Gate通过也仅有界场景闭环，实体相机/视觉/完整需求另验收。
