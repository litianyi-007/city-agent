# 通用业务观测包录入与预检

业务观测包用于登记当前研究的现实资料、来源、口径和缺口，是后续 MCP 现实桥的前置契约。它与人口 RegionPack 分开：订单量、客户数、学校在校规模、价格、租金等不能替代常住人口，也不能直接决定模拟居民偏好。当前导入只做 JSON 预检，不联网取证、不访问包内文件路径、不发布人口包、不实施记忆或外部世界绑定。

## 录入和审核

从 [空模板](../../data/business-evidence/new-business-evidence-template.json) 创建独立版本，并保留原件及核验记录。模板的数值、时期、指纹和授权为空，正确结果是 `needs-data`；不要为通过预检把 `null` 改成 `0`。

包只表示一个区域边界版本和完整统计期间。不同期间或区划分别建包；边界变化需要独立审核的映射，不自动视为同一街道。每条观测记录自己的地理粒度、单位、覆盖人群、去重口径、来源 ID 和原表定位。只录匿名聚合资料，不把个人地址、订单明细或儿童记录放入分享包。

| 登记对象 | 必需信息 |
| --- | --- |
| 包 | `schemaVersion:1.0`、ID、版本、创建日、区域、边界版本、统计开始/结束日、用途限制 |
| 来源 | 发布者、来源类型、原 URL 或导出责任人、发布时间、采集日、覆盖地域/期间、原件 SHA-256/字节数/媒体类型、授权、分享范围、核验记录 |
| 观测 | 指标、值、单位、目标人群、地理范围、期间、来源 ID、原表/导出字段定位、血缘、核验状态、缺失原因、用途限制 |
| 推断或生成 | 推断方法/版本/输入观测 ID，或模型/Prompt 指纹；不能升级为已验证现实事实 |
| 声明 | 引用观测 ID、相同的指标/单位/人群/地域/期间、直接摘要值或无数值的待验证假设 |

`verificationStatus:verified`、`provenance:fact` 是录入者的声明，不是系统认证。原件哈希字段存在不等于系统验证了原件，更不能证明发布者身份、统计质量或合法授权。报告的 `manualSourceVerificationNeeded` 始终为 `true`。核验来源链接、比对原件字节和摘录、检查授权、确认业务含义，需要另行审核。

`shareScope` 可为 `public/internal/restricted/private`。后三类不能默认随公开申报或 Git 提交上传；预检不会替用户实施脱敏或授权决定。示例记录和测试文件只使用明确标记的合成夹具。

## 任务要求与停止线

调用方显式提供 `requiredMetrics`，逐项冻结指标、单位、目标人群、地理粒度/单元，以及是否需要目标分母。没有任务要求时，只能检查包本身，不能声称已满足某项商业研究。指标名是调用方契约，不根据学校、猫狗、零食等关键词猜测需求。

```json
{
  "schemaVersion": "1.0",
  "regionCode": "任务指定区域",
  "boundaryVintage": "已核验边界版本",
  "periodStart": "2026-09-01",
  "periodEnd": "2026-09-30",
  "asOf": "2026-10-07",
  "maxAgeDays": 30,
  "requiredMetrics": [
    {
      "metric": "uniqueCustomers",
      "unit": "人",
      "populationBasis": "本店期间内完成订单的去重客户",
      "geographyLevel": "district",
      "geographyCode": null,
      "requiresDenominator": false,
      "denominatorUnit": null,
      "denominatorPopulationBasis": null
    }
  ]
}
```

上例只是结构说明，不含已经核验的业务数据。统计期与 `asOf/maxAgeDays` 都由任务冻结，报告不依赖电脑当前时间。过期资料保留，提示补采，不冒充当前现实。

需要目标分母的指标必须引用同地域、边界、地理单元及期间的正数事实观测，并匹配任务指定的分母单位与覆盖人群。缺分母、零分母、推断分母、常住人口/订单/客户口径不匹配时保持缺口；本批不计算权重或外推收入。

直接摘要只支持同口径原观测及相同数值。加总、转换或推估需先单独登记带输入血缘和方法版本的观测；预检不自动执行未知公式。假设只能标 `assumption/generated` 且值为 `null`。声明自由文本是否超出证据含义仍需人工审核，结构匹配不能证明“文字结论正确”。

学校和宠物商业场景的补采清单及停止线继续使用 [场景准备度](../population/SCENARIO-READINESS.md)。即使所有结构检查通过，也不能据此给铺位、销量、猫狗主营比例或具体售价建议。

## 返回状态与证据指纹

| 状态 | 含义 |
| --- | --- |
| `invalid` | 版本/类型/未知字段、重复 ID、缺引用、循环输入或非法声明等结构错误 |
| `conflict` | 地域、边界、期间、指标单位、分母或声明支持范围不一致；同口径值冲突 |
| `needs-data` | 未采集、缺目标指标/分母、待核验、缺授权/指纹、过期、重复资料待选择、生成或合成观测 |
| `ready-for-review` | 提交者声明之间一致，可进入人工来源与业务审核；不代表真实来源或经营决策已获认证 |

优先级为 `invalid > conflict > needs-data > ready-for-review`。报告保留逐项检查、观测/来源/声明 ID、缺口、限制、包与任务要求指纹。对象键顺序不影响哈希，数组顺序和所有元数据参与哈希；版本或值变化会产生新指纹。审计哈希覆盖报告内容，不替代原件真实性验证。

共享接口位于 `shared/business-evidence.ts`：

```ts
businessEvidencePackSchema
businessEvidenceRequirementsSchema
createBusinessEvidenceTemplate(): BusinessEvidencePack
validateBusinessEvidence(input: unknown, requirements?: unknown): BusinessEvidenceAudit
```

纯函数同时用于浏览器和本机 API，不读 Key、数据库、文件或任意 URL，不产生模型调用。返回值始终包含 `automaticRecommendationsAllowed:false` 和 `populationPublicationAllowed:false`。校验后若需撤销或替换，创建新版本并明确选择使用；已有调查证据继续引用原版本，不被预检修改。

工程测试覆盖正向提交声明、空模板、引用/重复、跨地域/时期/单位、分母、来源元数据、过期、冲突、推断循环、声明升级和稳定哈希。夹具通过只证明这些软件检查，不证明任何真实区域或业务结果。
