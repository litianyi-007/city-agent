import { productionCoverageContract } from './production-coverage.js';

/** Outer-authored challenge preparation, never a production task-routing rule. */
export const VERIFIER_HTML_B_CORPUS_VERSION = 'verifier-html-b-corpus-v1' as const;
export const VERIFIER_HTML_B_ORACLE_VERSION = 'verifier-html-b-oracle-v1' as const;
export type VerifierHtmlBPoolId = 'H07' | 'H08' | 'H09' | 'H10' | 'H11' | 'H12';
export type VerifierHtmlBStep =
  | { action: 'fill'; selector: string; value: string }
  | { action: 'click'; selector: string }
  | { action: 'assertTextExact'; selector: string; text: string }
  | { action: 'assertValue'; selector: string; value: string }
  | { action: 'assertCount'; selector: string; count: number };
export interface VerifierHtmlBCheck { name: string; steps: VerifierHtmlBStep[]; }
export interface VerifierHtmlBCandidate { id: string; value: { html: string }; }
export interface VerifierHtmlBPool {
  id: VerifierHtmlBPoolId;
  goal: string;
  acceptance: string;
  candidates: VerifierHtmlBCandidate[];
  checks: VerifierHtmlBCheck[];
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

export const VERIFIER_HTML_B_DOM_CONTRACTS = immutable({
  H07: { answered: '#answered', receipt: '#receipt', submit: '#submit', questions: '.question' },
  H08: { score: '#score', submit: '#submit', questions: '.question' },
  H09: { pending: '#pending-count', working: '#working-count', done: '#done-count', cards: '.ticket' },
  H10: { name: '#item-name', quantity: '#item-quantity', add: '#add', count: '#item-count', total: '#quantity-total', message: '#message', rows: '.item' },
  H11: { amount: '#amount', add: '#add', food: '#food-total', travel: '#travel-total', total: '#total', message: '#message', rows: '.expense' },
  H12: { name: '#name', city: '#city', next: '#next', back: '#back', reset: '#reset', finish: '#finish', progress: '#progress', summary: '#summary', receipt: '#receipt', message: '#message' },
});

const click = (selector: string): VerifierHtmlBStep => ({ action: 'click', selector });
const fill = (selector: string, value: string): VerifierHtmlBStep => ({ action: 'fill', selector, value });
const exact = (selector: string, text: string): VerifierHtmlBStep => ({ action: 'assertTextExact', selector, text });
const count = (selector: string, value: number): VerifierHtmlBStep => ({ action: 'assertCount', selector, count: value });
const input = (selector: string, value: string): VerifierHtmlBStep => ({ action: 'assertValue', selector, value });
const check = (name: string, steps: VerifierHtmlBStep[]): VerifierHtmlBCheck => ({ name, steps });

function document(title: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;padding:24px;background:#f8fafc;color:#1e293b;font:16px system-ui,sans-serif}main{max-width:680px;margin:auto;padding:24px;background:white;border:1px solid #cbd5e1;border-radius:12px}label{display:block;margin:8px 0}input{font:inherit;padding:8px;max-width:100%;box-sizing:border-box}button{font:inherit;min-height:44px;padding:8px 16px;margin:6px;color:white;background:#1d4ed8;border:0;border-radius:6px}input:focus-visible,button:focus-visible{outline:3px solid #f97316;outline-offset:3px}.question,.ticket,.item,.expense{padding:12px;margin:8px 0;border:1px solid #cbd5e1;border-radius:6px}output{display:block;margin:12px 0}#message{min-height:24px;color:#b91c1c}[hidden]{display:none!important}</style></head><body><main id="app"><h1>${title}</h1>${body}</main><script>'use strict';${script}</script></body></html>`;
}

const surveyOptions = [['取餐', '自取', '配送'], ['餐食', '热食', '冷食'], ['饮品', '茶', '水']];
function surveyDocument(layout: 'section' | 'fieldset', implementation: string): string {
  const questions = surveyOptions.map(([title, a, b], index) => {
    const number = index + 1;
    const heading = layout === 'fieldset' ? `<legend>${title}</legend>` : `<h2>${title}</h2>`;
    return `<${layout} class="question">${heading}<label><input id="q${number}-a" type="radio" name="q${number}" value="${a}">${a}</label><label><input id="q${number}-b" type="radio" name="q${number}" value="${b}">${b}</label></${layout}>`;
  }).join('');
  return document('用餐偏好问卷', `${questions}<output id="answered" aria-live="polite">0/3</output><button id="submit" type="button">提交答案</button><output id="receipt" aria-live="polite"></output>`, implementation);
}
const surveyFromDom = `const titles=['取餐','餐食','饮品'];function values(){return titles.map((_,i)=>document.querySelector('input[name="q'+(i+1)+'"]:checked')?.value||'');}document.querySelectorAll('input[type="radio"]').forEach(el=>el.addEventListener('change',()=>{document.getElementById('answered').textContent=values().filter(Boolean).length+'/3';}));document.getElementById('submit').addEventListener('click',()=>{document.getElementById('receipt').textContent=values().map((v,i)=>titles[i]+'='+(v||'未选')).join('；');});`;
const surveyFromState = `const titles=['取餐','餐食','饮品'],answers=new Map();document.querySelectorAll('input[type="radio"]').forEach(el=>el.addEventListener('change',()=>{answers.set(el.name,el.value);document.getElementById('answered').textContent=answers.size+'/3';}));document.getElementById('submit').addEventListener('click',()=>{let parts=[];for(let i=0;i<titles.length;i++)parts.push(titles[i]+'='+(answers.get('q'+(i+1))||'未选'));document.getElementById('receipt').textContent=parts.join('；');});`;

function quizDocument(update: string): string {
  return document('两题知识测验', `<section class="question"><h2>2+3等于多少？</h2><label><input id="q1-a" type="radio" name="q1" value="5">5</label><label><input id="q1-b" type="radio" name="q1" value="6">6</label></section><section class="question"><h2>太阳从哪个方向升起？</h2><label><input id="q2-a" type="radio" name="q2" value="east">东</label><label><input id="q2-b" type="radio" name="q2" value="west">西</label></section><button id="submit" type="button">提交测验</button><output id="score" aria-live="polite">0/2</output>`, `let total=0;document.getElementById('submit').addEventListener('click',()=>{const current=Number(document.querySelector('input[name="q1"]:checked')?.value==='5')+Number(document.querySelector('input[name="q2"]:checked')?.value==='east');${update}document.getElementById('score').textContent=total+'/2';});`);
}

function boardDocument(render: string): string {
  return document('工单看板', `<p>待办 <span id="pending-count">1</span>；进行中 <span id="working-count">1</span>；已完成 <span id="done-count">0</span></p><article id="ticket-a" class="ticket"><h2 id="ticket-a-title">更新帮助页</h2><output id="ticket-a-state">待办</output><button id="ticket-a-back" type="button">上一步</button><button id="ticket-a-forward" type="button">下一步</button></article><article id="ticket-b" class="ticket"><h2 id="ticket-b-title">核对价格</h2><output id="ticket-b-state">进行中</output><button id="ticket-b-back" type="button">上一步</button><button id="ticket-b-forward" type="button">下一步</button></article>`, `const states=['待办','进行中','已完成'],items={a:0,b:1};function render(){${render}}for(const id of Object.keys(items)){document.getElementById('ticket-'+id+'-forward').addEventListener('click',()=>{items[id]=Math.min(2,items[id]+1);render();});document.getElementById('ticket-'+id+'-back').addEventListener('click',()=>{items[id]=Math.max(0,items[id]-1);render();});}render();`);
}
const boardCards = `for(const id of Object.keys(items))document.getElementById('ticket-'+id+'-state').textContent=states[items[id]];`;
const boardCounts = `['pending-count','working-count','done-count'].forEach((id,index)=>{document.getElementById(id).textContent=String(Object.values(items).filter(state=>state===index).length);});`;
const boardTotals = (a: string, b: string, c: string): VerifierHtmlBStep[] => [exact('#pending-count', a), exact('#working-count', b), exact('#done-count', c)];

function procurementDocument(removal: string): string {
  return document('采购清单', `<label for="item-name">商品名称</label><input id="item-name" type="text" autocomplete="off"><label for="item-quantity">数量（1–99整数）</label><input id="item-quantity" type="text" inputmode="numeric" autocomplete="off"><button id="add" type="button">添加商品</button><output id="item-count">0</output><output id="quantity-total">0</output><p id="message" role="status"></p><div id="items"></div>`, String.raw`const nameInput=document.getElementById('item-name'),quantityInput=document.getElementById('item-quantity'),message=document.getElementById('message');let items=[],sequence=0;function render(){const list=document.getElementById('items');list.replaceChildren();items.forEach(item=>{const row=document.createElement('section');row.className='item';row.id='item-'+item.id;const label=document.createElement('span');label.className='item-name';label.textContent=item.name;const amount=document.createElement('span');amount.className='item-quantity';amount.textContent=String(item.quantity);const button=document.createElement('button');button.type='button';button.className='remove';button.textContent='删除';button.addEventListener('click',()=>{${removal}render();});row.append(label,amount,button);list.append(row);});document.getElementById('item-count').textContent=String(items.length);document.getElementById('quantity-total').textContent=String(items.reduce((sum,item)=>sum+item.quantity,0));}document.getElementById('add').addEventListener('click',()=>{const name=nameInput.value.trim(),quantity=Number(quantityInput.value);if(!name||!/^\d+$/.test(quantityInput.value)||!Number.isInteger(quantity)||quantity<1||quantity>99){message.textContent='请输入名称及1–99整数数量';return;}message.textContent='';items.push({id:'i'+(++sequence),name,quantity,slot:items.length});nameInput.value='';quantityInput.value='';render();});render();`);
}
const purchase = (name: string, quantity: string): VerifierHtmlBStep[] => [fill('#item-name', name), fill('#item-quantity', quantity), click('#add')];
const threePurchases = (): VerifierHtmlBStep[] => [...purchase('牛奶', '1'), ...purchase('牛奶', '2'), ...purchase('牛奶', '3')];

function expenseDocument(aggregation: string): string {
  return document('分类支出账本', `<p>当前分类：<span id="category">餐饮</span></p><button id="food" type="button">餐饮</button><button id="travel" type="button">交通</button><label for="amount">金额（大于0，最多两位小数）</label><input id="amount" type="text" inputmode="decimal" autocomplete="off"><button id="add" type="button">添加支出</button><p>餐饮 <span id="food-total">0.00</span>；交通 <span id="travel-total">0.00</span>；总额 <span id="total">0.00</span></p><p id="message" role="status"></p><div id="expenses"></div>`, String.raw`let category='餐饮',sequence=0,items=[];const amountInput=document.getElementById('amount'),message=document.getElementById('message');const format=cents=>Math.floor(cents/100)+'.'+String(cents%100).padStart(2,'0');document.getElementById('food').addEventListener('click',()=>{category='餐饮';document.getElementById('category').textContent=category;});document.getElementById('travel').addEventListener('click',()=>{category='交通';document.getElementById('category').textContent=category;});function render(){const list=document.getElementById('expenses');list.replaceChildren();for(const item of items){const row=document.createElement('section');row.className='expense';row.id='expense-'+item.id;const label=document.createElement('span');label.className='expense-category';label.textContent=item.category;const amount=document.createElement('span');amount.className='expense-amount';amount.textContent=format(item.cents);const button=document.createElement('button');button.type='button';button.className='remove';button.textContent='删除';button.addEventListener('click',()=>{items=items.filter(value=>value.id!==item.id);render();});row.append(label,amount,button);list.append(row);}${aggregation}}document.getElementById('add').addEventListener('click',()=>{const value=amountInput.value.trim();if(!/^\d+(?:\.\d{1,2})?$/.test(value)){message.textContent='请输入大于0且最多两位小数的金额';return;}const parts=value.split('.'),cents=Number(parts[0])*100+Number((parts[1]||'').padEnd(2,'0'));if(!Number.isSafeInteger(cents)||cents<=0||cents>100000000){message.textContent='请输入大于0且最多两位小数的金额';return;}message.textContent='';items.push({id:'i'+(++sequence),category,cents});amountInput.value='';render();});render();`);
}
const expenseReduce = `const food=items.filter(item=>item.category==='餐饮').reduce((sum,item)=>sum+item.cents,0),travel=items.filter(item=>item.category==='交通').reduce((sum,item)=>sum+item.cents,0);document.getElementById('food-total').textContent=format(food);document.getElementById('travel-total').textContent=format(travel);document.getElementById('total').textContent=format(food+travel);`;
const expenseMap = `const totals=new Map([['餐饮',0],['交通',0]]);for(const item of items)totals.set(item.category,totals.get(item.category)+item.cents);for(const [category,id] of [['餐饮','food-total'],['交通','travel-total']])document.getElementById(id).textContent=format(totals.get(category));document.getElementById('total').textContent=format([...totals.values()].reduce((sum,cents)=>sum+cents,0));`;
const addExpense = (amount: string): VerifierHtmlBStep[] => [fill('#amount', amount), click('#add')];
const expenseTotals = (food: string, travel: string, total: string): VerifierHtmlBStep[] => [exact('#food-total', food), exact('#travel-total', travel), exact('#total', total)];

function wizardDocument(submission: string, reset: string): string {
  return document('联系资料登记', `<output id="progress">1/3</output><section id="step-1"><label for="name">姓名</label><input id="name" type="text" autocomplete="off"></section><section id="step-2" hidden><label for="city">城市</label><input id="city" type="text" autocomplete="off"></section><section id="step-3" hidden><output id="summary"></output></section><button id="back" type="button" hidden>上一步</button><button id="next" type="button">下一步</button><button id="finish" type="button" hidden>提交资料</button><button id="reset" type="button">重置</button><p id="message" role="status"></p><output id="receipt"></output>`, `let step=1,draft={name:'',city:''},receipt='';const nameInput=document.getElementById('name'),cityInput=document.getElementById('city'),message=document.getElementById('message');function render(){for(let i=1;i<=3;i++)document.getElementById('step-'+i).hidden=i!==step;document.getElementById('progress').textContent=step+'/3';document.getElementById('back').hidden=step===1;document.getElementById('next').hidden=step===3;document.getElementById('finish').hidden=step!==3;document.getElementById('summary').textContent=step===3?'姓名='+draft.name+'；城市='+draft.city:'';}document.getElementById('next').addEventListener('click',()=>{const value=(step===1?nameInput.value:cityInput.value).trim();if(!value){message.textContent=step===1?'请输入姓名':'请输入城市';return;}message.textContent='';if(step===1)draft.name=value;else draft.city=value;step++;render();});document.getElementById('back').addEventListener('click',()=>{if(step>1)step--;message.textContent='';render();});document.getElementById('finish').addEventListener('click',()=>{${submission}document.getElementById('receipt').textContent=receipt;});document.getElementById('reset').addEventListener('click',()=>{nameInput.value='';cityInput.value='';message.textContent='';document.getElementById('receipt').textContent='';${reset}step=1;render();});render();`);
}
const wizardData = (name: string, city: string): VerifierHtmlBStep[] => [fill('#name', name), click('#next'), fill('#city', city), click('#next')];

export const VERIFIER_HTML_B_CORPUS: VerifierHtmlBPool[] = immutable([
  {
    id: 'H07', goal: '填写取餐、餐食和饮品三个独立单选题，并提交当前答案。',
    acceptance: '取餐为自取/配送，餐食为热食/冷食，饮品为茶/水。每题只能选择一项，各题互不覆盖。初始已答0/3、提交结果为空；选题后已答数立即更新，改选同题不增加计数。每次点击提交由当前三题重算，依次输出“取餐=值；餐食=值；饮品=值”，未选显示未选。允许section或fieldset等义DOM布局。',
    candidates: [
      { id: 'cand-28c5', value: { html: surveyDocument('section', surveyFromDom) } },
      { id: 'cand-a760', value: { html: surveyDocument('fieldset', surveyFromState) } },
    ],
    checks: [
      check('问卷初始三题均未选', [count('.question', 3), exact('#answered', '0/3'), exact('#receipt', '')]),
      check('三题选择互不覆盖且提交精确', [click('#q1-a'), click('#q2-b'), click('#q3-a'), exact('#answered', '3/3'), click('#submit'), exact('#receipt', '取餐=自取；餐食=冷食；饮品=茶')]),
      check('改选后计数不增且重新提交', [click('#q1-a'), click('#q2-a'), click('#q3-b'), click('#submit'), exact('#receipt', '取餐=自取；餐食=热食；饮品=水'), click('#q2-b'), exact('#answered', '3/3'), click('#submit'), exact('#receipt', '取餐=自取；餐食=冷食；饮品=水')]),
      check('部分回答保留未选并由当前状态重算', [click('#q1-b'), exact('#answered', '1/3'), click('#submit'), exact('#receipt', '取餐=配送；餐食=未选；饮品=未选'), click('#q2-a'), exact('#answered', '2/3'), click('#submit'), exact('#receipt', '取餐=配送；餐食=热食；饮品=未选')]),
      check('同题反复改选不影响其他题', [click('#q1-a'), click('#q2-a'), click('#q3-a'), click('#q1-b'), click('#q1-a'), click('#q3-b'), exact('#answered', '3/3'), click('#submit'), exact('#receipt', '取餐=自取；餐食=热食；饮品=水')]),
    ],
  },
  {
    id: 'H08', goal: '按当前答案计算两题测验分数，重复提交和修改答案不能保留旧分。',
    acceptance: '两题分别为2+3（5得1分、6得0分）和太阳升起方向（东得1分、西得0分）。初始0/2，未选为0分。每次提交精确重算当前答案：两题答对2/2，改错一题1/2，两题改错0/2。重复提交相同答案不累加；先错后对可以提高分数。',
    candidates: [
      { id: 'cand-73de', value: { html: quizDocument('total+=current;') } },
      { id: 'cand-4b81', value: { html: quizDocument('total=Math.max(total,current);') } },
    ],
    checks: [
      check('测验初态与未回答提交', [count('.question', 2), exact('#score', '0/2'), click('#submit'), exact('#score', '0/2')]),
      check('只回答一题未选题计零分', [click('#q1-a'), click('#submit'), exact('#score', '1/2')]),
      check('重复提交不累加分数', [click('#q1-a'), click('#q2-a'), click('#submit'), exact('#score', '2/2'), click('#submit'), exact('#score', '2/2')]),
      check('改错一题必须降至一分', [click('#q1-a'), click('#q2-a'), click('#submit'), exact('#score', '2/2'), click('#q1-b'), click('#submit'), exact('#score', '1/2')]),
      check('两题改错必须归零', [click('#q1-a'), click('#q2-a'), click('#submit'), exact('#score', '2/2'), click('#q1-b'), click('#q2-b'), click('#submit'), exact('#score', '0/2')]),
      check('先错后对由当前答案升分', [click('#q1-b'), click('#q2-b'), click('#submit'), exact('#score', '0/2'), click('#q1-a'), click('#submit'), exact('#score', '1/2')]),
    ],
  },
  {
    id: 'H09', goal: '让两张工单在待办、进行中、已完成之间往返流转并保持分类数一致。',
    acceptance: '初始“更新帮助页”待办，“核对价格”进行中，分类数1/1/0。每卡下一步前进、上一步后退，边界不越界。每次动作后卡片状态与待办/进行中/已完成数量精确一致，往返流转保留两张卡、各自标题和身份。',
    candidates: [
      { id: 'cand-e105', value: { html: boardDocument(boardCards) } },
      { id: 'cand-6f92', value: { html: boardDocument(boardCards + boardCounts) } },
    ],
    checks: [
      check('工单初态和独立身份', [count('.ticket', 2), exact('#ticket-a-title', '更新帮助页'), exact('#ticket-b-title', '核对价格'), exact('#ticket-a-state', '待办'), exact('#ticket-b-state', '进行中'), ...boardTotals('1', '1', '0')]),
      check('前进后卡片和三个分类数同步', [click('#ticket-a-forward'), exact('#ticket-a-state', '进行中'), ...boardTotals('0', '2', '0'), click('#ticket-a-forward'), exact('#ticket-a-state', '已完成'), ...boardTotals('0', '1', '1'), count('.ticket', 2), exact('#ticket-b-state', '进行中')]),
      check('另一工单往返流转无丢失', [click('#ticket-b-forward'), exact('#ticket-b-state', '已完成'), ...boardTotals('1', '0', '1'), click('#ticket-b-back'), exact('#ticket-b-state', '进行中'), ...boardTotals('1', '1', '0'), click('#ticket-b-back'), exact('#ticket-b-state', '待办'), ...boardTotals('2', '0', '0'), count('.ticket', 2)]),
      check('完整往返恢复初始分类和身份', [click('#ticket-a-forward'), click('#ticket-a-forward'), click('#ticket-a-back'), click('#ticket-a-back'), exact('#ticket-a-state', '待办'), exact('#ticket-b-state', '进行中'), ...boardTotals('1', '1', '0'), count('.ticket', 2), exact('#ticket-a-title', '更新帮助页'), exact('#ticket-b-title', '核对价格')]),
      check('流转边界不越界且分类数稳定', [click('#ticket-a-back'), exact('#ticket-a-state', '待办'), ...boardTotals('1', '1', '0'), click('#ticket-b-forward'), click('#ticket-b-forward'), exact('#ticket-b-state', '已完成'), ...boardTotals('1', '0', '1'), count('.ticket', 2)]),
    ],
  },
  {
    id: 'H10', goal: '同名采购项以独立ID管理，删除指定项不影响其他同名项。',
    acceptance: '名称非空，数量为1–99整数，添加成功后清空输入。初始0项、总数量0。连续添加牛奶数量1、2、3后生成独立i1/i2/i3，共3项、总量6。删除任何一项只能移除该ID，保留其他项名称、数量和身份；删除中间项后继续删除最后项应只剩i1数量1。非法输入提示且不改变清单。',
    candidates: [
      { id: 'cand-90ac', value: { html: procurementDocument('items=items.filter(value=>value.name!==item.name);') } },
      { id: 'cand-2d47', value: { html: procurementDocument('items.splice(item.slot,1);') } },
    ],
    checks: [
      check('采购清单初始为空', [count('.item', 0), exact('#item-count', '0'), exact('#quantity-total', '0')]),
      check('三个同名项身份和数量独立', [...threePurchases(), count('.item', 3), exact('#item-count', '3'), exact('#quantity-total', '6'), exact('#item-i1 .item-quantity', '1'), exact('#item-i2 .item-quantity', '2'), exact('#item-i3 .item-quantity', '3'), input('#item-name', ''), input('#item-quantity', '')]),
      check('删除第一项保留其他同名项', [...threePurchases(), click('#item-i1 .remove'), count('#item-i1', 0), count('.item', 2), exact('#item-i2 .item-name', '牛奶'), exact('#item-i2 .item-quantity', '2'), exact('#item-i3 .item-quantity', '3'), exact('#item-count', '2'), exact('#quantity-total', '5')]),
      check('删中间再删末项不得使用失效索引', [...threePurchases(), click('#item-i2 .remove'), count('#item-i2', 0), exact('#quantity-total', '4'), click('#item-i3 .remove'), count('.item', 1), count('#item-i3', 0), exact('#item-i1 .item-name', '牛奶'), exact('#item-i1 .item-quantity', '1'), exact('#item-count', '1'), exact('#quantity-total', '1')]),
      check('连续删除首项和次项保留末项', [...threePurchases(), click('#item-i1 .remove'), count('.item', 2), exact('#item-i2 .item-quantity', '2'), click('#item-i2 .remove'), count('.item', 1), count('#item-i1', 0), count('#item-i2', 0), exact('#item-i3 .item-quantity', '3'), exact('#quantity-total', '3')]),
      check('非法数量和空名称不改原项', [...purchase('牛奶', '1'), fill('#item-name', '牛奶'), fill('#item-quantity', '0'), click('#add'), exact('#message', '请输入名称及1–99整数数量'), count('.item', 1), exact('#quantity-total', '1'), fill('#item-name', ''), fill('#item-quantity', '2'), click('#add'), exact('#message', '请输入名称及1–99整数数量'), count('.item', 1), exact('#quantity-total', '1')]),
      check('数量上界与非整数拒绝', [...purchase('牛奶', '99'), exact('#quantity-total', '99'), fill('#item-name', '牛奶'), fill('#item-quantity', '100'), click('#add'), exact('#message', '请输入名称及1–99整数数量'), fill('#item-quantity', '1.5'), click('#add'), exact('#message', '请输入名称及1–99整数数量'), fill('#item-quantity', 'abc'), click('#add'), exact('#message', '请输入名称及1–99整数数量'), count('.item', 1), exact('#quantity-total', '99')]),
    ],
  },
  {
    id: 'H11', goal: '按餐饮和交通分类记录支出，新增删除后金额汇总精确到分。',
    acceptance: '初始分类餐饮，分类和总額均0.00，无记录。金额大于0、最多两位小数且不超过1000000.00；空值、0、负数、非数字、超过两位小数或越界须拒绝且保留账本。以整数分汇总，0.10+0.20必须为0.30。切换分类、新增和删除后各分类与总额同步；添加成功清空金额输入。同池等义算法均可。',
    candidates: [
      { id: 'cand-c38e', value: { html: expenseDocument(expenseReduce) } },
      { id: 'cand-51b4', value: { html: expenseDocument(expenseMap) } },
    ],
    checks: [
      check('支出账本初态', [count('.expense', 0), exact('#category', '餐饮'), ...expenseTotals('0.00', '0.00', '0.00')]),
      check('小数金额以整数分相加', [...addExpense('0.10'), ...addExpense('0.20'), count('.expense', 2), ...expenseTotals('0.30', '0.00', '0.30'), exact('#expense-i1 .expense-amount', '0.10'), exact('#expense-i2 .expense-amount', '0.20'), input('#amount', '')]),
      check('新增和分类切换不串账', [...addExpense('12.34'), click('#travel'), ...addExpense('5.06'), click('#food'), ...addExpense('0.60'), count('.expense', 3), ...expenseTotals('12.94', '5.06', '18.00'), exact('#expense-i2 .expense-category', '交通')]),
      check('删除后分类与总额同步归算', [...addExpense('0.10'), ...addExpense('0.20'), click('#travel'), ...addExpense('0.30'), click('#expense-i1 .remove'), ...expenseTotals('0.20', '0.30', '0.50'), click('#expense-i3 .remove'), ...expenseTotals('0.20', '0.00', '0.20'), count('.expense', 1), exact('#expense-i2 .expense-amount', '0.20')]),
      check('空零负金额拒绝并保留支出', [...addExpense('1.00'), ...addExpense(''), exact('#message', '请输入大于0且最多两位小数的金额'), ...addExpense('0'), exact('#message', '请输入大于0且最多两位小数的金额'), ...addExpense('-0.01'), exact('#message', '请输入大于0且最多两位小数的金额'), count('.expense', 1), ...expenseTotals('1.00', '0.00', '1.00')]),
      check('非数字多位小数和越界金额拒绝', [...addExpense('2.00'), ...addExpense('abc'), exact('#message', '请输入大于0且最多两位小数的金额'), ...addExpense('1.001'), exact('#message', '请输入大于0且最多两位小数的金额'), ...addExpense('1000000.01'), exact('#message', '请输入大于0且最多两位小数的金额'), count('.expense', 1), ...expenseTotals('2.00', '0.00', '2.00')]),
      check('金额上界与删除归零', [...addExpense('1000000.00'), ...expenseTotals('1000000.00', '0.00', '1000000.00'), click('#expense-i1 .remove'), count('.expense', 0), ...expenseTotals('0.00', '0.00', '0.00')]),
    ],
  },
  {
    id: 'H12', goal: '三步联系资料表单重置后，从字段到进度到最终提交数据都回到初态。',
    acceptance: '姓名→城市→确认三个步骤，初始1/3、字段和确认/回执为空。姓名/城市不能为空，下一步分别校验，成功到3/3时确认“姓名=值；城市=值”，提交同样精确回执。任意步骤重置清空字段、确认、回执与内部提交数据并回到1/3；重置后空字段仍被拒绝，再次填写全新姓名城市并完整提交不得复用旧回执。',
    candidates: [
      { id: 'cand-8fa2', value: { html: wizardDocument("receipt='姓名='+draft.name+'；城市='+draft.city;", "draft={name:'',city:''};receipt='';") } },
      { id: 'cand-36d9', value: { html: wizardDocument("receipt=receipt||'姓名='+draft.name+'；城市='+draft.city;", '') } },
    ],
    checks: [
      check('表单初始进度和全部空值', [exact('#progress', '1/3'), input('#name', ''), input('#city', ''), exact('#summary', ''), exact('#receipt', ''), exact('#message', '')]),
      check('三步资料正常确认提交', [fill('#name', '林'), click('#next'), exact('#progress', '2/3'), fill('#city', '杭州'), click('#next'), exact('#progress', '3/3'), exact('#summary', '姓名=林；城市=杭州'), click('#finish'), exact('#receipt', '姓名=林；城市=杭州')]),
      check('提交后重置全部显示和进度', [...wizardData('林', '杭州'), click('#finish'), click('#reset'), exact('#progress', '1/3'), input('#name', ''), input('#city', ''), exact('#summary', ''), exact('#receipt', ''), exact('#message', '')]),
      check('重置后姓名空值仍被校验', [...wizardData('林', '杭州'), click('#reset'), click('#next'), exact('#message', '请输入姓名'), exact('#progress', '1/3'), exact('#receipt', '')]),
      check('重置后城市空值仍被校验', [...wizardData('林', '杭州'), click('#reset'), fill('#name', '王'), click('#next'), click('#next'), exact('#message', '请输入城市'), exact('#progress', '2/3'), exact('#receipt', '')]),
      check('重置后重新完整提交不能复用旧数据', [...wizardData('林', '杭州'), click('#finish'), exact('#receipt', '姓名=林；城市=杭州'), click('#reset'), ...wizardData('陈', '宁波'), exact('#summary', '姓名=陈；城市=宁波'), click('#finish'), exact('#receipt', '姓名=陈；城市=宁波'), exact('#progress', '3/3')]),
      check('中途重置后重新完成新资料', [fill('#name', '林'), click('#next'), fill('#city', '杭州'), click('#reset'), ...wizardData('周', '绍兴'), click('#finish'), exact('#receipt', '姓名=周；城市=绍兴'), exact('#progress', '3/3')]),
    ],
  },
]);

/** Evaluation control plane only. Never serialize this export into a review. */
export const VERIFIER_HTML_B_EXPECTATIONS = immutable([
  { poolId: 'H07' as const, candidateId: 'cand-28c5', expectedPass: true, defect: null },
  { poolId: 'H07' as const, candidateId: 'cand-a760', expectedPass: true, defect: null },
  { poolId: 'H08' as const, candidateId: 'cand-73de', expectedPass: false, defect: '提交累加当前得分，重复提交或改错仍增加旧分。' },
  { poolId: 'H08' as const, candidateId: 'cand-4b81', expectedPass: false, defect: '只保留历史最高分，修改答案不能降低成绩。' },
  { poolId: 'H09' as const, candidateId: 'cand-e105', expectedPass: false, defect: '工单卡片变化但分类统计始终停留初态。' },
  { poolId: 'H09' as const, candidateId: 'cand-6f92', expectedPass: true, defect: null },
  { poolId: 'H10' as const, candidateId: 'cand-90ac', expectedPass: false, defect: '按名称批量删除，移除一个ID会删除其他同名采购项。' },
  { poolId: 'H10' as const, candidateId: 'cand-2d47', expectedPass: false, defect: '删除时使用添加时的索引，之前删除后会移除错项或无效删除。' },
  { poolId: 'H11' as const, candidateId: 'cand-c38e', expectedPass: true, defect: null },
  { poolId: 'H11' as const, candidateId: 'cand-51b4', expectedPass: true, defect: null },
  { poolId: 'H12' as const, candidateId: 'cand-8fa2', expectedPass: true, defect: null },
  { poolId: 'H12' as const, candidateId: 'cand-36d9', expectedPass: false, defect: '重置清空显示却保留上次提交回执，再次完整填写后提交旧资料。' },
]);

/** Whitelisted blind snapshot: acceptance is legitimate, labels/results are not. */
export function verifierHtmlBReviewSnapshot(poolId: VerifierHtmlBPoolId, frozen: { version: string; hash: string }) {
  const pool = VERIFIER_HTML_B_CORPUS.find(item => item.id === poolId);
  if (!pool || !/^[a-f0-9]{64}$/.test(frozen.hash) || !/^[a-z0-9-]{1,100}$/.test(frozen.version)) throw new Error('Invalid challenge pool or frozen contract reference');
  return immutable({
    phase: 'implement', capability: 'offline-single-html' as const, goal: pool.goal, acceptance: pool.acceptance, frozenHash: frozen.hash,
    candidates: pool.candidates.map(candidate => ({ id: candidate.id, value: { html: candidate.value.html } })),
    reviewContext: {
      contextSource: 'Hand-authored challenge preparation, not prior autonomous role execution',
      product: { goal: pool.goal, scope: 'offline-single-html', acceptance: [pool.acceptance], exclusions: ['No backend, host execution, external requests or camera'] },
      research: { observations: ['Apply the complete supplied state transitions, numeric bounds and exact output requirements.'], constraints: ['Complete inline offline HTML; frozen business checks are immutable.'], unknowns: ['deferred: no real model decisions measured for this challenge preparation'] },
      plan: { decision: 'proceed', summary: 'Implement all supplied behavior within the controlled offline capability.', tasks: [{ id: 'implementation', owner: 'developer', description: pool.goal }, { id: 'validation', owner: 'tester', description: 'Execute the identical frozen business checks against both candidates.' }], risks: [] },
      frozenContract: { version: frozen.version, hash: frozen.hash, checks: structuredClone(pool.checks) },
      knownPlatform: { capability: 'offline-single-html', output: 'Complete inline HTML5; no external resources', execution: 'Short-lived request-denying Chromium; no generated host Node/shell execution', verificationBoundary: 'Independent frozen behavior Gate still required' },
      coverageContract: productionCoverageContract('offline-single-html'), feedback: null, cycle: 0,
    },
  });
}
