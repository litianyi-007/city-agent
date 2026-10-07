# 知识边界契约的独立对抗审查

日期：2026-10-08。对应完整17/18题的固定合成资格接口探测，不是现实消费者调查或人格有效性试验。

## 发现：输入存在不等于主观事实已被观察

独立实网 `143651dd-3e97-42d1-bf38-3ef3dcc603d8` 的宠物答卷结构/逻辑/资格均通过，却被知识门阻断两项。两名非作者分别检查实际冻结system/user、原文、wire/hash后，得到不同性质的诊断：

| 项目 | 原输入 | 原判定 | 独立判断 |
| --- | --- | --- | --- |
| 零食定义理解 | 定义已提供，未提供居民已理解的确认记录 | 固定要求understood | 问卷问主观自报；定义存在不能替代确认观测，输入与预期不对称 |
| 可达街道 | 居住街道存在，出行资料缺失，未知题列表明确包含此题 | 要求unknown，模型却填居住街道 | 无依据的跨变量推断；未知门应保留 |

可达性独立失败仍成立，因此该轮保持1通过/1失败、2实际请求、halted闭合，不改成绩或账本。上一协议失败亦不改写。详见[真实试验与原件hash](RESPONSES-CAPABILITY-TRIAL-2026-10-08.md)。

## 新Prompt1.1的最小正确修复

- 保留完整问卷、全部选项、跨题规则、合成资格、schema与strict decoder。没有删除难题、放宽数值范围或强行修答。
- 显式区分 `petSnackDefinitionProvided:true` 与 `petSnackUnderstandingObserved:false`。主观理解未观察，按既有unknown选项作答；不将期望答案understood喂给模型。
- 显式 `mobilityObservationsProvided:false`，说明 `resident.street` 是居住背景，不是消费出行/网点可达资料。不允许由地域、人格或收入补造观察。
- 资格和采购角色仍来自明确的合成假设，而不是现实认证。没有用“理解已确认”的新假设来补样。
- Prompt版本、casesHash、知识边界hash、wire/schema/hash与当前源码在新登记中独立冻结；旧case与当前expected失配时仍拒绝事后重评。旧raw不换新case再称实网成功。

## 消除自证循环的工程补充

原正例由 `knowledgeBoundary.knownAnswers` 生成，再由同一字段审计，只能证明实现一致，不能证明输入事实的依据。新增人工写定18题原生gold，不从knownAnswers/compiler生成值；先核对狗/非猫、采购角色、理解记录缺失与mobility缺失的实际输入路径，再核对输出。

负例保留结构合法的 `understood` 和居住街道填充，两者均必须被未知门拒绝。结构decoder与另一实现的schema oracle共同解释同一个schema，只证明结构合规，不宣称独立验证现实事实或供应商关键字因果执行。

## 实验与发布门

同类小額预算已由用户默认授权；每轮仍需新的ID、固定≤¥1/≤2请求、私有回执、冻结输入/源码、旧封存记录hash和独立账本。新轮只执行一次，首协议/结构/逻辑/资格/未知/usage/网络/预算异常停止全部，不重试、不补样、不换模型、不做10＋10。

发布保留每轮分母、失败与未启动；能力合规与内容充分性分开。即使两场景能力通过，缺消费观察时业务回答仍应未知，不能升级为滨江价格、猫犬销量、儿童直接口味或选址验证。新增实验实证与最终全套工程报告另行追加，不沿用失配源码的旧报告。

## 实施与独立复验

两名非作者分别检查Prompt/判定对称性，独立手写17/18题gold和6种反例通过；7/7计划测试与4/4注册专项通过，未发现P1/P2阻断。旧case继续被源码漂移门拒绝；原问卷/schema/规则/资格/profile hash不变，Prompt/body/知识边界hash按新版本变化。

新计划 `50992659-bdbc-4c2a-a3eb-ee288768b40e`（对象hash `38590e045437b54bee7bd97bbffb31ab55c633a1543083a74a5737951a0c481d`）在北京时间04:49:18.396—04:49:21.660执行一次：实际2请求、能力2/2通过、无失败/未启动/重试/补样。input9942/output287，3263.045583ms，保守估价¥0.02218、usage reported2/2、durable/closed/finalized无lock。研究业务内容仍为信息不足（已知0/12及0/14），市场/人格认证仍false。旧143失败没有因新结果改变。

报告原件SHA `2ed16ea1d9d07c4e0ec63052b05a726d0e75a2c606bc7277d55303d3263aea6d`，账本SHA `43ad9cf22f8009d3b603a8cccf18626e06fa99f4d7132dccd2830ed585d6850a`。原SSE分别45699/46977字节，hash `349ebee1bfddfd70255440cffd28b92aea00abfc658db0a7f702650bbbeb515b` / `907baa481938c9cdc1e7abd67c4769642ad9904adc0b81bd3fd1dff46e97f0dd`。私有原件不公开；[审查后摘要](https://litianyi-007.github.io/city-agent/review-updates/2026-10-08/status.json)分列全部三轮。

CLI当时控制台摘要把成功的null stopReason通过`??`错误显示为fallback失败文字；原JSON报告从始至终为passed/null，两个原生答卷和闭合账本一致。随后只修正控制台投影，不重评、不改原报告、不发新请求；发布源码由新的全套工程proof核验，不能把该发布commit冒称为原实网冻结commit。
