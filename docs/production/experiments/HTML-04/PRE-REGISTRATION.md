# HTML-04 付费前预登记来源索引

本索引在实验结束后整理，不冒称本文件在付费前已经提交。实际付费前固定的是源码 `19466ab1c75610502ae8ff58a069308781e62151` 中的 [HTML-04 单次提案](https://github.com/litianyi-007/city-agent/blob/19466ab1c75610502ae8ff58a069308781e62151/docs/production/HTML04-NEXT-RUN-PROPOSAL.md)，以及它引用的 [原话与八项业务验收](https://github.com/litianyi-007/city-agent/blob/19466ab1c75610502ae8ff58a069308781e62151/docs/production/experiments/HTML-03/PRE-REGISTRATION.md)。原提案全文还在 [修改前留底](../../archive/2026-10-08-before-html04/HTML04-NEXT-RUN-PROPOSAL.md)；其中“待批准”是当时状态，随后用户明确批准仅本次1 USD。

编号HTML-04，kind=illustrative／mode=live：用户授权自拟的演示需求，非真实工单，由真实模型生成，非Mock。业务原话及全部八项验收与HTML-03逐字一致；source/background更新为本次批准及新v11探索，不复用旧角色答案、checks或源码。实际正文在 [input-snapshot.json](input-snapshot.json)，免费准备在 [launch-preflight.json](launch-preflight.json)，同意记录在 [authorization.json](authorization.json)。

固定六角色DeepSeek `deepseek-flash`，声明输入0.30／输出1.20 USD每百万Token；offline-single-html／LLM Verifier／legacy／N=1，Jev0。仅一次：1 USD声明价估算停止额度、24逻辑槽位、500000总Token、6000单次输出、600秒、2次共享修复；unknown停止后续调用，不续跑、不追加。金额不是供应商账单硬上限，保守Token预留可能提前停止。

来源／构建／boot一致且clean／ready；新免费预检reportHash `488381b84197d3e66da2e33864a965a2e259e315fceb82e511d94a768fd6ac92`，paidAuthorized=false／modelRequests=0／finalGate=null。实际提交只把同一预检input的budgetAuthorized改为true。浏览器连接不可用，本次透明改用本地工作台同一原生API启动；没有界面点击或录屏证明，未向另一服务传递Key。

成功判据在上述已提交方案中预先规定：真实生成、研发前冻结检查、实际行为Gate通过、项目经理批准、完整来源与费用、独立核对全部八项业务覆盖；即使completed也不能以遗漏要求的检查认证完整交付。实际结果及原输出见 [RESULT](RESULT.md)。
