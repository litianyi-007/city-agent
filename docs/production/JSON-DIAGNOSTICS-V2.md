# JSON诊断v2：尾随内容精确定位，不修复答案

触发证据：[HTML-05](experiments/HTML-05/RESULT.md)的原PM输出提前闭合（UTF16位置504的`}`），尾随内容在位置505被拒绝，Node22报`Unexpected non-whitespace character after JSON at position 505`。v1只匹配`in JSON at position`，给出null与文末摘录。实验已终态才修补，不修改它的原文或诊断。

v2同样调用既有严格parseJson：仅接受原支持的完整围栏unwrap，不提取局部对象、不移除尾随内容、不自动补引号／删除额外字段。只从真实SyntaxError消息的末尾固定格式读取`in JSON`或`after JSON`位置；不会从用户原文或引号内伪位置信息取值。整数必须在body UTF16范围，按原unwrap偏移映射回raw；无位置仍null，最多320字符原文摘录，保留合法surrogate pair与完整原文SHA。

新生产合同／证据记录`production-json-diagnostics-v2`。内部函数显式v1参数仅供只读重放历史行为；旧HTML04／05回执使用v1核验，不迁移旧运行或重新定义成功。修复位置信息不证明模型会修好，也不改变两次共享修复、12×20门限、最终Gate或权限。

Key新保存同时保护v1／v2与其所有≥16字符子串；旧保留凭据不会自动迁移。HTML管线第一次角色调用之前，将当前诊断版本纳入原完整加密碰撞检查；碰撞立即0调用失败，要求页面轮换，不解密导出、不调大原100000检查上限。legacy及grouped两条HTML路径均有全版本／16字符旧合成Key反例；只用测试独立临时目录和合成加密状态，不读取用户Key。

测试包含历史原文重放、尾随对象／原语／提前闭合、Unicode、空白、完整围栏、伪位置、真实截断位置、既有额外字段拒绝、凭据碰撞及取消／血缘工程回归。代码与测试范围的独立审查／结果见 [本批记录](BATCH-HTML05-CHECKS.md)；这是免费工程改善，不是新付费实测或通用L5证明。
