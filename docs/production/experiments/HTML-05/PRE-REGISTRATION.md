# HTML-05：冻结配置与单次启动索引

本索引在实验结束后归档，不倒签为运行前创建的文件。运行前已提交的 [单次提案](../../HTML-05-PROPOSAL.md)及 [待授权输入](../../proposals/HTML-05/input-proposal.json)位于源码 `8928f9aac7a5d6a59615467c851d7e8a7e94c54f`；仍保留原来的 `budgetAuthorized:false` 和“待授权”历史表述。

用户在该提案之后回复“推进下一步”，本轮明确告知按仅一次HTML-05授权执行。事前准备的 [对话同意记录](authorization.json)、[实际输入](input-snapshot.json)、[免费预检](launch-preflight.json)与 [点击前意图](launch-intent.json)分别保留；同意记录不是独立签名或供应商账单限额。

冻结业务原话、八项验收、六位Agent与限额和HTML-04一致；新编号／来源／背景说明自拟场景，新策略为 `planned-groups-v1`，不输入旧回答或手写测试。六角色沿用本分支已配置的deepseek-flash，页面声明价格输入0.30／输出1.20 USD每百万Token。LLM-rubric、1候选、legacy实施证据，不调用Jev。

仅一次前端POST：24逻辑调用、500000总Token、6000每次输出、600秒、2次共享修复、1 USD声明价估算停止额度；整链保守16／28包络不自动提高24门限。unknown usage停止，不以零替代。运行期间源码、Prompt、Gate不改，外层不修生成产物、JSON或模板，不自动追加。

实际本地Chromium填写表单→免费预检→勾选本次预算→单击启动；浏览器插件不可用，使用可信Playwright自动操作，未拦截伪造API结果、替换SDK或注入模型判断。[观察到的规范化请求](actual-browser-submit.json)、[UI回执](ui-receipt.json)、[启动响应](launch-response.json)和 [惰性自动化源码文本](ui-driver.mjs.txt)可复核。自动化脚本记录已有启动意图时拒绝复跑；它不是用户产品的生成代码。

运行 `9a56085f-8a2e-474d-97fd-82f82aaac795`，点击前UTC `2026-10-08T08:48:29.191Z`，创建 `08:48:29.211Z`，结束 `08:49:21.992Z`；结果见 [RESULT](RESULT.md)。原始byte索引 [receipt-files.json](receipt-files.json)区分规范化JSON、实际artifact下载字节、截图和观察记录，不把相同hash当作独立真实性认证。
