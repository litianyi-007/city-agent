import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AcceptanceCheck } from '../../server/gate.js';
import { ACCEPTANCE_GROUP_VERSION, ACCEPTANCE_PLAN_VERSION, acceptancePlanHash, parseAcceptancePlan, type AcceptanceGroup, type AcceptancePlan } from '../../server/production/acceptance-plan.js';
import type { AcceptanceStepAuditInput } from '../../server/production/acceptance-step-audit.js';

// TEST-OWNED ONLY. A constructive capacity witness, not a generated deliverable,
// registered production template, role answer, fallback or autonomous success.
// Never import this file from server/, shared/, src/ or scripts/.
type Step = AcceptanceCheck['steps'][number];
export const expenseSource = () => {
  const bytes = readFileSync(new URL('../../docs/production/experiments/HTML-08/input-snapshot.json', import.meta.url));
  const value = JSON.parse(bytes.toString('utf8'));
  return { brief: value.brief as string, acceptance: value.requirement.acceptance as string,
    // SHA256 of the unmodified ORIGINAL FILE BYTES, not a JSON reserialization.
    sha256: createHash('sha256').update(bytes).digest('hex') };
};
const fill = (selector: string, value: string): Step => ({ action: 'fill', selector, value });
const click = (selector: string): Step => ({ action: 'click', selector });
const exact = (selector: string, text: string): Step => ({ action: 'assertTextExact', selector, text });
const count = (value: number): Step => ({ action: 'assertCount', selector: '#ledger .record', count: value });
const summary = (total: string, subtotal = total, hint = '') => `${hint}总额：${total}；当前小计：${subtotal}`;
const paper = '打印纸 ／ 办公 ／ 10.10';
const ticket = '车票 ／ 差旅 ／ 20.20';
const seed = '已有记录 ／ 办公 ／ 10.10';
const both = `${paper} ${ticket}`;
const observe = (rows: number, ledger: string, total: string, subtotal = total): Step[] => [
  count(rows), exact('#ledger', ledger), exact('#feedback', summary(total, subtotal)),
];
function add(description: string, amount: string, category: 'office' | 'travel' = 'office', useDocumentedDefault = false): Step[] {
  return [fill('#description', description), fill('#amount', amount),
    ...(useDocumentedDefault ? [] : [click(`#category-${category}`)]), click('#add')];
}
function reject(amount: string, existing: boolean, description = '合法描述', hint = '金额无效；'): Step[] {
  return [fill('#description', description), click('#category-office'), fill('#amount', amount),
    // One EXISTING outer Gate action, containing a real click. A fresh visible
    // feedback change is required for EVERY rejection, not a stale old hint.
    { action: 'assertChanged', selector: '#feedback', after: { action: 'click', selector: '#add' } },
    { action: 'assertVisible', selector: '#feedback' }, count(existing ? 1 : 0),
    exact('#ledger', existing ? seed : ''), exact('#feedback', summary(existing ? '10.10' : '0.00', undefined, hint))];
}

/** Public visible DOM contract chosen by this hand-written test: #ledger is
 * the actual list, with description/category/two-decimal amount and NO buttons;
 * #feedback is the visible user error + BOTH monetary statistics, not a hidden
 * digest/pass marker. Editing a field clears old feedback, so assertChanged
 * cannot mistake an earlier refusal for the current one. Default category is
 * visibly office. These are implementable design choices, not new Gate tools. */
export function expenseChecks(): AcceptanceCheck[] {
  const negativeBatches = [['-1', '0'], ['', '1.234'], ['10000.00']];
  const checks: AcceptanceCheck[] = [false, true].flatMap(existing => negativeBatches.map((amounts, index) => ({
    name: `金额拒绝-${existing ? '已有' : '空'}-${index + 1}`,
    steps: [...(existing ? add('已有记录', '10.10') : []),
      // Initial state is checked on this OWN fresh page. Check 10 separately
      // covers an empty category while other records exist. No state is borrowed.
      ...(!existing && index === 2 ? [...observe(0, '', '0.00'), { action: 'assertVisible' as const, selector: '#feedback' }] : []),
      ...amounts.flatMap(amount => reject(amount, existing)),
      ...(!existing && index === 2 ? reject('1.00', false, '', '描述不能为空；') : [])],
  })));
  checks.push(
    { name: '新增两类且每次清空输入', steps: [
      ...add('打印纸', '10.10'), ...observe(1, paper, '10.10'),
      { action: 'assertVisible', selector: '#ledger' },
      { action: 'assertValue', selector: '#description', value: '' }, { action: 'assertValue', selector: '#amount', value: '' },
      ...add('车票', '20.20', 'travel'), ...observe(2, both, '30.30'),
      { action: 'assertVisible', selector: '#ledger' },
      { action: 'assertValue', selector: '#description', value: '' }, { action: 'assertValue', selector: '#amount', value: '' },
    ] },
    { name: '双分类筛选并无损恢复全部', steps: [
      ...add('打印纸', '10.10', 'office', true), ...add('车票', '20.20', 'travel'),
      click('#filter-office'), { action: 'assertVisible', selector: '#ledger' }, ...observe(1, paper, '30.30', '10.10'),
      click('#filter-travel'), ...observe(1, ticket, '30.30', '20.20'),
      click('#filter-all'), ...observe(2, both, '30.30'),
    ] },
    { name: '独立小数相加与删除', steps: [
      ...add('一角', '0.10'), ...add('两角', '0.20'),
      { action: 'assertVisible', selector: '#ledger' },
      ...observe(2, '一角 ／ 办公 ／ 0.10 两角 ／ 办公 ／ 0.20', '0.30'),
      click('#delete-1'), ...observe(1, '两角 ／ 办公 ／ 0.20', '0.20'),
    ] },
    { name: '单条双边界而非总额上限', steps: [
      ...add('下界', '0.01'), ...observe(1, '下界 ／ 办公 ／ 0.01', '0.01'),
      ...add('上界', '9999.99'), ...observe(2, '下界 ／ 办公 ／ 0.01 上界 ／ 办公 ／ 9999.99', '10000.00'),
      { action: 'assertVisible', selector: '#ledger' },
      click('#filter-travel'), ...observe(0, '', '10000.00', '0.00'),
    ] },
    { name: '空和空格描述均拒绝且保留原记录', steps: [
      ...add('已有记录', '10.10'), ...reject('1.00', true, '', '描述不能为空；'), ...reject('1.00', true, '   ', '描述不能为空；'),
    ] },
    { name: '筛选删除目标与删除最后一条归零', steps: [
      // Office is an explicit visible initial DOM default in THIS contract;
      // omitting this redundant seed click saves one step, never borrows state.
      ...add('打印纸', '10.10', 'office', true), ...add('车票', '20.20', 'travel'),
      click('#filter-office'), click('#delete-1'), ...observe(0, '', '20.20', '0.00'),
      click('#filter-all'), ...observe(1, ticket, '20.20'),
      click('#delete-2'), ...observe(0, '', '0.00'),
    ] },
  );
  return checks;
}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
export function expenseAuditInput(checks = expenseChecks()): AcceptanceStepAuditInput {
  const source = expenseSource();
  const lines = source.acceptance.split('\n').slice(0, 8);
  const obligations: AcceptancePlan['obligations'] = [
    { id: 'brief', source: 'brief', quote: source.brief, scenario: 'Test-owned offline page.', expected: 'Actual behavior; no network or model.' },
    ...lines.map((quote, i) => ({ id: `a${i + 1}`, source: 'acceptance' as const, quote, scenario: 'Read the original clause and executable arrays.', expected: 'References are NOT a semantic coverage certificate.' })),
  ];
  const mapping = [['a6'], ['a6'], ['a1', 'a6', 'a7'], ['a6'], ['a6'], ['a6'], ['a2'], ['a3'], ['a4'], ['a1', 'a5'], ['a7'], ['a8']];
  const plan = parseAcceptancePlan({ version: ACCEPTANCE_PLAN_VERSION, obligations,
    groups: Array.from({ length: 3 }, (_, g) => ({ id: `g${g + 1}`, checks: checks.slice(g * 4, g * 4 + 4).map((check, i) => ({
      id: `c${g * 4 + i + 1}`, obligationIds: ['brief', ...mapping[g * 4 + i]!], setup: 'Independent fresh page; all setup included in steps.',
      exercise: check.name, assertions: 'Visible real ledger, count, feedback and statistics.', stepBudget: 20,
    })) })),
  }, source);
  const planHash = acceptancePlanHash(plan); const attemptId = uuid(1);
  const groups = plan.groups.map((group, index) => {
    const value: AcceptanceGroup = { version: ACCEPTANCE_GROUP_VERSION, planHash, attemptId, groupId: group.id,
      checks: group.checks.map((slot, i) => ({ checkId: slot.id, check: structuredClone(checks[index * 4 + i]!) })) };
    return { groupId: group.id, sourceCallId: uuid(10 + index), sourceCandidateId: uuid(20 + index),
      rawOutputSha256: hash(value), valueSha256: hash(value), value };
  });
  // Synthetic identities, NOT authenticated model-call lineage or an experiment.
  return { plan, planHash, attemptId, compositeCandidateId: uuid(2), groups, checks: structuredClone(checks) };
}

export const expenseMutants = [
  'placeholder', 'inputs-not-cleared', 'wrong-category', 'filter-leaks', 'filter-mutates', 'filtered-total',
  'concat', 'float-tail', 'reject-lower', 'reject-upper', 'aggregate-cap',
  'accept-negative', 'accept-zero', 'accept-empty', 'round-precision', 'accept-over-upper',
  'accept-blank', 'accept-spaces', 'reject-clears', 'reject-description', 'reject-category', 'reject-amount',
  'reject-total', 'reject-subtotal', 'hidden-hint', 'first-hint-only', 'stale-hint-only',
  'filtered-delete-all', 'delete-wrong', 'last-total-stale', 'empty-category-subtotal', 'hidden-ledger',
  'transient-reject-content', 'transient-reject-count', 'transient-reject-total', 'transient-reject-subtotal',
] as const;
export type ExpenseMutant = typeof expenseMutants[number];

/** Handwritten offline test HTML ONLY. Mutants change real app behavior, not
 * expected checks. There is no pass flag, test-index branch, external resource,
 * hidden digest, provider, shell, store, localStorage or network access. */
export function expenseHtml(mutant?: ExpenseMutant): string {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>工程容量见证（非模型交付）</title>
<style>body{font:16px sans-serif;padding:24px}button,input{margin:6px;padding:6px}#feedback{display:block;margin:12px 0}#ledger .record{padding:8px;border-bottom:1px solid #ddd}#operations{padding:8px}#ledger{white-space:normal}</style></head><body>
<h1>费用记录工程夹具</h1><label>描述<input id="description"></label><label>金额<input id="amount" type="text" inputmode="decimal"></label>
<fieldset><legend>分类（默认办公）</legend><button id="category-office" aria-pressed="true">办公</button><button id="category-travel" aria-pressed="false">差旅</button></fieldset><button id="add">添加</button>
<nav><button id="filter-all">全部</button><button id="filter-office">办公</button><button id="filter-travel">差旅</button></nav>
<output id="feedback" aria-live="polite"></output><section id="ledger" aria-label="记录明细"></section><section id="operations" aria-label="删除操作"></section>
<script>(()=>{'use strict';
const mutant=${JSON.stringify(mutant ?? null)};
const $=id=>document.getElementById(id); let rows=[],nextId=1,category='办公',filter='全部',hint='',rejections=0;
const sum=items=>items.reduce((n,row)=>n+row.cents,0);
const money=cents=>(cents/100).toFixed(2);
function render(){
 const visible=rows.filter(row=>filter==='全部'||row.category===filter); const ledger=$('ledger'),operations=$('operations'); ledger.replaceChildren();operations.replaceChildren();
 for(const row of visible){const node=document.createElement('div');node.className='record';
  node.textContent=(hint&&rejections===1&&mutant==='transient-reject-content'?'暂时破坏':row.description)+' ／ '+row.category+' ／ '+money(row.cents);
  if(!(hint&&rejections===1&&mutant==='transient-reject-count'))ledger.append(node);
  const button=document.createElement('button');button.id='delete-'+row.id;button.textContent='删除 '+row.description;
  button.onclick=()=>{if(mutant==='filtered-delete-all'&&filter!=='全部')rows=[];
   else if(mutant==='delete-wrong')rows=rows.filter(item=>item.id===row.id);
   else rows=rows.filter(item=>item.id!==row.id);hint='';render();};operations.append(button);}
 if(mutant==='placeholder'&&!visible.length){const fake=document.createElement('div');fake.className='record';fake.textContent='暂无费用';ledger.append(fake);}
 let total=sum(mutant==='filtered-total'?visible:rows),subtotal=sum(visible);
 if(hint&&mutant==='reject-total')total+=1;if(hint&&mutant==='reject-subtotal')subtotal+=1;
 if(hint&&rejections===1&&mutant==='transient-reject-total')total+=1;if(hint&&rejections===1&&mutant==='transient-reject-subtotal')subtotal+=1;
 if(mutant==='empty-category-subtotal'&&rows.length&&!visible.length)subtotal=total;
 let totalText=money(total),subtotalText=money(subtotal);
 if(mutant==='concat'&&rows.length===2){totalText=rows.map(row=>money(row.cents)).join('');subtotalText=totalText;}
 if(mutant==='float-tail'&&total===30){totalText=String(0.1+0.2);subtotalText=totalText;}
 if(mutant==='last-total-stale'&&!rows.length&&nextId>1){totalText='20.20';subtotalText='20.20';}
 $('feedback').textContent=hint+'总额：'+totalText+'；当前小计：'+subtotalText;
 $('feedback').style.display=hint&&mutant==='hidden-hint'?'none':'block';
 ledger.style.display=mutant==='hidden-ledger'?'none':'block';
}
function clearHint(){if(mutant!=='stale-hint-only')hint='';render();}
for(const id of ['description','amount'])$(id).addEventListener('input',clearHint);
for(const name of ['office','travel'])$('category-'+name).onclick=()=>{category=name==='office'?'办公':'差旅';
 $('category-office').setAttribute('aria-pressed',String(category==='办公'));$('category-travel').setAttribute('aria-pressed',String(category==='差旅'));clearHint();};
for(const name of ['all','office','travel'])$('filter-'+name).onclick=()=>{filter=name==='all'?'全部':name==='office'?'办公':'差旅';
 if(mutant==='filter-leaks')filter='全部';if(mutant==='filter-mutates'&&filter!=='全部')for(const row of rows)row.description='已破坏';hint='';render();};
function refuse(message){rejections++;hint=(mutant==='first-hint-only'&&rejections>1)?'':(mutant==='stale-hint-only'&&rejections>1)?hint:message;
 if(mutant==='reject-clears')rows=[];for(const row of rows){if(mutant==='reject-description')row.description='被改写';if(mutant==='reject-category')row.category='差旅';if(mutant==='reject-amount')row.cents=999;}render();}
$('add').onclick=()=>{let description=$('description').value.trim(),amount=$('amount').value.trim();
 if(!description&&!((mutant==='accept-blank'&&$('description').value==='')||(mutant==='accept-spaces'&&$('description').value==='   ')))return refuse('描述不能为空；');
 let cents;if(mutant==='accept-negative'&&amount==='-1')cents=100;
 else if(mutant==='accept-zero'&&amount==='0')cents=0;
 else if(mutant==='accept-empty'&&amount==='')cents=0;
 else if(mutant==='round-precision'&&amount==='1.234')cents=123;
 else if(mutant==='accept-over-upper'&&amount==='10000.00')cents=1000000;
 else {if(!/^\\d+(?:\\.\\d{1,2})?$/.test(amount))return refuse('金额无效；');
  const parts=amount.split('.');cents=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));
  if(!Number.isSafeInteger(cents)||cents<1||cents>999999)return refuse('金额无效；');}
 if((mutant==='reject-lower'&&cents===1)||(mutant==='reject-upper'&&cents===999999)||(mutant==='aggregate-cap'&&sum(rows)+cents>999999))return refuse('金额无效；');
 rows.push({id:nextId++,description,category:mutant==='wrong-category'?'差旅':category,cents});hint='';
 if(mutant!=='inputs-not-cleared'){$('description').value='';$('amount').value='';}render();};render();
})();</script></body></html>`;
}
