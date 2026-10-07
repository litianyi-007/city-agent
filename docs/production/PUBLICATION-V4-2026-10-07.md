# production-materials-v4 发布核验

2026-10-07T07:52:00.458Z，已发布独立 production 子树（receipt generatedAt）。

- 报告/安装源码：`c7b4f2e2d837b6ed3531f7b0bb8fc9fb9523844a`，feature/autonomous-production，已普通推送。
- gh-pages 部署：`7d81c3365b80d98b078c566a2e03e2cbe2c866ff`，parent `f5a722dcd57b5ae274f0aa96d484775c8bf22412`，非强制更新。
- [公开体验入口](https://litianyi-007.github.io/city-agent/production/)，[本版不可变入口](https://litianyi-007.github.io/city-agent/production/reviews/c7b4f2e2d837b6ed3531f7b0bb8fc9fb9523844a/index.html)。
- [本版PDF](https://litianyi-007.github.io/city-agent/production/reviews/c7b4f2e2d837b6ed3531f7b0bb8fc9fb9523844a/submission/production-mock-submission.pdf)，[评委指南](https://litianyi-007.github.io/city-agent/production/reviews/c7b4f2e2d837b6ed3531f7b0bb8fc9fb9523844a/submission/REVIEWER-GUIDE.md)，[包含MP4与原始证据的ZIP](https://litianyi-007.github.io/city-agent/production/reviews/c7b4f2e2d837b6ed3531f7b0bb8fc9fb9523844a/submission/materials.zip)。

安装源码含新建自定义需求、独立来源/验收、单次授权、迟到响应隔离、请求账本与有限再规划。公开入口是固定案例＋材料，不运行新需求后台；本地编辑器为 http://127.0.0.1:4420/#production。报告工具版本、原Mock实验c21c588、原视频c21c588与各CAMERA原运行源码分别保留。

## 检查记录

PDF最终10页全部渲染并逐页检查；没有缺字、表格重叠或截断。发布预检99文件、50,601,463字节，全部受allowlist、普通文件、大小、秘密与manifest/hash约束；只有production/index与本版reviews目录新增/更新，旧公开材料未删除或覆盖。

发布前后非production根项SHA/mode/type全部一致：

| 根项 | SHA |
| --- | --- |
| .nojekyll | e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 |
| assets | ad890a45b39b626f0c72f3c4fc834dba42f247d0 |
| index.html | 20acd5bc3fe19f41c0c0dbf7e78d3d86d2b65b72 |
| submission | b08b0a7d0274e677e705945c4533fa74f4a93315 |

公开manifest已读回，publisher/materialsVersion一致；PDF、指南、real-camera-runs.json均HTTP200且SHA与manifest相同。本地独立4430静态预览手动添加/完成/删除归零通过；公开入口刷新后实际呈现八步新需求指南、c7b4f2e安装命令、八次原始实测及v4下载链接。在线PDF已打开，旧视频未重新录制，206秒免费Mock录屏不证明真实模型交付。

可核对的本地输出：`output/pdf/production-mock-materials-dQhaVc/`，`output/production-public/review-P44Azh/publication-receipt.json`；输出被Git忽略，不含控制面Key。初稿输出9Fn4Yh为未发布视觉QA草稿，不能与最终包混用。

所有封包/发布为零模型请求，CAMERA-08费用另记。以上是材料与入口验证，不是新真实交付实验，也不自动证明实体摄像头、容器或L4/L5达标。后续工程修复须新版本；固定c7b4f2e入口不随分支源码变动而冒称更新。
