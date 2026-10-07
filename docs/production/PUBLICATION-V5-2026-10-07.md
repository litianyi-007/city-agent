# production-materials-v5 发布核验

receipt生成时间 `2026-10-07T09:44:24.352Z`。报告/安装源码 `967bbba15c92dc07cf40fd2b2f5affebf1493b12`，分支 feature/autonomous-production；gh-pages非强制部署 `7a1cf106d68ab75c71540dd0e09a61fc734429fa`，parent `7d81c3365b80d98b078c566a2e03e2cbe2c866ff`。

- [体验与安装入口](https://litianyi-007.github.io/city-agent/production/)
- [本版固定材料入口](https://litianyi-007.github.io/city-agent/production/reviews/967bbba15c92dc07cf40fd2b2f5affebf1493b12/index.html)
- [11页PDF](https://litianyi-007.github.io/city-agent/production/reviews/967bbba15c92dc07cf40fd2b2f5affebf1493b12/submission/production-mock-submission.pdf)
- [评委本地安装指南](https://litianyi-007.github.io/city-agent/production/reviews/967bbba15c92dc07cf40fd2b2f5affebf1493b12/submission/REVIEWER-GUIDE.md)
- [视频、源码与原始证据ZIP](https://litianyi-007.github.io/city-agent/production/reviews/967bbba15c92dc07cf40fd2b2f5affebf1493b12/submission/materials.zip)

v5新增CAMERA09七份原档；有界场景1/9、完整需求0/9是异配置探索计数，不是稳定成功率。模型生成声明式场景，不是任意摄像头软件。旧Mock主稿、原c21c588视频、旧失败档逐字保留；MP4实际205.88秒，不是09新录屏。后续HTML01另起实验，不属于本次冻结v5快照。

## 核验

98项材料加manifest共33,904,124B；public清单105项，加marker共106文件、53,522,834B，原100/110文件、100MB总量、30MB单文件门限未扩大。全部普通文件、路径/秘密模式扫描、字节及SHA核对通过；ZIP99项逐项等于98材料+manifest。CAMERA09七档及旧CAMERA01～08存在的28档与源码归档逐字相同。

最终PDF 1,200,097B，11页全部渲染视觉核对；没有表格截断或重叠。封面探索通过数明确1/9，不显示冗长小数。PDF无JavaScript。

公网单轮读取入口、publication-manifest、固定版本入口、PDF、指南、real-camera-runs和09七档，共13个GET，全部HTTP200、字节/SHA与本地清单相同。Chrome实际刷新显示v5、967bbba、9次独立实测与新下载链接；本版PDF已打开。模型源码仅.txt下载，未在用户浏览器执行。

非production根树SHA/mode/type全部不变：

| 根项 | SHA |
| --- | --- |
| .nojekyll | e69de29bb2d1d6434b8b29ae775ad8c2e48c5391 |
| assets | ad890a45b39b626f0c72f3c4fc834dba42f247d0 |
| index.html | 20acd5bc3fe19f41c0c0dbf7e78d3d86d2b65b72 |
| submission | b08b0a7d0274e677e705945c4533fa74f4a93315 |

本地输出：`output/pdf/production-mock-materials-u8496O/`、`output/production-public/review-vbj9RI/publication-receipt.json`；均忽略Git。初稿XexlfJ未发布。静态页不接收Key或执行新需求，实际编辑器在用户本地4420。封包/发布不产生模型请求；CAMERA09和HTML01费用在各原实验单列。
