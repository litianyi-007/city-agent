# Harness 原生 JSON 请求模式 v1

2026-10-07，CAMERA-08 最终 Verifier 的未转义引号触发严格 JSON 失败，原记录完整保留。本切片修复生成传输，不修补回答或改变成功定义。公共材料安装c7b4f2e仍为其固定版本，本工程切片未自动更新该入口。

## 调研与决策

已安装 DeepSeek Harness/LLM 插件 0.1.5-rc.3 没有贯通 `response_format`。底层 pi-ai 0.85.1 支持 samplingParams/onPayload，但仅在上层YAML添加同名字段会被忽略；免费内存复现已证明，不能以配置文件存在证明请求使用。保持SDK精确版本，不切Responses API或strict工具模式，不启shell/工具。

[DeepSeek 官方 JSON Output](https://api-docs.deepseek.com/guides/json_mode/)要求 Chat 请求指定 `response_format:{type:'json_object'}`、提示包含JSON及期望格式，并披露仍可能空内容或被输出上限截断。此模式不保证业务正确，也不是严格 JSON Schema 输出。当前生产所有角色本来返回对象JSON，包括HTML研发的 `{html: ...}`；本地JSON/schema/业务语义/评分/冻结行为Gate继续全部执行。

## 最小控制面实现

- runRole新增可选固定枚举responseMode，旧调用不提供时保持旧行为；生产仅明确DeepSeek Provider选择json-object，其他厂商仍prompt-only，不替换厂商或隐式声称原生支持。
- 既有可信localhost用量代理校验凭据、路径与唯一POST后，解析请求普通JSON对象，只追加固定格式字段；保留model、system/user、thinking、stream与usage选项的语义。
- 格式冲突、工具字段、非法对象及改写后超过1MB在上游发送前拒绝；供应商400或格式不支持不得移除字段、退回text或重试收费。
- 格式版本/政策进入validation/config/freeze/manifest；每调用区分not-networked、requested与可信代理观察到的wire-observed。注入夹具不能冒充原生真实请求。
- 无秘密进入Prompt/产物/导出；响应仍原样保存。取消、unknown、时间/Token/费用/一次POST限制和共享两次返修不新增额度。

## 必须验证的免费反例

真实SDK→localhost假供应商观察格式字段与完整usage；默认调用和其他Provider保持不变；中文、引号、双括号以及schema字符串不被改变。非法/空/截断输出继续拒绝，400不降级重发；取消关闭请求/代理端口，非法请求0上游POST；mock/injected不标wire-observed；凭据不能与新增元数据保留值碰撞而破坏脱敏协议。

工程测试与独立安全/质量审查通过后，才冻结新配置与预登记下一真实任务。新模式只降低语法错误风险，不预先登记真实成功；CAMERA-08不得用新解析或传输倒改。实际计数、失败与费用以各原始终态记录为准。
