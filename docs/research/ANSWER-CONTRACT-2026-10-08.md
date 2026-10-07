# 新答卷契约：精确ID、显式未知与独立oracle

版本 `resident-answer-object-1.0`。本版本是新的结构化输出候选，旧 `coverage-survey-2.0/2.1/2.2` 原始数组答卷和校验不改写；生产居民调用仍使用原协议，不能用本机schema自证供应商约束能力。

实现：[compiler/decoder](../../shared/answer-contract.ts)；独立验证：[测试](../../tests/answer-contract.test.ts)。

## wire形状

```json
{"residentId":"resident-001","answers":{"question-id":"option-id","optional-number":null}}
```

answers按真实题ID展开，每题都进入required；可选题缺信息显式null，不允许省略ID。residentId固定、根和answers禁止额外属性；不删题、不重命名、不做类型转换或补答。

五题型分别生成enum、数组items/数量/uniqueItems、整数/数值范围和文本码点长度/pattern。零和null分开；排他多选生成not/contains约束并本地复核。条件equals/excludes保持冻结rulesHash，仍由独立跨题逻辑审计执行，不声称所有语义规则已原生编译。

decoder核验task/rules/schema hash及重编译schema一致性，拒绝JSON重复属性及Unicode转义的同名别名、Markdown包裹、未知字段、错ID和不完整答卷；原文不修补。新文本长度遵循JSON Schema Unicode code point；旧UTF-16规则不被事后变更。

## 证据门限

两套17/18题共24份固定夹具在新wire中无损回放。测试中独立JSON Schema oracle不调用生产decoder或旧validator；20种结构mutation分别被oracle和decoder拒绝，另测显式null/合法0、重复属性、Unicode及冻结契约漂移。oracle是针对本compiler关键字的测试实现，不是通用JSON Schema库，也不是供应商模型执行。

`npm run review:offline`可在源码checkout无Key回放两套夹具与RC1历史；`-- --local-full`额外读取本机固定1.1归档及离线申报附件。每次新建独立output目录，包含schema、明确标记的fixture转换、原raw SHA及版本/源码hash，不替换旧raw。

provider对nullable、not、contains、uniqueItems及pattern的支持仍为unknown；详见[四层能力矩阵](HARNESS-CAPABILITY-MATRIX-2026-10-08.md)。需要先实现安全单请求adapter，再在新授权内执行关键字探测，不能静默删约束换取“通过”。
