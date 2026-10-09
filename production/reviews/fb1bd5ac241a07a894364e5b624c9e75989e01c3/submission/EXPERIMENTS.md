# 真实 Jev 决策实验账本

内部六角色真实代码生成与托管 Jev 的真实决策是两种证据。三个业务题均为用户授权 MOCK；不得标成三个真实需求。

## 最新真实对照索引（2026-10-08）

| 实验 | 冻结源码 | 终态 | HTTP | 盲决策／实际 Oracle | 声明价估算 USD |
| --- | --- | --- | ---: | --- | ---: |
| [REAL-01](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/VERIFIER-REAL-01/RESULT.md) | aaaac613 | failed，JSON 协议停止 | 10 | 11／0 | 0.017598132 |
| [REAL-02](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/VERIFIER-REAL-02/RESULT.md) | 7899b979 | completed，完整对照 | 52 | 54／36 | 0.077296446 |

REAL-02：B 好选中 12/18、坏放行 4/18、费用 0.038028600 USD；C 好选中 11/18、坏放行 2/18、费用 0.039267846 USD。C 多费 3.258721%、1 次错弃权，预登记高性价比条件不成立；12 Jev drift 与 4 uncertain 升级保留，不能将评测 completed 当软件交付。两个实验配置不同且各自单次授权，不合并成固定配置成功率；账单均 unknown。只读完整性核验和每池实际行为／费用见各报告。

六角色软件任务独立留证：[CAMERA-09](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/CAMERA-09/RESULT.md)为首次真实有界场景 Gate 通过（非完整摄像头），[HTML-01](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-01/RESULT.md)和[HTML-02](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/experiments/HTML-02/RESULT.md)为真实失败；不与选优池合计良品率。本次只追加索引，后文保留其历史时间点；[更新前全文](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/archive/2026-10-08-before-verifier-real02/EXPERIMENTS.md)留底。

以下v1/v2决策章节保留初始批次原貌，其中“尚无Key/真实生成为0”是当时状态，不是当前配置。后续真实摄像头任务见文末；追加前全文在 [留底](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/archive/2026-10-07-before-camera03-result/EXPERIMENTS.md) 保存。

## v1 · 首次适配失败

冻结平台 commit：`d38124a`；策略 `jev-candidate-v1`；候选池 `jev-engineered-candidate-pool-v1`；模型固定 `jev-1.13.0`。业务分数门限 3/4、分布集中度门限 0.5、最终 Gate 不变。

批次 `f0c7b845-1dff-4573-8644-a8de82157505` 启动后只发1个请求。HTTP 200，原始 usage 为输入3386、输出177 Token；按已冻结输入0.042 USD/百万Token、输出免费估算0.000142212 USD。整批墙钟3751 ms，包含实际候选 Gate，不是纯模型延迟。不是供应商账单。

本地过于严格的数值一致性校验拒绝 `c0_consistency`：展示概率的加权值2.26、API分数2.27；另一个答案展示加权3.14、API分数3.11。原始API数值仅有两位小数；旧算法未正确处理概率舍入及显示并列 modal。保留完整失败响应及两个实际候选 Gate；后两题明确 skipped，没有隐式重试、换模型或成功状态。

## v2 · 数值协议修正，新实验

只修正响应协议的有限舍入一致性检查：概率区间±0.005并要求存在和为1的可行分布；分数、集中度与 modal 约束必须能由同一分布满足（有限四维线性可行性检验），不是各自单独加容差。两位小数是本次实测的协议假设，不是官方精度保证。真实回包的 legend 逐字映射请求 rubric，故同时严格核对标签。保存原始分布，不归一化或替换供应商分数。不改变 3/4、0.5、业务验收、候选源码或最终 Gate。协议版本变为 `jev-candidate-v2`，重新冻结源码后新起批次；旧v1不能覆盖或混并成同一配置成功率。

所有原始记录在本机 API `/api/production/jev/benchmarks` 和材料包 `jev-benchmarks.json`。未得到选择的题仍进入分母；若基线 Gate 没执行，基线率为 unknown。三个人工构造池不证明泛化、概率校准或稳定 L5，也没有同范围人工对照或无Verifier真实研发成本对照。

### v2 实测结果

平台 commit `559a309`，批次 `807e9dc4-957a-437d-9798-4cebd57998da`；3次 HTTP 请求，输入10260、输出531 Token，估算0.000430920 USD；整批墙钟10615 ms（包含全部6个候选的浏览器 Gate）。没有 HTTP 重试或中途调参数。

| 题目 | 首候选 Gate | Jev 决策 | 选中 Gate |
| --- | --- | --- | --- |
| MOCK-01 新建 | 失败 | 接受 candidate-b | 通过 |
| MOCK-02 筛选 | 通过 | 不确定，弃权 | 未选择 |
| MOCK-03 空任务 | 失败 | 接受 candidate-b | 通过 |

首候选率1/3；含弃权的选中率2/3；选择覆盖率2/3；仅已选中的条件通过率2/2。这是人工构造的三个池，不是三个真实研发需求的良品率，不能把条件2/2写成三题全成功。MOCK-02 参考候选实际可通过，但 Jev 未达到集中度门限，表现出保守弃权的代价；live 可升级独立 LLM 复核，本批没有配置该模型，不冒充已验证升级收益。

### 混合管线实操（失败保留）

相同平台 commit 下，运行 `e436f153-4304-4b7b-ac1e-54e2d9a91b5f` 对 MOCK-01 执行 `mock-jev`。产品产物为夹具，真实 Jev 返回 uncertain，系统在该阶段明确失败，没有伪造 LLM 复核或继续到研发。1次请求，输入1381、输出166 Token，估算0.000058002 USD，墙钟510 ms。没有最终 Gate，不是自主交付成功。原始记录在材料包 `mixed-and-live-runs.json`。

本批真实 Jev 共5请求（含v1失败）：输入15027、输出874 Token，估算0.000631134 USD；仅是供应商模型用量估算，不含外层开发、设备与录屏成本。不合并两配置的成功率。六个生成角色在新分支尚无 API Key，真实代码生成尝试为0，自主交付良品率 unknown；不读取或迁移主线密钥。

## 后续真实摄像头任务账本

用户已在本分支独立配置六角色Key，采用deepseek-flash与保守输入/输出费率0.30/1.20 USD每百万Token。三轮均由本地前端启动；配置之间有外层工程修订，不能视为同一冻结实验。

| 需求 | 结果记录 | 实际请求（Harness/Jev） | 输入/输出Token | 估算USD |
| --- | --- | --- | --- | --- |
| CAMERA-01 | [首轮](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/CAMERA-EXPERIMENT.md)，failed | 3/2 | 7969/1562 | 0.002760756 |
| CAMERA-02 | [第二轮](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/CAMERA-02-RESULT.md)，failed | 6/3 | 44778/4791 | 0.013279422 |
| CAMERA-03 | [第三轮](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/CAMERA-03-RESULT.md)，failed | 2/1 | 12549/1582 | 0.003656508 |

三次真实终态全部保留，均未到最终场景交付或完整摄像头验收。合计17请求、65296/7935 Token、估算0.019696686 USD，非账单。第三轮的内部产品结构纠正不算完整良品；本批不自动追加第四轮。完整原始调用、拒绝、费用和源版本在各结果链接中；旧Jev合成候选池对照及其0.000631134 USD费用另列。

### 新配置CAMERA-04（不是上述批次隐式重试）

按独立预登记与后续用户授权仅启动一次，[结果](CAMERA-04-RESULT.md)为failed。源码96d5ca6；run `6d347d58-022b-4910-b8a7-649e9ab907b4`；7 Harness+4 Jev=11请求，输入73875/输出6366，41465ms，估算0.020100120 USD。验收Verifier reason1428超过冻结1000上限，完整JSON被结构拒绝；无冻结最终契约、无研发/最终Gate/交付。没有触发v3派生算术漂移，不能拿此轮作为其真实恢复成功证明。

四轮不同配置真实尝试累计28请求、139171/14301Token、估算0.039796806 USD，完整交付全部失败；不是同配置稳定性实验。合成Jev旧账另列，不重复加每run已含的Jev。追加前账本在 [留底](https://github.com/litianyi-007/city-agent/blob/fb1bd5ac241a07a894364e5b624c9e75989e01c3/docs/production/archive/2026-10-07-before-materials-refresh/EXPERIMENTS.md)，旧原始实验不改。
