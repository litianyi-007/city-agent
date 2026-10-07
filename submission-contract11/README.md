# City Agent 1.1真实调查续测：负结果补充

体验入口：https://litianyi-007.github.io/city-agent/#research

本补充入口：https://litianyi-007.github.io/city-agent/submission-contract11/；正式公开状态以部署验收记录为准。原RC1完整材料：https://litianyi-007.github.io/city-agent/submission-next/index.html

独立真实API试验f736fda5-2b12-4918-b843-1421e1c76454，5请求，15,704输入/1,328输出Token；按高峰非缓存价保守估价¥0.042032，授权¥5/最多24请求，不是供应商账单。受访者为合成居民，不是mock也不是真人。

| 场景 | 题数 | 启动/计划 | 结构/计划 | 跨题/计划 | 资格/计划 | 联合/计划 | 未启动 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 小学照护者 | 17 | 1/10 | 1/10 | 0/10 | 1/10 | 0/10 | 9 |
| 宠物零食 | 18 | 4/10 | 3/10 | 3/10 | 3/10 | 3/10 | 6 |

两个10/10联合门限均失败；儿童跨题互斥失败，宠物第4份多选标量结构失败。未修改原文、重试、换模型、补样或扩到30人。规划/CORS均因质量停止未启动；旧1.0规划0/2失败仍保留。本次不验证五层贡献、真人市场、主营价位、猫犬占比或盈利店址。没有新真实试验录屏；旧视频是工程夹具。

解释边界：本轮实际跨题错误1、结构错误1、未启动15。原logic-audit.failed包括未启动；qualification.conflict也包含结构invalid和未启动的未评估，不是20人的身份/逻辑矛盾。小学["puyan","unknown"]违反题面明确的未知排他及冻结规则，但问卷无法表达部分知识（知道浦沿、其他未知），需另版改进。宠物第4份raw的猫/采购资格符合画像；结构失败导致parsedanswers为空、资格核对被阻断。未来verifier应区分not-evaluated；本轮raw和审计JSON不修改。

包根目录含24项固定白名单原件，逐字节复制。本包共27 payload加1 manifest；appendix.pdf为独立2页补充，原RC1/旧1.0/旧Tag/旧PDF不覆盖，不代表正式参赛提交。

planHash（canonical JSON）：b035c929da5aee2db87c7bac9c37301a51f359459bc5a0bac1d816db9c2bddc6
源plan.json SHA-256：3d1bee778baf96915a4a22f6795d4d1c53cf3889702382496c234b6d6950764f
源report.json SHA-256：d63b821400cfdfc7aeffe7e5111d4e06bd63c3e42bf5ef54adf6b97bb72d2af8

原计划记录23关键源文件hash；冻结问卷、画像、预设、Prompt、统计、跨题、资格及预算分别可复核。Hash是内容一致性检查，不认证现实真值、用户身份或账单。批准receipt/binding原件、私Key、本机数据库与运行私日志不公开。
