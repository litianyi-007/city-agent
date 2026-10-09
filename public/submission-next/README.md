# 公开评审发布包（非比赛提交回执）

体验入口：https://litianyi-007.github.io/city-agent/。本包是 RC1 / 契约1.0 历史保留（协议 live-business-smoke-1.0），不是契约1.1，也不是待部署的最新轮。首先打开 index.html。

RC1 / 契约1.0：API授权尝试7/24；确认上游请求7；已知usage响应7。已报告用量保守估价¥0.085884、承诺预留¥0.085884、上限¥5；usage=reported。小学联合0/10、宠物联合1/10、17未启动。居民仍为合成画像，mockUsed=false不等于真人外部效度。失败/未启动和全部24项live-proof附件保留。自然规划候选未自动替换固定17/18问卷；CORS重复首画像不计新居民。原工程夹具的0调用和历史负例原数值保持，彼此不合并。契约1.1另册（../submission-contract11/）为小学联合0/10、宠物联合3/10、15未启动、5次请求、¥0.042032，不可与本包混读。

本包不含源码、Key、私人数据库或会话。安装使用独立发布记录的固定Git ref或审查过的源码ZIP。methods正文是候选阶段方法快照。live-proof/report 是 RC1 / 契约1.0 历史总账，不是契约1.1；未随包源码链接均明确为源码相对说明。录屏4分33秒是先前零费用UI操作，不冒充此次API运行录像。

## 公开投影追溯

源候选manifest SHA-256：2e063a2ac55e6ef3967b8d31d1f878e3393c7533aa335b6556261db8bddfa5a2。源真实报告SHA-256：2bc30b2d4d5f234386089ff03493aba7052ce345ee88b0237c4453995cea4efd。下面映射保留原件字节身份，原文件未写回。repo:/表示源码仓库相对路径；内部链接仅保留不可逆原件hash，不公布地址/账号。raw只有在命中公开路径边界时才作脱敏副本，并标记；原证据hash指向冻结原件，不自动认证投影原文。哈希只证明字节一致性，不认证现实真值、调用身份或供应商账单。README自身为此说明新生成，不递归计算自hash。

| 附件 | 源件SHA-256 | 公开副本SHA-256 | 投影说明 |
|---|---|---|---|
| business-proof/business-proof.json | a5db230a7b0358fa4478a400e60b960117766f3e4282c11adb69c7c153606d00 | a5db230a7b0358fa4478a400e60b960117766f3e4282c11adb69c7c153606d00 | 逐字节相同 |
| business-proof/child-snacks/logic-audit.json | 2f4a058c0ef93c6c19447e5e2f9fd1c881e13ae74c75fbda0c634f338e9310f1 | 2f4a058c0ef93c6c19447e5e2f9fd1c881e13ae74c75fbda0c634f338e9310f1 | 逐字节相同 |
| business-proof/child-snacks/presets.json | 2b00f1ac802ca7b842c4d5af36a1e6e66ace3db84f32baae1585104e73bb1e64 | 2b00f1ac802ca7b842c4d5af36a1e6e66ace3db84f32baae1585104e73bb1e64 | 逐字节相同 |
| business-proof/child-snacks/prompts.txt | c9c24928a414f4003286d7c3e5c3e51db2be796057d4ae0c18121af11e579e6b | c9c24928a414f4003286d7c3e5c3e51db2be796057d4ae0c18121af11e579e6b | 逐字节相同 |
| business-proof/child-snacks/questionnaire.json | 80d4c3cb4af90be19681b90a8fed92e620bceee81fc6368b5a836409304ff846 | 80d4c3cb4af90be19681b90a8fed92e620bceee81fc6368b5a836409304ff846 | 逐字节相同 |
| business-proof/child-snacks/raw-responses.json | ec18893ee70c033ebd4c7f4cb19bf849e334e162dba0a938e6d9872aee244067 | ec18893ee70c033ebd4c7f4cb19bf849e334e162dba0a938e6d9872aee244067 | 逐字节相同 |
| business-proof/child-snacks/statistics.json | 15ac2dfd1f0bbd337e026de296b9ebedbff34971284cc53a5f5a11ebe8f57c08 | 15ac2dfd1f0bbd337e026de296b9ebedbff34971284cc53a5f5a11ebe8f57c08 | 逐字节相同 |
| business-proof/child-snacks/survey-run.json | a2bbe2a3907142c3dd0a6ed58f0b579f2f1d30c792fae9121a291a4327b50004 | a2bbe2a3907142c3dd0a6ed58f0b579f2f1d30c792fae9121a291a4327b50004 | 逐字节相同 |
| business-proof/manifest.json | 93920ecc3730adf8416c5ea5439ea0f4b2bbb56c07cb3928b3c69f8d1dcbe6f9 | 93920ecc3730adf8416c5ea5439ea0f4b2bbb56c07cb3928b3c69f8d1dcbe6f9 | 逐字节相同 |
| business-proof/pet-snacks/logic-audit.json | b2162ee1384a07ad6eb313a01b69851c4a9c52fb13acfcaea46a02a555417d79 | b2162ee1384a07ad6eb313a01b69851c4a9c52fb13acfcaea46a02a555417d79 | 逐字节相同 |
| business-proof/pet-snacks/presets.json | 12f0b44e5833d15b6d7e022e55f60683dd19f4f4eca644bcd5aec39ef499d612 | 12f0b44e5833d15b6d7e022e55f60683dd19f4f4eca644bcd5aec39ef499d612 | 逐字节相同 |
| business-proof/pet-snacks/prompts.txt | c289f8bdd6eb523513c9aabf9048c94a4d63ecec0d562df4c99baaa40e937f66 | c289f8bdd6eb523513c9aabf9048c94a4d63ecec0d562df4c99baaa40e937f66 | 逐字节相同 |
| business-proof/pet-snacks/questionnaire.json | 1821c16aff7e0730edacc6e8a9daa3cd6a35368ae90989d59546a51a409eccaf | 1821c16aff7e0730edacc6e8a9daa3cd6a35368ae90989d59546a51a409eccaf | 逐字节相同 |
| business-proof/pet-snacks/raw-responses.json | def5dad2f91c0949745ba0c89450f4a244ea70387e2e5b074a9823199af76b74 | def5dad2f91c0949745ba0c89450f4a244ea70387e2e5b074a9823199af76b74 | 逐字节相同 |
| business-proof/pet-snacks/statistics.json | 6735f8b49f3a21f4aae65d5ccb09300948b7fdf5d6a4277eacf2a008de6b22df | 6735f8b49f3a21f4aae65d5ccb09300948b7fdf5d6a4277eacf2a008de6b22df | 逐字节相同 |
| business-proof/pet-snacks/survey-run.json | 647c0f36dbbe8a612a37389836eb0e0c8218686b1c054d2ca2eba23c7c25cb83 | 647c0f36dbbe8a612a37389836eb0e0c8218686b1c054d2ca2eba23c7c25cb83 | 逐字节相同 |
| business-proof/proof-report.md | 99ef779fd69bff4be5d8fe112346999e368132c450032a3bc54bc156490677a3 | 99ef779fd69bff4be5d8fe112346999e368132c450032a3bc54bc156490677a3 | 逐字节相同 |
| captions.json | da35f369a5303c2933d54e8347ce13c85f883380133ed764957e1888c0e93881 | da35f369a5303c2933d54e8347ce13c85f883380133ed764957e1888c0e93881 | 逐字节相同 |
| demo-next.mp4 | d3817e9c8a3ceffc502bf449b6b62a26f657727dc23450b872110d261d91aaff | d3817e9c8a3ceffc502bf449b6b62a26f657727dc23450b872110d261d91aaff | 逐字节相同 |
| demo-next.vtt | 84ffed3108c596a6e0d2fb87318c4df1b15d5cd8aa8b21e5b0c3676e2ebfc1c2 | 84ffed3108c596a6e0d2fb87318c4df1b15d5cd8aa8b21e5b0c3676e2ebfc1c2 | 逐字节相同 |
| historical/delivery-attempts.json | 43eae631103b10d67d77d73f9ebb6a0ab2f558cf1b8617f93963e546677f3484 | 43eae631103b10d67d77d73f9ebb6a0ab2f558cf1b8617f93963e546677f3484 | 逐字节相同 |
| historical/evaluation-summary.json | 7eb9ac68043752c12cbff47ed2cdbc1f1c11e9ba82602542a1c46a3a5a3881f8 | 7eb9ac68043752c12cbff47ed2cdbc1f1c11e9ba82602542a1c46a3a5a3881f8 | 逐字节相同 |
| historical/experiment-runs.json | 20a42eceec511d4bbcea84f290bc58b46d9a9a686512fc51cb42e6e9e4c9ba57 | 20a42eceec511d4bbcea84f290bc58b46d9a9a686512fc51cb42e6e9e4c9ba57 | 逐字节相同 |
| historical/live-run.json | ecd7a3385f706a27cd06034926ee250fded61f6626cf09a69ec7704fb6c57b5f | ecd7a3385f706a27cd06034926ee250fded61f6626cf09a69ec7704fb6c57b5f | 逐字节相同 |
| historical/metrics.json | 3b830b761a715d7b36b3d7ba9a4829593e49b529cfcd2456802b7548bc75d4d0 | 3b830b761a715d7b36b3d7ba9a4829593e49b529cfcd2456802b7548bc75d4d0 | 逐字节相同 |
| historical/milestone.json | 9c6cf8f11e6390167ae1ae0b718ea5e6a924f7afba78ef6e7e84e02117ad86d4 | 9c6cf8f11e6390167ae1ae0b718ea5e6a924f7afba78ef6e7e84e02117ad86d4 | 逐字节相同 |
| historical/persona-proof/manifest.json | c74801cd2948a13670f77c1be44f4cda8e0b6f17948b79dca5caed0644ffb425 | c74801cd2948a13670f77c1be44f4cda8e0b6f17948b79dca5caed0644ffb425 | 逐字节相同 |
| historical/persona-proof/persona-proof.json | 36ebbd3375399a1fec032c1484aab49b8d92d489ed15ab3b72eb8723228ef79d | 36ebbd3375399a1fec032c1484aab49b8d92d489ed15ab3b72eb8723228ef79d | 逐字节相同 |
| historical/persona-proof/presets.json | a423698c6f565d41183615d96e03649886b75af04459f8dd5ccedaccd719e776 | a423698c6f565d41183615d96e03649886b75af04459f8dd5ccedaccd719e776 | 逐字节相同 |
| historical/persona-proof/proof-report.md | a62239362eb6933131094f9ae3165747b0694625aa24cd44de3cf6184dd5b75f | a62239362eb6933131094f9ae3165747b0694625aa24cd44de3cf6184dd5b75f | 逐字节相同 |
| historical/persona-proof/questionnaire.json | 9b1a01053ab0b27de9c4b27e08d7ec6fa209a811b1ccd6b533a81c04f1c8f247 | 9b1a01053ab0b27de9c4b27e08d7ec6fa209a811b1ccd6b533a81c04f1c8f247 | 逐字节相同 |
| historical/persona-proof/survey-run.json | 547b4958a93610d70a73bfe9509df886e2e08448f94a8b3df5d5921213b2eccf | 547b4958a93610d70a73bfe9509df886e2e08448f94a8b3df5d5921213b2eccf | 逐字节相同 |
| historical/prior-attempts.json | 350e697f46a22b59cf0c1175979fd0a1fba3ab5bd9db1a514f7ce91d6f7c6282 | 350e697f46a22b59cf0c1175979fd0a1fba3ab5bd9db1a514f7ce91d6f7c6282 | 逐字节相同 |
| index.html | 1e12d8faaeeb7cf52fc1f3154d312ed02aa7e6daa047a85a1dc303cb10ed0803 | 4163a0e3e9f237d9179f4b31520361d9722251f1204cba289643219b929449cc | 公开阶段状态与新增真实轮内容，旧阶段原件保持不动。标题改为标明 RC1/契约1.0 历史保留，并与契约1.1对照；证据数字与 live-proof 原件未改 |
| methods/business-proof.md | 06097e9d8ee514d140bfa17687bcbd5c6f57b8cffb296eac7f143de54a0dbbab | 3e4f8f7ec35c0870d2e8c68fc9254dc72ebd869f1ad49c9161ecb95da9ded4b4 | 未随包源文件链接改为源码相对说明；增加历史方法时间口径提示，不回填旧统计。总账提示改为 RC1/契约1.0 历史保留，方法正文证据未改 |
| methods/evaluation-next.md | e5fbf8764a868051d455025cf799265fbf0001748bbb5a209ddd11e7668bcd96 | 7d555f8507b41d158fbaed127828387591139b945d529b4a2e1c83e5c5db603a | 未随包源文件链接改为源码相对说明；增加历史方法时间口径提示，不回填旧统计。总账提示改为 RC1/契约1.0 历史保留，方法正文证据未改 |
| methods/judge-quickstart.md | f97abac6e25d36524d9f599ab7b94e9e0a56a96b212a4df0a55018b2eb01696c | c6e24afe19a1f493e1f7fddcb3cef684d06721faac933889c18cb6eccd7e522d | 增加历史方法时间口径提示，不回填旧统计。总账提示改为 RC1/契约1.0 历史保留，方法正文证据未改 |
| methods/old-persona-proof.md | bb39c32e52a6fb10876cb78521730b25a6b1f6b42e278f19c83bb4ebe76a7c58 | 289fb5a4d546ba689cdeec8640a7a0e75cc4028b2b372338a68dfbaefad67b25 | 本机路径转repo-relative或移除；原件未修改；未随包源文件链接改为源码相对说明；增加历史方法时间口径提示，不回填旧统计。总账提示改为 RC1/契约1.0 历史保留，方法正文证据未改 |
| methods/population-methodology.md | d8cb354a0ea476a193c199d7132013121c101e2575c39791e67d0d439ed6c413 | 26da82d204746afdf4ac50773eed6913a909ad2d37867300906a8d13cd748848 | 未随包源文件链接改为源码相对说明；增加历史方法时间口径提示，不回填旧统计。总账提示改为 RC1/契约1.0 历史保留，方法正文证据未改 |
| methods/resident-construction.md | 4b620a35d96b547a394d51636d3d36cbf6ab49365c0f2f8b6bc9e3583c01d874 | 74b8dfce77388c5f51df1a22d4786ffb0be4612231f6c0b95ef70f9b63ddf7f0 | 未随包源文件链接改为源码相对说明；增加历史方法时间口径提示，不回填旧统计。总账提示改为 RC1/契约1.0 历史保留，方法正文证据未改 |
| persona-source-register.json | d72077047f740d850a4f9c3ed4204963d25cf0be8935f9354d70e426eb6c716d | d72077047f740d850a4f9c3ed4204963d25cf0be8935f9354d70e426eb6c716d | 逐字节相同 |
| population-pack.json | b23aaf30c015381f7b102b71848ee97ecb64756829e7edf98c24db1bf59068d7 | b23aaf30c015381f7b102b71848ee97ecb64756829e7edf98c24db1bf59068d7 | 逐字节相同 |
| population-sources.json | a17630438396f3228d17a822d58dc68acf5056197d92140d8cbfd053412f3831 | a17630438396f3228d17a822d58dc68acf5056197d92140d8cbfd053412f3831 | 逐字节相同 |
| project-materials.md | e19af58d1a6a893a9c782a971b7ac2d03b629eb76cbe7dfc6a881774d7b1fd01 | 8286166a51bdf21421e553b80a70d9539a021a1dee8dfd6802f2a4ac32894911 | 公开阶段状态与新增真实轮内容，旧阶段原件保持不动。标题改为标明 RC1/契约1.0 历史保留，并与契约1.1对照；证据数字与 live-proof 原件未改 |
| recorded-child-proof.json | e49552a25083a2ee098d8fff8362161649968df57fe89587d9ef1605e00d3394 | e49552a25083a2ee098d8fff8362161649968df57fe89587d9ef1605e00d3394 | 逐字节相同 |
| recorded-pet-proof.json | 6b0799a77949aebc2854d3c737e033e3096bdf3cd843c872dbbd8dee9eb85060 | 6b0799a77949aebc2854d3c737e033e3096bdf3cd843c872dbbd8dee9eb85060 | 逐字节相同 |
| sources/binjiang-2023-yearbook.pdf | 338886a362ca60640ce999f185bb120e33922dedee9bc31dbbad57a0a4088134 | 338886a362ca60640ce999f185bb120e33922dedee9bc31dbbad57a0a4088134 | 逐字节相同 |
| sources/binjiang-2024-communique.pdf | 7825d0efe321c224aaef04fa3afce1a255dfe8144d79a36651407e959c640876 | 7825d0efe321c224aaef04fa3afce1a255dfe8144d79a36651407e959c640876 | 逐字节相同 |
| sources/binjiang-2025-communique.pdf | 78f948305d953b3bef24ef4731fd043d321267401361cc54c81fd50c18b4ad11 | 78f948305d953b3bef24ef4731fd043d321267401361cc54c81fd50c18b4ad11 | 逐字节相同 |
| sources/binjiang-census-yearbook.pdf | 70119b88dc3209909f237921ae9efc764c5011d7e6f6032d1d27c2a1949fb966 | 70119b88dc3209909f237921ae9efc764c5011d7e6f6032d1d27c2a1949fb966 | 逐字节相同 |
| verification.json | 995e72d3ddc60d69f1f0310bd2aa2e439ebc51b580b09103b699aae16ebfa085 | 995e72d3ddc60d69f1f0310bd2aa2e439ebc51b580b09103b699aae16ebfa085 | 逐字节相同 |
| live-proof/report.md | 6b0df912337e2a358f85d559fac815fbc5850a70a5f11867827260531f78759b | 6b0df912337e2a358f85d559fac815fbc5850a70a5f11867827260531f78759b | 逐字节相同 |
| live-proof/report.json | 2bc30b2d4d5f234386089ff03493aba7052ce345ee88b0237c4453995cea4efd | 2bc30b2d4d5f234386089ff03493aba7052ce345ee88b0237c4453995cea4efd | 逐字节相同 |
| live-proof/budget-ledger.json | 768b9f47274fc8130ed80190a94a42cf38682434dd1204637a168605fe2995f5 | 768b9f47274fc8130ed80190a94a42cf38682434dd1204637a168605fe2995f5 | 逐字节相同 |
| live-proof/plan.json | fb1f03b56daff26000cb6afb9037aaab5e2c3a6003730552f468bf244bcb714e | fb1f03b56daff26000cb6afb9037aaab5e2c3a6003730552f468bf244bcb714e | 逐字节相同 |
| live-proof/pricing-source.json | c5eee3d82240a513ce48d2e0af5a737d32eb9ec19032b6a00dcd97eacd41c7a1 | c5eee3d82240a513ce48d2e0af5a737d32eb9ec19032b6a00dcd97eacd41c7a1 | 逐字节相同 |
| live-proof/planning-child.json | b846988b15d410728d992009a504f6381fda6c61bf269edfa2a2325f3894d5c0 | b846988b15d410728d992009a504f6381fda6c61bf269edfa2a2325f3894d5c0 | 逐字节相同 |
| live-proof/planning-pet.json | 2e1e93cbde46aac6d90c0e8989c9c76e016147cdc2d2cabbbcdc5d3f96ec5c12 | 2e1e93cbde46aac6d90c0e8989c9c76e016147cdc2d2cabbbcdc5d3f96ec5c12 | 逐字节相同 |
| live-proof/cors-checks.json | 6c8d8291c689b88aa818426919e8e06d04d91691e0afb8c45aa920fd09952c35 | 6c8d8291c689b88aa818426919e8e06d04d91691e0afb8c45aa920fd09952c35 | 逐字节相同 |
| live-proof/child-snacks/logic-audit.json | ce815b79da6598dbb973d51afda1a7ecf80d0dfa7924700b219c83f1ffe0342e | ce815b79da6598dbb973d51afda1a7ecf80d0dfa7924700b219c83f1ffe0342e | 逐字节相同 |
| live-proof/child-snacks/presets.json | adf7cf8e03215d4459dc8d41aaf3a0df9fe5c7ead83814c0f0e951d8e2e0e908 | adf7cf8e03215d4459dc8d41aaf3a0df9fe5c7ead83814c0f0e951d8e2e0e908 | 逐字节相同 |
| live-proof/child-snacks/prompts.txt | e73e662f9bd2e3469913f561efb9204f0a13eca48a202717e3ff3f52b5f246b7 | e73e662f9bd2e3469913f561efb9204f0a13eca48a202717e3ff3f52b5f246b7 | 逐字节相同 |
| live-proof/child-snacks/questionnaire.json | 6aa692f9a660c3a37e6302b884c6707db8d2d618f80c68f9a65bc76107ac66c7 | 6aa692f9a660c3a37e6302b884c6707db8d2d618f80c68f9a65bc76107ac66c7 | 逐字节相同 |
| live-proof/child-snacks/raw-responses.json | 8a1fe71b424e26a6f35b58641b9cc45c8a3295e0a9a81d005a89fe5248afa1c5 | 8a1fe71b424e26a6f35b58641b9cc45c8a3295e0a9a81d005a89fe5248afa1c5 | 逐字节相同 |
| live-proof/child-snacks/statistics.json | 225e06d9ac6e937eeb79541522a2f3a84884b96d6cff83885dbfead01e91ad42 | 225e06d9ac6e937eeb79541522a2f3a84884b96d6cff83885dbfead01e91ad42 | 逐字节相同 |
| live-proof/child-snacks/survey-run.json | 8d621ffc4004bcd9d240bca3db5d2f054e43098443be766899a42e4fc0c27595 | 8d621ffc4004bcd9d240bca3db5d2f054e43098443be766899a42e4fc0c27595 | 逐字节相同 |
| live-proof/child-snacks/qualification-audit.json | 687730d91dcb4cf0b502ba3e301e46278ebb82c24dae70de369e8b8e5f2655b4 | 687730d91dcb4cf0b502ba3e301e46278ebb82c24dae70de369e8b8e5f2655b4 | 逐字节相同 |
| live-proof/pet-snacks/logic-audit.json | 0ec79d4d07c8c5fa733a44a68c0ea368f83a4df8bd23cecc845850985c6da125 | 0ec79d4d07c8c5fa733a44a68c0ea368f83a4df8bd23cecc845850985c6da125 | 逐字节相同 |
| live-proof/pet-snacks/presets.json | db25e39ba522d46c525033640cc02f49d90961dd05443ac70fd8a57cfffb1d80 | db25e39ba522d46c525033640cc02f49d90961dd05443ac70fd8a57cfffb1d80 | 逐字节相同 |
| live-proof/pet-snacks/prompts.txt | e80b399c063a6953717ef9e23e6725ec08eee5e9ce622977a609c12e18c2569e | e80b399c063a6953717ef9e23e6725ec08eee5e9ce622977a609c12e18c2569e | 逐字节相同 |
| live-proof/pet-snacks/questionnaire.json | 1d5b1822c465ea15c9abfc72bea88d49cf5262ef10ad884a1f39fc8daf743a5b | 1d5b1822c465ea15c9abfc72bea88d49cf5262ef10ad884a1f39fc8daf743a5b | 逐字节相同 |
| live-proof/pet-snacks/raw-responses.json | dbca152cfa2b955c8207d0d96b737d68b14fdd7f5594a3140ea63b08008984c9 | dbca152cfa2b955c8207d0d96b737d68b14fdd7f5594a3140ea63b08008984c9 | 逐字节相同 |
| live-proof/pet-snacks/statistics.json | 8ada851fb3361fd319ac33fec72fc9d224c957f83dc592dd946cdc56678f7414 | 8ada851fb3361fd319ac33fec72fc9d224c957f83dc592dd946cdc56678f7414 | 逐字节相同 |
| live-proof/pet-snacks/survey-run.json | 739f2054c9cf7528b55359e901ebf7e200b806041bfbee2bff17b14161bf4e15 | 739f2054c9cf7528b55359e901ebf7e200b806041bfbee2bff17b14161bf4e15 | 逐字节相同 |
| live-proof/pet-snacks/qualification-audit.json | 13f170d8a57d043ef93aa814209d0dc985686f7b1a15260525398388ffd4b867 | 13f170d8a57d043ef93aa814209d0dc985686f7b1a15260525398388ffd4b867 | 逐字节相同 |
| project-materials.pdf | e7dd4d1f7dacaadd56a94b4936ba75727e5a57dca9e031b6e028494255becce5 | 803f31b60cbc3906e4129b6d0ece40181edbb071d4322573e9a4b799424aeec5 | 新建公开评审PDF，显眼新增真实轮与失败数据；原15页PDF未覆盖。标题改为标明 RC1/契约1.0 历史保留，并与契约1.1对照；证据数字与 live-proof 原件未改 |

README源件SHA-256：453006a93f35f9f98ff1efcba452e3f0069af987b48e2e98038704cae772a0bf。正式提交状态未确认；旧submission及Tag保持原样，不回填旧截止时间。
