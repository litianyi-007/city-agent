# 阶段准入v1 / grouped v5

日期2026-10-09，依据[HTML08原始失败](experiments/HTML-08/RESULT.md)推进；旧实验不修改，新版本无真实模型运行。

## 根因与最小改动

HTML08的产品、研究和PM均输出合法结构，三轮PM却将下游tester的实际CSS/步骤当作当前think-design准入条件。tester仅在PM proceed后才能运行，revise只重新生成前置产品/研究/PM，形成阶段依赖循环。独立Verifier还接受没有实际数组支持的低步数估计；静态评分并不证明覆盖与容量。

新流程仍是产品→研究→PM范围准入→PM acceptance-plan→分组tester→完整验收复核→冻结→研发→实际Gate→有限反馈。固定控制面policy为每个准确角色/阶段提供currentArtifact、requiredNow、downstreamArtifacts、proceedAuthorizes、evidenceBoundary。只接受准确两个参数，拒绝第三个状态参数；深冻结固定对象，模型不提供或修改政策。policy仅表明依赖规则，不声明产物已存在、验收已通过或实际freeze/Gate事实。

PM现在须基于当前已知条件判断是否可以进入验收构建。未来的检查尚未生成本身不应成为前置拒绝理由，但真实范围冲突、blocking未知、确定容量不可行仍必须revise/stop。planSchema不新增PM owner；proceed由控制面进入本角色acceptance-plan，再分配测试角色。研发仍等完整契约通过并冻结后才能生成。

独立Verifier使用同一宿主政策，未来步骤估计不是实际计数，不能把其当完整覆盖证据。完整验收阶段仍核一次实际checks全文、步骤数组、来源hash和原业务要求；固定12项×20步、最多3组、两次共享返修、unknown停止、取消和实际Gate均不放宽。PM不被强制proceed，实际Gate失败不能被政策/评分覆盖。

## 版本与兼容

- 新grouped Prompt为production-html-grouped-v5，新政策production-phase-readiness-v1，来源清单verifier-study-source-v9只在原54条之后追加phase-readiness.ts。
- 旧v1～v4 Prompt导出和原plan/test/verifier schema逐字hash保留；只改变显式分组验收路径，不自动改变非分组HTML或camera能力。
- 免费启动预检与运行使用相同完整指令及政策扫描，新增字段phaseReadinessVersion可选、向后兼容。历史Agent/Jev凭据代际、尾部碰撞保护不裁剪。
- 固定政策不是安全沙箱；生成Node/shell/通用仓库仍须验证隔离后开放。

## 免费验证与下一门限

新增15项涵盖成功夹具中freeze先于developer、PM真实revise/stop、伪造政策字段、13项/21步拒绝、合法预算耗尽、unknown用量、取消、actual Gate失败及完整默认启动保护。连同planning-loop、output-envelope、output-contract共46/46通过，29.627秒，TypeScript通过；均为注入调用并禁止外部HTTP。

新版本的真实效果仍待独立新授权/预登记。HTML08单次批准已消费；原费用0.0658755 USD为声明价估算，不是账单。免费工程通过不算一次模型自主交付，更不证明稳定L4/L5。
