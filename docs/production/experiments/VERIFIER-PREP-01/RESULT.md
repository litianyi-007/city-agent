# VERIFIER-PREP-01：18池免费Oracle准备

类型：外层人工挑战准备，不是供应商实验或自主交付。正式Verifier效益研究仍未执行/未冻结收费配置。

| 项目 | 实际结果 |
| --- | --- |
| 源commit/状态 | `7755b4ddf68fec211783717d256430642d89713e`，开始时clean=true |
| 时间 | 2026-10-07T11:29:56.574Z → 11:31:53.022Z；116,390ms |
| 浏览器 | Chromium153.0.8010.12；Node22.22.3 |
| 计划/已启动/已完成 | 36/36/36；每次都有先行intent及terminal |
| 实際标签核对 | 36/36一致；16通过、20业务负例失败 |
| 基础设施/取消/未启动 | 0/0/0；无跳样本 |
| 供应商请求/模型效益 | 0；modelEffect/usage/cost不作为实测模型结果填写 |
| 容量预检 | 最大Jev逐问20,223 B、总24,992 B；最大逻辑LLM28,708 B |

12个HTML候选池与6个scene池均严格结构合法；逐一实际交互及像素Oracle，而不是按构造标签直接填成绩。范围、盲评及准备中修正见[语料说明](../../VERIFIER-CHALLENGE-CORPUS.md)。C17有效正控单列工程测试，不进入36个计分候选。

## 原始字节留存

四文件逐字节从实际本机`output/production-verifier-preparation-Hqtrgh`归档，SHA比对一致：

| 原件 | SHA256（文件原始UTF-8字节） |
| --- | --- |
| [manifest.json](manifest.json) | `5d4b31ea648c0f7cc646cb051a6adac901dd469ce9f994a6c4a056e0a8692758` |
| [summary.json](summary.json) | `c962f82a5f21559e7b7447ccdaf0fbd7201c1ca55639eb7d751076ce0b9eb114` |
| [intents.json](intents.json) | `2275f164e90e5bac67701d4c2680c6f384e2e31fd30530ab968e9b724e4e80dc` |
| [oracle-results.json](oracle-results.json) | `a53898068ac119dfb7af59636689184ea64b998ad8a20da33e9071bdf14093b4` |

summary中的`resultsSha256`/`intentsSha256`使用`JSON.stringify(array)`逻辑序列化，不是缩进文件原始字节的SHA；两者不能混比。候选原文和检查由对应commit的冻结源码恢复，并由manifest的candidateValueJson/HTML UTF-8/scene JSON/checks hash核对。36份逐个intent、terminal、Oracle原件与完整candidates副本保留在上述本机随机目录；仓库归档的是四份原聚合文件，不声称所有逐件文件均已提交。

另名外层开发Agent完成需求、标签、DOM/像素/取消/来源链独立只读复核；不是双人工标注。31个声明源码/lock/hash与HEAD前后校验，不证明缓存模块字节、完整依赖安装完整性或OS沙箱。全部Key/私有生产数据未读取、复制或导出；没有生成的宿主脚本执行、摄像头许可或网络模型请求。

正式A/B/C同条件策略、随机化、真实模型与费用尚需另行准备/冻结/预算；这些36个标签一致不能当选优准确率、18真实需求或良品率提升。
