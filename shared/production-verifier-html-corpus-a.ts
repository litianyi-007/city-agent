import { productionCoverageContract } from './production-coverage.js';

/** Outer-authored challenge data; never dispatched by the production task router. */
export const VERIFIER_HTML_A_CORPUS_VERSION = 'verifier-html-a-corpus-v1' as const;
export const VERIFIER_HTML_A_ORACLE_VERSION = 'verifier-html-a-oracle-v1' as const;
export type VerifierHtmlAPoolId = 'H01' | 'H02' | 'H03' | 'H04' | 'H05' | 'H06';
export type VerifierHtmlAStep =
  | { action: 'fill'; selector: string; value: string }
  | { action: 'click'; selector: string }
  | { action: 'assertTextExact'; selector: string; text: string }
  | { action: 'assertValue'; selector: string; value: string }
  | { action: 'assertCount'; selector: string; count: number };
export interface VerifierHtmlACheck { name: string; steps: VerifierHtmlAStep[]; }
export interface VerifierHtmlACandidate { id: string; value: { html: string }; }
export interface VerifierHtmlAPool {
  id: VerifierHtmlAPoolId;
  goal: string;
  acceptance: string;
  candidates: VerifierHtmlACandidate[];
  checks: VerifierHtmlACheck[];
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

const fill = (selector: string, value: string): VerifierHtmlAStep => ({ action: 'fill', selector, value });
const click = (selector: string): VerifierHtmlAStep => ({ action: 'click', selector });
const exact = (selector: string, text: string): VerifierHtmlAStep => ({ action: 'assertTextExact', selector, text });
const count = (selector: string, value: number): VerifierHtmlAStep => ({ action: 'assertCount', selector, count: value });
const input = (selector: string, value: string): VerifierHtmlAStep => ({ action: 'assertValue', selector, value });
const check = (name: string, steps: VerifierHtmlAStep[]): VerifierHtmlACheck => ({ name, steps });

/** Same selectors and business Oracle for both candidates within each pool. */
export const VERIFIER_HTML_A_DOM_CONTRACT = immutable({
  H01: { quantity: '#quantity', submit: '#submit', inventory: '#inventory', message: '#message', rows: '#movements li' },
  H02: { price: '#price', quantity: '#quantity', calculate: '#calculate', amount: '#amount', message: '#message' },
  H03: { price: '#price', quantity: '#quantity', calculate: '#calculate', amount: '#amount', message: '#message' },
  H04: { temperature: '#temperature', celsius: '#unit-c', fahrenheit: '#unit-f', mode: '#mode', convert: '#convert', result: '#result', message: '#message' },
  H05: { date: '#date', slot: '#slot', reserve: '#reserve', message: '#message', rows: '#reservations li' },
  H06: { all: '#filter-all', stationery: '#filter-stationery', food: '#filter-food', pet: '#filter-pet', count: '#count', rows: '#catalog .item' },
});

/** Fixed, complete inline fixture documents; no arbitrary runtime interpolation. */
function document(title: string, content: string, script: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:24px;background:#f8fafc;color:#1e293b;font:16px system-ui,sans-serif}main{max-width:560px;margin:auto;padding:24px;background:white;border:1px solid #cbd5e1;border-radius:12px}label{display:block;margin:16px 0 6px}input,button{box-sizing:border-box;min-height:44px;font:inherit}input{width:100%;padding:8px;border:1px solid #64748b;border-radius:6px}button{padding:8px 16px;margin:16px 8px 0 0;color:white;background:#1d4ed8;border:0;border-radius:6px}button:focus-visible,input:focus-visible{outline:3px solid #f97316;outline-offset:3px}output{display:block;min-height:24px;margin-top:20px}#message{min-height:24px;color:#b91c1c}li{padding:8px 0}li span+span{margin-left:8px}</style></head>
<body><main id="app"><h1>${title}</h1>${content}</main><script>'use strict';${script}</script></body></html>`;
}

const inventoryError = '数量必须为 1–5 的整数';
const inventoryContent = '<p>初始库存 20 件，提交后记录出库数量。</p><label for="quantity">出库数量</label><input id="quantity" type="text" inputmode="numeric" autocomplete="off"><button id="submit" type="button">提交出库</button><output id="inventory" aria-live="polite">20</output><p id="message" role="status"></p><ul id="movements"></ul>';
function inventoryScript(minimum: number, maximum: number): string {
  return String.raw`const quantity=document.getElementById('quantity'),inventory=document.getElementById('inventory'),message=document.getElementById('message'),movements=document.getElementById('movements');let remaining=20;document.getElementById('submit').addEventListener('click',()=>{const text=quantity.value;message.textContent='';if(!/^\d+$/.test(text)){message.textContent='${inventoryError}';return;}const n=Number(text);if(!Number.isSafeInteger(n)||n<${minimum}||n>${maximum}){message.textContent='${inventoryError}';return;}if(n>remaining){message.textContent='库存不足';return;}remaining-=n;inventory.textContent=String(remaining);const row=document.createElement('li');row.textContent='出库 '+n+' 件；库存 '+remaining+' 件';movements.appendChild(row);});`;
}
function stock(quantity: string, remaining: string, rows: number): VerifierHtmlAStep[] {
  return [fill('#quantity', quantity), click('#submit'), exact('#inventory', remaining), count('#movements li', rows), exact('#movements li:last-child', `出库 ${quantity} 件；库存 ${remaining} 件`), exact('#message', '')];
}
function invalidStock(quantity: string): VerifierHtmlAStep[] {
  return [fill('#quantity', quantity), click('#submit'), exact('#message', inventoryError), exact('#inventory', '19'), count('#movements li', 1), exact('#movements li', '出库 1 件；库存 19 件')];
}

const orderError = '单价须为 1–1000 的整数，数量须为 1–10 的整数';
const orderContent = '<p>订单原总额达到 100 元时，全单九折。</p><label for="price">单价（元）</label><input id="price" type="text" inputmode="numeric" autocomplete="off"><label for="quantity">数量</label><input id="quantity" type="text" inputmode="numeric" autocomplete="off"><button id="calculate" type="button">核算订单</button><output id="amount" aria-live="polite"></output><p id="message" role="status"></p>';
function orderScript(discountCondition: string): string {
  return String.raw`const price=document.getElementById('price'),quantity=document.getElementById('quantity'),amount=document.getElementById('amount'),message=document.getElementById('message');document.getElementById('calculate').addEventListener('click',()=>{message.textContent='';if(!/^\d+$/.test(price.value)||!/^\d+$/.test(quantity.value)){message.textContent='${orderError}';return;}const p=Number(price.value),q=Number(quantity.value);if(!Number.isSafeInteger(p)||!Number.isSafeInteger(q)||p<1||p>1000||q<1||q>10){message.textContent='${orderError}';return;}const total=p*q;amount.textContent=(${discountCondition}?total*0.9:total).toFixed(2);});`;
}
function calculate(price: string, quantity: string, amount: string): VerifierHtmlAStep[] {
  return [fill('#price', price), fill('#quantity', quantity), click('#calculate'), exact('#amount', amount), exact('#message', ''), input('#quantity', quantity)];
}
function invalidCalculation(price: string, quantity: string, error: string, previous: string): VerifierHtmlAStep[] {
  return [fill('#price', price), fill('#quantity', quantity), click('#calculate'), exact('#message', error), exact('#amount', previous)];
}

const precisionError = '单价须为 0.001–9999.999 的至多三位小数，数量须为 1–1000 的整数';
const precisionContent = '<p>先计算单价乘以数量，再按四舍五入保留两位小数。</p><label for="price">单价（元）</label><input id="price" type="text" inputmode="decimal" autocomplete="off"><label for="quantity">数量</label><input id="quantity" type="text" inputmode="numeric" autocomplete="off"><button id="calculate" type="button">核算金额</button><output id="amount" aria-live="polite"></output><p id="message" role="status"></p>';
function precisionScript(cents: string): string {
  return String.raw`const price=document.getElementById('price'),quantity=document.getElementById('quantity'),amount=document.getElementById('amount'),message=document.getElementById('message');document.getElementById('calculate').addEventListener('click',()=>{message.textContent='';if(!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/.test(price.value)||!/^\d+$/.test(quantity.value)){message.textContent='${precisionError}';return;}const parts=price.value.split('.'),milli=Number(parts[0])*1000+Number((parts[1]||'').padEnd(3,'0')),q=Number(quantity.value);if(milli<1||milli>9999999||!Number.isSafeInteger(q)||q<1||q>1000){message.textContent='${precisionError}';return;}const cents=${cents};amount.textContent=(cents/100).toFixed(2);});`;
}

const temperatureError = '请输入 -1000–1000 的至多三位小数';
const temperatureContent = '<p>摄氏与华氏双向转换，结果保留两位小数。</p><button id="unit-c" type="button">摄氏输入</button><button id="unit-f" type="button">华氏输入</button><output id="mode">摄氏输入</output><label for="temperature">当前单位的温度</label><input id="temperature" type="text" inputmode="decimal" autocomplete="off"><button id="convert" type="button">转换</button><output id="result" aria-live="polite"></output><p id="message" role="status"></p>';
const temperatureScriptA = String.raw`const temperature=document.getElementById('temperature'),result=document.getElementById('result'),message=document.getElementById('message'),display=document.getElementById('mode');let mode='C';function setMode(value){mode=value;display.textContent=value==='C'?'摄氏输入':'华氏输入';result.textContent='';message.textContent='';}document.getElementById('unit-c').addEventListener('click',()=>setMode('C'));document.getElementById('unit-f').addEventListener('click',()=>setMode('F'));document.getElementById('convert').addEventListener('click',()=>{message.textContent='';if(!/^-?(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/.test(temperature.value)){message.textContent='${temperatureError}';return;}const n=Number(temperature.value);if(!Number.isFinite(n)||n< -1000||n>1000){message.textContent='${temperatureError}';return;}const answer=mode==='C'?n*9/5+32:(n-32)*5/9;result.textContent=(Math.abs(answer)<0.0000001?0:answer).toFixed(2)+(mode==='C'?' °F':' °C');});`;
const temperatureScriptB = String.raw`const temperature=document.getElementById('temperature'),result=document.getElementById('result'),message=document.getElementById('message'),display=document.getElementById('mode');let configuration={label:'摄氏输入',suffix:' °F',numerator:9,denominator:5,offset:32,inputOffset:0};function switchUnit(fahrenheit){configuration=fahrenheit?{label:'华氏输入',suffix:' °C',numerator:5,denominator:9,offset:0,inputOffset:32}:{label:'摄氏输入',suffix:' °F',numerator:9,denominator:5,offset:32,inputOffset:0};display.textContent=configuration.label;result.textContent='';message.textContent='';}document.getElementById('unit-c').addEventListener('click',()=>switchUnit(false));document.getElementById('unit-f').addEventListener('click',()=>switchUnit(true));document.getElementById('convert').addEventListener('click',()=>{message.textContent='';const value=temperature.value;if(!/^-?(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?$/.test(value)){message.textContent='${temperatureError}';return;}const n=Number(value);if(!Number.isFinite(n)||Math.abs(n)>1000){message.textContent='${temperatureError}';return;}const converted=(n-configuration.inputOffset)*configuration.numerator/configuration.denominator+configuration.offset;result.textContent=(Math.abs(converted)<0.0000001?0:converted).toFixed(2)+configuration.suffix;});`;
function temperature(value: string, result: string): VerifierHtmlAStep[] {
  return [fill('#temperature', value), click('#convert'), exact('#result', result), exact('#message', '')];
}

const bookingError = '请输入 2026 年有效日期与 09:00–10:00 或 10:00–11:00 时段';
const duplicateBooking = '该日期时段已预约';
const bookingContent = '<p>同一天同一时段只能预约一次，不同日期互不冲突。</p><label for="date">日期（YYYY-MM-DD，2026 年）</label><input id="date" type="text" autocomplete="off"><label for="slot">时段（09:00–10:00 或 10:00–11:00）</label><input id="slot" type="text" autocomplete="off"><button id="reserve" type="button">预约</button><p id="message" role="status"></p><ul id="reservations"></ul>';
function bookingScript(conflictPredicate: string): string {
  return String.raw`const date=document.getElementById('date'),slot=document.getElementById('slot'),message=document.getElementById('message'),reservations=document.getElementById('reservations');const entries=[];document.getElementById('reserve').addEventListener('click',()=>{const day=date.value,time=slot.value;message.textContent='';if(!/^2026-\d{2}-\d{2}$/.test(day)||!['09:00–10:00','10:00–11:00'].includes(time)){message.textContent='${bookingError}';return;}const parts=day.split('-').map(Number),calendar=new Date(Date.UTC(parts[0],parts[1]-1,parts[2]));if(calendar.getUTCFullYear()!==parts[0]||calendar.getUTCMonth()+1!==parts[1]||calendar.getUTCDate()!==parts[2]){message.textContent='${bookingError}';return;}if(${conflictPredicate}){message.textContent='${duplicateBooking}';return;}entries.push({day,time});const row=document.createElement('li');row.textContent=day+' '+time;reservations.appendChild(row);message.textContent='预约成功';});`;
}
function book(date: string, slot: string, rows: number): VerifierHtmlAStep[] {
  return [fill('#date', date), fill('#slot', slot), click('#reserve'), exact('#message', '预约成功'), count('#reservations li', rows), exact('#reservations li:last-child', `${date} ${slot}`)];
}

const catalogContent = '<p>按分类筛选商品，可以随时恢复全部目录。</p><button id="filter-all" type="button">全部</button><button id="filter-stationery" type="button">文具</button><button id="filter-food" type="button">食品</button><button id="filter-pet" type="button">宠物</button><output id="count" aria-live="polite">4</output><ul id="catalog"></ul>';
function catalogScript(update: string): string {
  return `let items=[{name:'晨光笔记本',category:'文具'},{name:'海盐饼干',category:'食品'},{name:'轻便铅笔',category:'文具'},{name:'宠物冻干',category:'宠物'}];const catalog=document.getElementById('catalog'),count=document.getElementById('count');function render(list){catalog.replaceChildren();for(const item of list){const row=document.createElement('li');row.className='item';const name=document.createElement('span'),category=document.createElement('span');name.className='name';category.className='category';name.textContent=item.name;category.textContent=item.category;row.append(name,category);catalog.appendChild(row);}count.textContent=String(list.length);}function filter(category){${update}}document.getElementById('filter-all').addEventListener('click',()=>filter(null));document.getElementById('filter-stationery').addEventListener('click',()=>filter('文具'));document.getElementById('filter-food').addEventListener('click',()=>filter('食品'));document.getElementById('filter-pet').addEventListener('click',()=>filter('宠物'));render(items);`;
}
function catalog(names: string[]): VerifierHtmlAStep[] {
  return [exact('#count', String(names.length)), count('#catalog .item', names.length), ...names.map((name, index) => exact(`#catalog .item:nth-child(${index + 1}) .name`, name))];
}
const allNames = ['晨光笔记本', '海盐饼干', '轻便铅笔', '宠物冻干'];

export const VERIFIER_HTML_A_CORPUS: VerifierHtmlAPool[] = immutable([
  {
    id: 'H01', goal: '做一个初始库存为 20 件的离线出库页面，限制每次出库数量为 1～5 件。',
    acceptance: '输入必须是 1–5 的十进制整数，点击提交按该数量减少当前库存，并且只新增一条含精确数量和剩余库存的记录。1→库存19、5→库存15；连续提交1和5→库存14、两条记录。0、6、负数、小数、空值及非数字应显示“数量必须为 1–5 的整数”，不改变已有库存或记录。库存不足不允许出库。',
    candidates: [
      { id: 'cand-f15c', value: { html: document('库存出库', inventoryContent, inventoryScript(1, 5)) } },
      { id: 'cand-62d8', value: { html: document('库存出库', inventoryContent, inventoryScript(0, 6)) } },
    ],
    checks: [
      check('初始库存与空记录', [exact('#inventory', '20'), count('#movements li', 0)]),
      check('最小合法出库精确记录', stock('1', '19', 1)),
      check('最大合法出库精确记录', stock('5', '15', 1)),
      check('连续出库按当前库存扣减且记录不丢失', [...stock('1', '19', 1), ...stock('5', '14', 2), exact('#movements li:first-child', '出库 1 件；库存 19 件')]),
      check('零数量拒绝且不改变库存记录', [...stock('1', '19', 1), ...invalidStock('0')]),
      check('超上限数量拒绝且不改变库存记录', [...stock('1', '19', 1), ...invalidStock('6')]),
      check('负数和小数拒绝且不改变库存记录', [...stock('1', '19', 1), ...invalidStock('-1'), ...invalidStock('1.5')]),
      check('空值和非数字拒绝且不改变库存记录', [...stock('1', '19', 1), ...invalidStock(''), ...invalidStock('abc')]),
      check('库存不足拒绝且记录精确保留', [...stock('5', '15', 1), fill('#quantity', '5'), click('#submit'), click('#submit'), click('#submit'), exact('#inventory', '0'), count('#movements li', 4), click('#submit'), exact('#message', '库存不足'), exact('#inventory', '0'), count('#movements li', 4), exact('#movements li:last-child', '出库 5 件；库存 0 件')]),
    ],
  },
  {
    id: 'H02', goal: '按订单原总额计算全单九折优惠，不按单件商品价格决定优惠。',
    acceptance: '单价为1–1000元整数、数量为1–10整数；原总额=单价×数量，达到100元（含100）后全单九折，否则原价；金额精确显示两位小数，不改变数量输入。100×1→90.00，60×2→108.00，99×1→99.00，10×10→90.00，100×2→180.00。每次按当前输入重算。空值、非数字、零、小数和越界显示输入错误并保留上次金额。',
    candidates: [
      { id: 'cand-7ab2', value: { html: document('订单优惠核算', orderContent, orderScript('total>100')) } },
      { id: 'cand-d90e', value: { html: document('订单优惠核算', orderContent, orderScript('p>=100')) } },
    ],
    checks: [
      check('达到整单阈值即九折', calculate('100', '1', '90.00')),
      check('多件低单价按整单金额优惠', calculate('60', '2', '108.00')),
      check('阈值以下不折扣且保留数量', calculate('99', '1', '99.00')),
      check('多件恰好达到阈值精确优惠', calculate('10', '10', '90.00')),
      check('重算不累加且大额全单九折', [...calculate('60', '2', '108.00'), ...calculate('100', '2', '180.00')]),
      check('零值越界拒绝且保留金额', [...calculate('99', '1', '99.00'), ...invalidCalculation('0', '1', orderError, '99.00'), ...invalidCalculation('1001', '1', orderError, '99.00')]),
      check('非法数量拒绝且保留金额', [...calculate('99', '1', '99.00'), ...invalidCalculation('10', '0', orderError, '99.00'), ...invalidCalculation('10', '11', orderError, '99.00')]),
      check('空值与非整数输入拒绝', [...calculate('99', '1', '99.00'), ...invalidCalculation('', '1', orderError, '99.00'), ...invalidCalculation('1.5', '1', orderError, '99.00')]),
      check('非数字和负数拒绝', [...calculate('99', '1', '99.00'), ...invalidCalculation('abc', '1', orderError, '99.00'), ...invalidCalculation('10', '-1', orderError, '99.00')]),
    ],
  },
  {
    id: 'H03', goal: '支持三位小数的单价，先乘数量再把订单金额四舍五入至两位小数。',
    acceptance: '单价为0.001–9999.999元、最多三位小数，数量为1–1000整数；统一按非负金额四舍五入至分，不能先舍入单价。1.005×3→3.02，0.335×3→1.01，2.555×2→5.11，3.333×3→10.00；0.001×1→0.00，9999.999×1000→9999999.00。数量输入不被舍入或改写。每次按当前输入重算；非法输入显示输入错误且保留上次金额。',
    candidates: [
      { id: 'cand-3e91', value: { html: document('批量金额核算', precisionContent, precisionScript('Math.floor((milli+5)/10)*q')) } },
      { id: 'cand-80c4', value: { html: document('批量金额核算', precisionContent, precisionScript('Math.floor((milli*q+5)/10)')) } },
    ],
    checks: [
      check('乘法后半分边界统一舍入', calculate('1.005', '3', '3.02')),
      check('小额多件统一舍入不先舍入单价', calculate('0.335', '3', '1.01')),
      check('两件半分单价得到精确总额', calculate('2.555', '2', '5.11')),
      check('再次核算由当前输入重算且数量不改写', [...calculate('0.335', '3', '1.01'), ...calculate('3.333', '3', '10.00')]),
      check('最小金额与最大批量精确边界', [...calculate('0.001', '1', '0.00'), ...calculate('9999.999', '1000', '9999999.00')]),
      check('单价小数超精度与零值拒绝', [...calculate('1', '2', '2.00'), ...invalidCalculation('1.0001', '2', precisionError, '2.00'), ...invalidCalculation('0', '2', precisionError, '2.00')]),
      check('越界及负单价拒绝', [...calculate('1', '2', '2.00'), ...invalidCalculation('10000', '2', precisionError, '2.00'), ...invalidCalculation('-1', '2', precisionError, '2.00')]),
      check('小数数量与数量越界拒绝', [...calculate('1', '2', '2.00'), ...invalidCalculation('1', '1.5', precisionError, '2.00'), ...invalidCalculation('1', '1001', precisionError, '2.00')]),
      check('空值和非数字单价拒绝', [...calculate('1', '2', '2.00'), ...invalidCalculation('', '2', precisionError, '2.00'), ...invalidCalculation('abc', '2', precisionError, '2.00')]),
      check('零数量保留已有金额', [...calculate('1', '2', '2.00'), ...invalidCalculation('1', '0', precisionError, '2.00')]),
    ],
  },
  {
    id: 'H04', goal: '提供摄氏与华氏双向温度转换，支持零值、负数及反复切换输入单位。',
    acceptance: '默认摄氏输入。C→F按C×9/5+32，F→C按(F−32)×5/9；结果两位小数并附“ °F”或“ °C”，零不得显示负零。0°C→32.00 °F，−40°C→−40.00 °F，32°F→0.00 °C，−4°F→−20.00 °C。单位按钮切换只更新模式并清空旧结果/错误，不改温度输入；切换后按新单位正确重算。输入允许−1000–1000、至多三位小数，非法输入显示错误并保留上次结果。',
    candidates: [
      { id: 'cand-49fe', value: { html: document('双向温度转换', temperatureContent, temperatureScriptA) } },
      { id: 'cand-ac26', value: { html: document('双向温度转换', temperatureContent, temperatureScriptB) } },
    ],
    checks: [
      check('初始摄氏模式与零值转换', [exact('#mode', '摄氏输入'), ...temperature('0', '32.00 °F')]),
      check('摄氏负温及小数正确换算', [...temperature('-40', '-40.00 °F'), ...temperature('12.5', '54.50 °F')]),
      check('华氏零摄氏边界无负零', [click('#unit-f'), exact('#mode', '华氏输入'), ...temperature('32', '0.00 °C')]),
      check('华氏负温正确换算', [click('#unit-f'), ...temperature('-4', '-20.00 °C')]),
      check('来回切换清除旧结果不改输入', [...temperature('100', '212.00 °F'), click('#unit-f'), exact('#mode', '华氏输入'), exact('#result', ''), exact('#message', ''), input('#temperature', '100'), ...temperature('212', '100.00 °C'), click('#unit-c'), exact('#mode', '摄氏输入'), exact('#result', ''), input('#temperature', '212')]),
      check('切换后的当前单位确实用于重算', [click('#unit-f'), ...temperature('32', '0.00 °C'), click('#unit-c'), ...temperature('0', '32.00 °F')]),
      check('正负范围端点有效', [...temperature('-1000', '-1768.00 °F'), ...temperature('1000', '1832.00 °F')]),
      check('越界及超精度拒绝保留结果', [...temperature('0', '32.00 °F'), fill('#temperature', '1001'), click('#convert'), exact('#message', temperatureError), exact('#result', '32.00 °F'), fill('#temperature', '1.0001'), click('#convert'), exact('#message', temperatureError), exact('#result', '32.00 °F')]),
      check('空输入非数字拒绝保留结果', [...temperature('0', '32.00 °F'), fill('#temperature', ''), click('#convert'), exact('#message', temperatureError), exact('#result', '32.00 °F'), fill('#temperature', 'abc'), click('#convert'), exact('#message', temperatureError), exact('#result', '32.00 °F')]),
      check('切换单位清除错误但保留输入', [fill('#temperature', 'abc'), click('#convert'), exact('#message', temperatureError), click('#unit-f'), exact('#message', ''), exact('#result', ''), exact('#mode', '华氏输入'), input('#temperature', 'abc')]),
    ],
  },
  {
    id: 'H05', goal: '做一个离线预约列表，同日期同时间段不可重复，不同日期同时间段互不冲突。',
    acceptance: '日期为2026年真实有效的YYYY-MM-DD；时段只允许“09:00–10:00”或“10:00–11:00”。预约成功仅新增一条精确日期/时段记录并显示“预约成功”。同日期同时间段第二次应显示“该日期时段已预约”，记录数不变。不同日期同时间段可以同时预约，同日期不同时段可以同时预约。空值、非法日期、2026-02-30及非法时段显示输入错误，不改已有列表。',
    candidates: [
      { id: 'cand-6b07', value: { html: document('日期时段预约', bookingContent, bookingScript('false')) } },
      { id: 'cand-c8a3', value: { html: document('日期时段预约', bookingContent, bookingScript('entries.some(entry=>entry.time===time)')) } },
    ],
    checks: [
      check('初始预约为空', [count('#reservations li', 0), exact('#message', '')]),
      check('首次预约只增加一条精确记录', book('2026-10-07', '09:00–10:00', 1)),
      check('同日期时段拒绝重复且保留原记录', [...book('2026-10-07', '09:00–10:00', 1), click('#reserve'), exact('#message', duplicateBooking), count('#reservations li', 1), exact('#reservations li', '2026-10-07 09:00–10:00')]),
      check('不同日期同一时段互不冲突', [...book('2026-10-07', '09:00–10:00', 1), ...book('2026-10-08', '09:00–10:00', 2), exact('#reservations li:first-child', '2026-10-07 09:00–10:00')]),
      check('同日期不同时段互不冲突', [...book('2026-10-07', '09:00–10:00', 1), ...book('2026-10-07', '10:00–11:00', 2), exact('#reservations li:first-child', '2026-10-07 09:00–10:00')]),
      check('有效日期年首与年末边界', [...book('2026-01-01', '09:00–10:00', 1), ...book('2026-12-31', '10:00–11:00', 2)]),
      check('不存在日期与越界年份拒绝', [...book('2026-10-07', '09:00–10:00', 1), fill('#date', '2026-02-30'), click('#reserve'), exact('#message', bookingError), count('#reservations li', 1), fill('#date', '2025-12-31'), click('#reserve'), exact('#message', bookingError), count('#reservations li', 1), exact('#reservations li', '2026-10-07 09:00–10:00')]),
      check('空值和非法时段拒绝', [...book('2026-10-07', '09:00–10:00', 1), fill('#date', ''), click('#reserve'), exact('#message', bookingError), count('#reservations li', 1), fill('#date', '2026-10-08'), fill('#slot', '11:00–12:00'), click('#reserve'), exact('#message', bookingError), count('#reservations li', 1), exact('#reservations li', '2026-10-07 09:00–10:00')]),
    ],
  },
  {
    id: 'H06', goal: '提供离线商品目录分类筛选，切换分类和恢复全部时不丢失原商品。',
    acceptance: '初始按固定顺序显示四项：晨光笔记本/文具、海盐饼干/食品、轻便铅笔/文具、宠物冻干/宠物，数量显示4。文具筛选显示两项笔记本/铅笔（顺序保持）、食品显示饼干一项、宠物显示冻干一项。任何筛选后点全部恢复原四项及顺序；重复和来回切换不破坏原目录，无重复项或残留项，数量精确等于当前元素数。',
    candidates: [
      { id: 'cand-e5d2', value: { html: document('商品分类目录', catalogContent, catalogScript('render(category===null?items:items.filter(item=>item.category===category));')) } },
      { id: 'cand-19f4', value: { html: document('商品分类目录', catalogContent, catalogScript('if(category!==null)items=items.filter(item=>item.category===category);render(items);')) } },
    ],
    checks: [
      check('初始完整目录精确数量和顺序', [...catalog(allNames), exact('#catalog .item:nth-child(1) .category', '文具'), exact('#catalog .item:nth-child(2) .category', '食品'), exact('#catalog .item:nth-child(3) .category', '文具'), exact('#catalog .item:nth-child(4) .category', '宠物')]),
      check('文具筛选精确两项且无残留', [click('#filter-stationery'), ...catalog(['晨光笔记本', '轻便铅笔']), exact('#catalog .item:nth-child(1) .category', '文具'), exact('#catalog .item:nth-child(2) .category', '文具')]),
      check('食品和宠物分别精确一项', [click('#filter-food'), ...catalog(['海盐饼干']), click('#filter-all'), click('#filter-pet'), ...catalog(['宠物冻干'])]),
      check('筛选后恢复完整原目录', [click('#filter-stationery'), ...catalog(['晨光笔记本', '轻便铅笔']), click('#filter-all'), ...catalog(allNames)]),
      check('分类A到B再恢复全部不丢失商品', [click('#filter-stationery'), ...catalog(['晨光笔记本', '轻便铅笔']), click('#filter-food'), ...catalog(['海盐饼干']), click('#filter-all'), ...catalog(allNames)]),
      check('重复筛选与多次恢复不复制商品', [click('#filter-food'), click('#filter-food'), ...catalog(['海盐饼干']), click('#filter-all'), click('#filter-all'), ...catalog(allNames)]),
    ],
  },
]);

/** Control-plane construction labels. Never serialize this into model requests. */
export const VERIFIER_HTML_A_EXPECTATIONS = immutable([
  { poolId: 'H01' as const, candidateId: 'cand-f15c', expectedPass: true, defect: null },
  { poolId: 'H01' as const, candidateId: 'cand-62d8', expectedPass: false, defect: '数量验证接受0与6，改变库存或新增越界记录。' },
  { poolId: 'H02' as const, candidateId: 'cand-7ab2', expectedPass: false, defect: '只有原总额严格大于100才折扣，恰好100不满足全单九折。' },
  { poolId: 'H02' as const, candidateId: 'cand-d90e', expectedPass: false, defect: '按单件价格决定阈值，60×2与10×10没有按整单优惠。' },
  { poolId: 'H03' as const, candidateId: 'cand-3e91', expectedPass: false, defect: '先把单价舍入至分再乘数量，批量金额不符合统一舍入。' },
  { poolId: 'H03' as const, candidateId: 'cand-80c4', expectedPass: true, defect: null },
  { poolId: 'H04' as const, candidateId: 'cand-49fe', expectedPass: true, defect: null },
  { poolId: 'H04' as const, candidateId: 'cand-ac26', expectedPass: true, defect: null },
  { poolId: 'H05' as const, candidateId: 'cand-6b07', expectedPass: false, defect: '未检测重复的日期时段，会新增重复预约。' },
  { poolId: 'H05' as const, candidateId: 'cand-c8a3', expectedPass: false, defect: '按全局时段检测冲突，不同日期的同一时段被误拒绝。' },
  { poolId: 'H06' as const, candidateId: 'cand-e5d2', expectedPass: true, defect: null },
  { poolId: 'H06' as const, candidateId: 'cand-19f4', expectedPass: false, defect: '筛选替换原数组，之后恢复全部或切换分类丢失商品。' },
]);

/** Whitelist of legitimate review facts; excludes labels and preparation results. */
export function verifierHtmlAReviewSnapshot(poolId: VerifierHtmlAPoolId, frozen: { version: string; hash: string }) {
  const pool = VERIFIER_HTML_A_CORPUS.find(item => item.id === poolId);
  if (!pool || !/^[a-f0-9]{64}$/.test(frozen.hash) || !/^[a-z0-9-]{1,100}$/.test(frozen.version)) throw new Error('Invalid HTML pool or frozen contract reference');
  return immutable({
    phase: 'implement', capability: 'offline-single-html' as const, goal: pool.goal, acceptance: pool.acceptance, frozenHash: frozen.hash,
    candidates: pool.candidates.map(candidate => ({ id: candidate.id, value: { html: candidate.value.html } })),
    reviewContext: {
      contextSource: 'Hand-authored challenge fixture, not prior autonomous role execution',
      product: { goal: pool.goal, scope: 'offline-single-html', acceptance: [pool.acceptance], exclusions: ['No backend, host execution, external requests or camera'] },
      research: { observations: ['Use the supplied exact input ranges, business rules and state transitions.'], constraints: ['Complete inline offline HTML; frozen business checks are shared by both candidates.'], unknowns: ['deferred: formal model decisions have not been measured for this challenge pool'] },
      plan: { decision: 'proceed', summary: 'Implement the supplied business requirements inside the controlled offline capability.', tasks: [{ id: 'implementation', owner: 'developer', description: pool.goal }, { id: 'validation', owner: 'tester', description: 'Execute the same frozen business checks against each candidate.' }], risks: [] },
      frozenContract: { version: frozen.version, hash: frozen.hash, checks: structuredClone(pool.checks) },
      knownPlatform: { capability: 'offline-single-html', output: 'Complete inline HTML5; no external resources', execution: 'Short-lived request-denying Chromium; no generated host Node/shell execution', verificationBoundary: 'Independent frozen behavior Gate still required' },
      coverageContract: productionCoverageContract('offline-single-html'), feedback: null, cycle: 0,
    },
  });
}
