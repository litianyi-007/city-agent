import { z } from 'zod';
import { acceptanceSchema } from '../gate.js';

export const PROMPT_VERSION = 'production-html-v1';
export const CRITERIA_VERSION = 'verifier-ordinal-v1';
export const productSchema = z.object({ goal: z.string().min(3).max(5000), scope: z.literal('offline-single-html'), acceptance: z.array(z.string().min(1).max(1000)).min(1).max(12), exclusions: z.array(z.string().max(500)).max(12) }).strict();
export const researchSchema = z.object({ observations: z.array(z.string().min(1).max(1000)).min(1).max(12), constraints: z.array(z.string().min(1).max(1000)).min(1).max(12), unknowns: z.array(z.string().max(500)).max(12) }).strict();
export const planSchema = z.object({ decision: z.enum(['proceed', 'revise', 'stop']), summary: z.string().min(1).max(2000), tasks: z.array(z.object({ id: z.string().min(1).max(60), owner: z.enum(['product', 'researcher', 'developer', 'tester']), description: z.string().min(1).max(1000) }).strict()).min(1).max(12), risks: z.array(z.string().max(500)).max(12) }).strict();
export const testsSchema = z.object({ checks: acceptanceSchema }).strict().superRefine((value, ctx) => {
  let businessBehavior = false;
  for (const [i, check] of value.checks.entries()) {
    const changedInputs = new Set<string>(); let clicked = false;
    for (const [j, step] of check.steps.entries()) {
      for (const selector of [step.selector, ...(step.action === 'assertChanged' ? [step.after.selector] : [])]) if (selector.includes('\\') || /\[([^\]]+)\]\s+\[\1\]/.test(selector) || />>|xpath=|text=/.test(selector)) ctx.addIssue({ code: 'custom', path: ['checks', i, 'steps', j], message: '仅接受明确的普通 CSS 选择器；禁止非法转义、嵌套重复属性及跨选择器引擎。' });
      if (step.action === 'fill') changedInputs.add(step.selector);
      if (step.action === 'click') clicked = true;
      if (step.action === 'assertChanged' && step.selector !== step.after.selector) businessBehavior = true;
      if ((clicked || changedInputs.size > 0) && ['assertText', 'assertTextExact', 'assertCount', 'assertValue'].includes(step.action) && !changedInputs.has(step.selector)) businessBehavior = true;
    }
  }
  if (!businessBehavior) ctx.addIssue({ code: 'custom', path: ['checks'], message: '必须验证交互后的业务结果，输入原样回显或仅可见按钮不能作为生产验收。此机械门限不代替完整业务覆盖审查。' });
});
export const codeSchema = z.object({ html: z.string().min(30).max(500000) }).strict().refine(value => /^\s*<!doctype\s+html\s*>/i.test(value.html) && /<\/html>\s*$/i.test(value.html), 'HTML 必须为完整 HTML5 文档，不能截断或包含 Markdown 围栏');
export const verifierSchema = z.object({ decision: z.enum(['accept', 'abstain']), selectedCandidateId: z.string().nullable(), scores: z.array(z.object({ candidateId: z.string(), score: z.number().int().min(0).max(5), reason: z.string().min(1).max(1000) }).strict()).min(1).max(2), reason: z.string().min(1).max(1500) }).strict();
export function parseJson(text: string): unknown { const trimmed = text.trim(); const body = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(trimmed)?.[1] ?? trimmed; return JSON.parse(body); }
export function parseVerifiedDecision(value: unknown, candidateIds: string[]) {
  const result = verifierSchema.parse(value);
  if (result.scores.length !== candidateIds.length || new Set(result.scores.map(score => score.candidateId)).size !== candidateIds.length || result.scores.some(score => !candidateIds.includes(score.candidateId))) throw new Error('Verifier 必须逐一评估当前全部合法候选，不能混用旧候选');
  if (result.decision === 'abstain') { if (result.selectedCandidateId !== null) throw new Error('弃权不能选择候选'); return result; }
  const selected = result.scores.find(score => score.candidateId === result.selectedCandidateId);
  if (!selected || selected.score < 3 || selected.score < Math.max(...result.scores.map(score => score.score))) throw new Error('Verifier 只能选择当前候选中达到最低门限且评分最高的候选');
  return result;
}
export const CONTRACT_INSTRUCTIONS = {
  product: '返回严格JSON：{"goal":"可操作目标","scope":"offline-single-html","acceptance":["业务标准"],"exclusions":["不支持范围"]}。只能离线单HTML应用，不运行Node、shell、不联网；不能虚构已交付。需求明确要求无法支持的后端/仓库能力时，不能偷偷缩减为相同目标，须拒绝。',
  researcher: '返回严格JSON：{"observations":["基于已提供信息的判断"],"constraints":["约束"],"unknowns":["未知"]}。本角色没有外部搜索工具；不能虚构已搜索或已验证来源。',
  'project-manager': '返回严格JSON：{"decision":"proceed|revise|stop","summary":"简短决策依据而非隐藏思维过程","tasks":[{"id":"任务ID","owner":"product|researcher|developer|tester","description":"具体任务"}],"risks":["风险"]}。不得改变需求、冻结验收或预算；无法支持须stop。Gate失败只能revise或stop，不能声称通过；Gate通过可proceed交付。',
  tester: '返回严格JSON {"checks":[{"name":"检查名","steps":[...]}]}，2–12项独立新页面，每项最多20步。步骤fill(selector,value)、click(selector)、assertVisible(selector)、assertText(selector,text,包含)、assertTextExact(selector,text,精确可含空串)、assertCount(selector,count,精确匹配元素数量)、assertValue(selector,value,精确)、assertChanged(selector,after:{action:click|fill,selector,value?})。至少一项先交互再业务结果断言，或assertChanged；必须覆盖全部用户验收，数字不能用包含断言，只验证输入本身不够。普通唯一CSS选择器，不用反斜杠或重复嵌套。定义明确DOM/业务契约，随后冻结。',
  developer: '返回严格JSON {"html":"<!doctype html>...完整闭合文档... </html>"}。实现用户业务目标及全部冻结检查，所有JS/CSS内联；禁止外部网络、弹窗、下载、iframe、worker、后端或shell。不能删除失败测试或修改冻结检查。不能把静态通过文案当功能。',
} as const;
