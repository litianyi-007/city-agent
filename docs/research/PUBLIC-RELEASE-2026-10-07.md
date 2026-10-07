# 公开评审版 RC1 发布实证记录

2026-10-07：公开评审版已上线，可供体验和下载；不是正式比赛提交回执。工程发布完成与真实调查质量失败同时成立。

体验：[虚拟社会调查](https://litianyi-007.github.io/city-agent/#research) · [77项材料目录](https://litianyi-007.github.io/city-agent/submission-next/index.html) · [真实原文/负结果](https://litianyi-007.github.io/city-agent/submission-next/live-proof/report.json) · [安装指南](https://litianyi-007.github.io/city-agent/review-guide.html) · [源码和材料下载](https://github.com/litianyi-007/city-agent/releases/tag/society-review-2026-10-07-rc1)。

## 不可变版本与范围

- 源码 Tag：`society-review-2026-10-07-rc1`，commit `0600eb067fa74a448c96610f7f47ca9176d56760`；335文件源码ZIP来自该固定 Git 树，而非未提交工作区。之后本分支仅追加发布状态文档，不移动Tag或回写证据。
- Pages commit：`e0443395050aa9cf624904422cab82d924a4983c`，GitHub构建状态built；实际公网文件和新浏览器上下文复核，不以“push成功”代替上线验证。
- 两个ZIP、17页PDF与包清单已发布为公开 prerelease，不取代旧正式里程碑Release。源码ZIP含`SOURCE-SNAPSHOT.json`；材料ZIP不是程序安装包。
- 旧Tag、旧`submission/`29文件保持字节不变；旧首页留底在[历史入口](https://litianyi-007.github.io/city-agent/milestones/submission-milestone-2026-10-07/index.html)，旧哈希资产保留。`main`和并行L4/L5分支未写入。

## 实际检查，不混淆验证层次

| 检查 | 结果 | 范围限制 |
| --- | --- | --- |
| 单元测试 / 浏览器回归 | 284/284；19/19（37.0秒） | 工程测试，不是模型问卷质量 |
| 本机 / Pages构建 | 均通过 | Node22.22.3 当前macOS |
| PDF | 新17页全部渲染/逐页视觉通过 | 不替代原件/实验真实性认证 |
| 外网文件 | 119/119 HTTP200及字节/hash一致 | 新77+manifest、首页/资产/指南、旧29、旧首页归档 |
| 实际公网UI | 17/18题各12人夹具、导出/恢复/复算、375px、Key不落盘、旧入口通过 | 0供应商调用；不是公网新真实长问卷全流程验收 |
| 固定源码安装 | 335文件安装前后hash一致；npm ci/setup/build、doctor8项、实际Chromium153启动通过 | macOS arm64同机新目录，复用当前用户浏览器缓存；不是他人真干净电脑/跨OS |
| 新本机实例 | 10只读API及全部77材料200/hash一致；默认四角色和四居民无Key | 独立4344端口、独立空数据，自己的服务已停止/端口释放 |
| 执行来源一致性 | 调用前登记的7个关键执行文件hash均匹配固定源码Tag | 仅字节一致，仍非独立供应商执行来源认证 |

公网UI检查前两次因新验收脚本定位器不匹配而停止，日志保留；修正选择器后第三次通过。没有付费重试，未把失败归为已经通过。移动端应用预设按钮较窄折行为非阻断体验改进项，未宣称UI毫无问题。

本机完整证据（Git忽略）：`output/public-release-external-byte-qa.json`、`output/public-release-independent-browser.json`、`output/public-release-install-qa.json`及对应日志/截图。安装日志包含本机路径，公开Release仅提供无私路径的摘要，不直接上传这些原日志。

## 真实调查负结果保持原样

实验`43d6dd28-aae0-4dee-9b95-baeac386e8c1`：真实DeepSeek API请求7次（居民3、规划2、CORS2），input15,418/output6,881 Token，保守估算¥0.085884，非独立供应商账单。两场景各预登记10人，小学联合通过0/10、宠物1/10，17人未启动；两份多选题结构失败即停止对应场景，原文不转换。规划0/2可用候选；CORS两次HTTP200仅协议成功。预算已关闭，未自动重试、补答、换人、扩样或消费剩余额度。

材料原manifest如实保留生成时`sourceHead=b66122…/sourceDirty=true`，不偷换为后续固定Tag；源→公开投影hash与调用前plan提供血缘，固定源码版本另册登记。合成居民仍不是真人，不能把本轮或工程夹具当滨江真实偏好、猫狗需求比、主营价位或最佳店址结论。

下一步：先离线修复扁平规划JSON和多选未知数组的Prompt契约，冻结新版本后申请新的实验预算，再做10人门限；只有通过后才考虑30人扩容。现实补采、人格贡献/语义盲评、现实桥MCP与记忆/wiki/dream仍是后续任务，不写成当前已实现。
