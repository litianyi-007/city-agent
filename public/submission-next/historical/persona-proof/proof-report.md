# 五层画像与问卷工程自证结果

工程规则夹具；没有LLM调用，不是真实居民偏好、人格效度或经营建议。

运行ID：abfe1fd7-e1aa-4aba-a7ea-207088e9f14d。mode=fixture；模型调用=0；API费用=0（不含本机计算）。人格行为效度、真实偏好和市场校准均未验证。

本次12个合成画像回答16题，12/12份工程答卷有效。五层设定原样进入各自冻结Prompt；画像、原文、统计、来源和哈希可回查。所有价格/品类/网点分布来自seeded规则，不是调研发现。

## 逐题工程统计

| 题目 | 题型 | 有效应答分母 | 夹具结果 |
| --- | --- | --- | --- |
| purchase-qualification | single | 12 | 猫=2；狗=3；猫和狗=2；不参与购买=2；资格未知或不适用=3 |
| purchase-role | single | 12 | 通常自己决定=3；与他人商量决定=3；只协助或收集信息=1；不负责采购=4；未知或不适用=1 |
| occupation-context | text | 12 | 逐份开放原文见survey-run.json |
| personality-context | text | 12 | 逐份开放原文见survey-run.json |
| upbringing-context | text | 12 | 逐份开放原文见survey-run.json |
| education-context | text | 12 | 逐份开放原文见survey-run.json |
| household-context | text | 12 | 逐份开放原文见survey-run.json |
| routine | single | 12 | 有计划地采购=3；遇到特定需要才采购=1；通常由他人采购=4；不采购零食=1；画像信息不足，未知=3 |
| value-priority | multiple | 12 | 配料与适用性信息=4；宠物接受程度=4；明确规格下的价格=3；购买与收货便利=3；来源与质量信息=5；信息不足或暂无优先项=4 |
| risk-attitude | scale | 12 | 均值=3.17；单位=分 |
| price-range | single | 12 | 10元以下=0；10–19元=3；20–39元=3；40元及以上=1；不考虑购买=2；信息不足，不能确定=3 |
| trial-budget | number | 12 | 均值=269.90；单位=元/一次试购 |
| snack-category | multiple | 12 | 肉类干制零食=6；冻干零食=4；软质零食=4；咀嚼类零食=1；不考虑零食=4；信息不足或其他=3 |
| outlet-function | single | 12 | 订单自提=0；了解商品和试购=0；就近直接购买=0；仍更关注配送=0；不需要线下网点=5；条件不足，不能判断=7 |
| scenario-boundary | text | 12 | 逐份开放原文见survey-run.json |
| open-reason | text | 12 | 逐份开放原文见survey-run.json |

## 如何复核

questionnaire.json给出完整问卷；presets.json包含4份无Key的五层假设；survey-run.json保存每画像、Prompt、答卷、失败分母与分析；persona-proof.json逐画像对照personaHash与promptHash；manifest.json登记附件字节SHA-256。

## 结论边界

- 工程规则夹具；没有LLM调用，不是真实居民偏好、人格效度或经营建议。
- fixtureAnswers根据seed生成合法答卷，不根据五层画像推导消费偏好；完整率由工程规则保证。
- 猫狗人数来自预设轮转，不是滨江养宠比例；人口历史框不提供目标购买者分母。
- 价格和品类选项分布只验证数表与追溯能力，不支持选址、主营、定价、主粮或利润结论。
- 五层画像均为情景假设，不是DNA、测量人格或真实成长/家庭/教育/工作记录。
- 没有声明式职业/家庭/跨题规则，不把JSON通过当语义自洽盲评通过。
- 此自证不升级S03的真实10→30人完整率，也不升级S04或S13。

下一步真实调用需重新填Key、确认预算并冻结配置。未知usage/成本保持unknown；另存新实验，不覆盖这个夹具或旧申报证据。
