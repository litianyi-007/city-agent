# Harness 系统提示的无损传输

2026-10-07。由CAMERA-05真实失败触发的后续工程修复，不更改该次实验或其原Prompt。依赖继续DeepSeek Harness 0.1.5-rc.3；传输版本 `harness-literal-prompt-v1`。

## 根因与实现

旧 `personaPrefix: systemPrompt` 把完整系统提示当SDK模板。官方本地 `@deepseek-ai/dsh-system-prompt/lib/index.js` 的 `interpolate` 扫描每个 `{{...}}`：非法变量名导致错误；合法 `{{cwd}}` 等内置变量则可能被替换。SDK没有普通字面转义语法，因此删除一个反例或加反斜杠不是通用无损修复。

现在personaPrefix仅为固定 `{{city_agent_literal_prompt}}`；由平台固定插件 `server/harness-literal-prompt.mjs` 通过SDK `ctx.systemPrompt.variable` 注册原始systemPrompt字符串。SDK单次替换值、不递归扫描值，所以完整双括号保持字面文本。userPrompt本来按原文字发送，测试同样核对其不发生展开。系统角色不降级成用户角色，不执行模型指令、代码或表达式，不开启shell/工具。

插件是可信宿主代码，不是沙箱；当前固定代码不读取文件/env、不联网、不注册工具。原系统提示仍在临时私有补丁文件内，不包含Key；原受控环境、禁用工具、用量代理、取消和清理不变。

生产validationContract含transport版本，自动进入调用configHash、验收冻结hash及delivery manifest；来源commit绑定具体实现。旧历史记录没有该字段，不补写历史。协议字段及版本值禁止作为Key，防止脱敏替换破坏证据结构。

## 免费验证

`tests/harness-literal-prompt.test.ts` 使用真实SDK和本地假provider，逐字节比较最终system/user wire文本，含中文、CRLF、前后空白、合法/非法/嵌套/未知变量、JSON及表达式样式；断言无tools、实际usage、连接取消和临时目录回收。三项专项通过；既有Harness/usage十七项通过。均无外部模型、真实Key或供应商费用。

官方parser直接反例也证明旧模板会拒绝 `{{particleCount}}`、展开 `{{cwd}}`，新注册值原字节保留。本次只证明传输修复和工程安全回归，**没有第二次真实闭环验证**；下一次付费需求需另开固定配置与预登记，不能把CAMERA-05失败改成成功。
