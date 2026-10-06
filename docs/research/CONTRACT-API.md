# 通用研究契约：首批预检 API

日期：2026-09-23。schemaVersion：`1.0`。这是只读契约/人口框预检，不是居民问卷执行接口。任务与门限见 [TASKS](../TASKS.md)、[EVALUATION](../EVALUATION.md)。

## 已可使用的入口

沿用现有本机服务及 Host/Origin 限制，不新增登录、外网监听或密钥入口。

| 接口 | 行为 |
| --- | --- |
| `GET /api/research/templates` | 返回 `stage: preflight`、`executorAvailable: false` 和三份可编辑配置：`caregiver-snacks`、`pet-snacks`、`ai-membership` |
| `POST /api/research/validate` | 请求体直接为一份 ResearchTask；校验 schema、同一内置人口包的原件/口径及所需样本框，返回哈希、缺项与输出范围 |

请求不创建任务记录、不更新人口包、不保存上传内容、不调用模型，也不访问客户端提供的网络地址。旧 `/api/runs` 保持原契约；把新问卷发送给它会被拒绝，不会降级为旧价格模拟。

三个模板共用同一 schema 和预检函数，没有按模板名称或关键词切换算法。照护者和宠物购买者缺资格证据，预期 `needs-data`；AI 会员使用历史 15+ 框，预期可通过框预检，但包含未成年人，职业/家庭等细分回答也不是人口事实。

## 最小输入示例

这是模板列表以外的共享工具场景，用已登记的完整 60+ 年龄档演示正向路径。时点故意保持为人口包的 2020 年，不能改名为当前滨江人口。

```json
{
  "schemaVersion": "1.0",
  "id": "shared-tools",
  "title": "社区共享工具租赁需求",
  "objective": "demand-validation",
  "decisionContext": {
    "offering": "假设社区共享工具租赁服务",
    "buyer": "60岁及以上潜在租赁者",
    "endUser": "租赁者本人",
    "channel": "假设社区服务点"
  },
  "population": {
    "regionCode": "binjiang",
    "period": "2020-11-01",
    "unit": "person",
    "filters": [{ "field": "age", "op": "gte", "value": 60 }]
  },
  "questionnaire": {
    "id": "shared-tools-survey",
    "version": "1",
    "questions": [{
      "id": "information-needed",
      "type": "text",
      "prompt": "在考虑租赁之前，您需要了解哪些条件？",
      "required": true,
      "maxLength": 1000
    }]
  },
  "declarations": [],
  "requestedOutputs": ["questionnaire-review", "synthetic-analysis"]
}
```

`decisionContext` 记录商品/服务、购买者、使用者和渠道；它是任务设定，不是核验依据。仅提交自然语言尚不支持自动拆卷，需结构化后预检。

## 类型与限制

- 目标：`demand-validation`、`feature-priority`、`price-benefits`、`concept-copy`、`purchase-concerns`、`questionnaire-quality`。
- 最多 50 题，题目 ID 唯一；题型为 `single`、`multiple`、`scale`、`number`、`text`。题内选项 ID 唯一；单选/多选最多 30 个选项；多选明确 `minSelections/maxSelections`；量表有端点标签；数值有上下界及单位；开放题有最大长度。尚未验证答卷，排序、跳题和跨题约束尚不支持。
- 最多 24 个筛选条件，采用 AND；`eq` 使用 `value`，`in` 使用 `values`，`gte/lte` 使用 `value`，`between` 使用 `min/max`。`in` 最多 32 项。内置可识别字段为 `street`、`ageBand`、`sex` 和整数 `age`；年龄条件不能切开登记年龄档。
- 合法但未登记的字段如 `caregiver`、`petOwner`、`occupation`、`income` 会报告缺证；`household` 单位不能从人数换算。空交集或登记零人口不能显示预检就绪。
- 声明使用 `fact/infer/assumption/generated`，附来源和观测 ID。客户端自报的 `fact` 不会因 ID 存在就获得真实性认证；假设不能补齐真实资格。
- 默认 JSON 请求体仍有 1 MB 上限。严格拒绝未知字段，不接收 API Key、代码、路径或供应商配置。

## 结果解释

| HTTP / status | 意义 |
| --- | --- |
| `200 / ready` | 契约和登记人口框预检就绪；不是问卷已执行或模拟有效 |
| `200 / needs-data` | 缺目标资格、精度、时点、地区、引用核验等，详见 `missingEvidence` |
| `200 / unsupported` | 契约明确请求了当前不支持的 `site-recommendation`、`market-forecast`、`deploy` 或 `backend-service`；仍列出范围内的 `allowedOutputs` |
| `400` | 非法/未知字段、题型或操作、重复 ID、越界等；返回字段路径，不静默丢弃 |
| `409 / blocked` | 人口原件完整性或口径审计失败，不返回一个可用框 |

所有成功完成预检的响应都含 `taskHash`、`populationHash`、`semanticValidation: not-performed`、`executorAvailable: false`、`modelCalls: 0`、`marketResearchValidated: false`。

`allowedOutputs` 只是当前契约声明的研究输出范围，不表示已有执行器。预检不自动理解题目含义、数值单位是否合适、购买者描述与筛选是否一致，也不认证来源陈述的事实支持关系。

## 执行清单的证据语义变化

现有四角色运行的新 `manifest.json` 增加 `executionEvidence`：分别记录模板/执行管线、适配器尝试与回复次数、配置型号与未核验身份、真实或注入 Gate、冻结检查、最终交付状态。注入 Gate 的通过不算 Chromium 验证；本地 SSE 通过真实 SDK 也不认证供应商后台型号。

兼容保留的 `realL5Evidence` 已废弃为能力证明，本批恒为 `false`；请读取范围明确的 `executionEvidence.engineering` 等字段。`marketResearchValidated` 同样不由页面通过或 live 模式点亮。旧运行记录没有被重写。

## 本批不含

没有新前端向导、没有真实居民问卷作答、没有总体/画像扩维、没有通用统计与实验执行、没有付费供应商验收。上述工作仍按任务表推进；不能据此宣布六工作包已经完成。
