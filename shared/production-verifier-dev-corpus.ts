import { productionCoverageContract } from './production-coverage.js';

/** Hand-authored tuning fixtures. Never used by the production task router. */
export const VERIFIER_DEV_CORPUS_VERSION = 'verifier-development-corpus-v1' as const;
export const VERIFIER_DEV_ORACLE_VERSION = 'verifier-development-oracle-v1' as const;
export type VerifierDevPoolId = 'DEV-01' | 'DEV-02' | 'DEV-03';
export type VerifierDevStep =
  | { action: 'fill'; selector: string; value: string }
  | { action: 'click'; selector: string }
  | { action: 'assertTextExact'; selector: string; text: string }
  | { action: 'assertValue'; selector: string; value: string };
export interface VerifierDevCheck { name: string; steps: VerifierDevStep[]; }
export interface VerifierDevCandidate { id: string; value: { html: string }; }
export interface VerifierDevPool {
  id: VerifierDevPoolId;
  goal: string;
  acceptance: string;
  candidates: VerifierDevCandidate[];
  checks: VerifierDevCheck[];
}

function immutable<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

const DOM = immutable({ primary: '#input-a', secondary: '#input-b', calculate: '#calculate', reset: '#reset', result: '#result', message: '#message' });
export const VERIFIER_DEV_DOM_CONTRACT = DOM;
const fill = (value: string, selector = DOM.primary): VerifierDevStep => ({ action: 'fill', selector, value });
const click = (selector = DOM.calculate): VerifierDevStep => ({ action: 'click', selector });
const exact = (text: string, selector = DOM.result): VerifierDevStep => ({ action: 'assertTextExact', selector, text });
const check = (name: string, steps: VerifierDevStep[]): VerifierDevCheck => ({ name, steps });
const one = (value: string, expected: string): VerifierDevStep[] => [fill(value), click(), exact(expected)];
const pair = (start: string, end: string, expected: string): VerifierDevStep[] => [fill(start), fill(end, DOM.secondary), click(), exact(expected)];
const invalidOne = (value: string, message: string, previous: string): VerifierDevStep[] => [fill(value), click(), exact(message, DOM.message), exact(previous)];
const invalidPair = (start: string, end: string, message: string, previous: string): VerifierDevStep[] => [fill(start), fill(end, DOM.secondary), click(), exact(message, DOM.message), exact(previous)];
const resetSteps: VerifierDevStep[] = [click(DOM.reset), { action: 'assertValue', selector: DOM.primary, value: '' }, { action: 'assertValue', selector: DOM.secondary, value: '' }, exact(''), exact('', DOM.message)];

/** Fixed trusted fixture source, not eval/model output or a generic HTML API. */
function document(title: string, firstLabel: string, secondLabel: string | null, calculation: string): string {
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{margin:0;padding:24px;background:#f8fafc;color:#1e293b;font:16px system-ui,sans-serif}main{max-width:480px;margin:auto;padding:24px;background:white;border:1px solid #cbd5e1;border-radius:12px}label{display:block;margin:16px 0 6px}input,button{box-sizing:border-box;min-height:44px;font:inherit}input{width:100%;padding:8px;border:1px solid #64748b;border-radius:6px}button{padding:8px 16px;margin:16px 8px 0 0;color:white;background:#1d4ed8;border:0;border-radius:6px}button:focus-visible,input:focus-visible{outline:3px solid #f97316;outline-offset:3px}#result{display:block;min-height:24px;margin-top:20px}#message{min-height:24px;color:#b91c1c}</style></head>
<body><main id="app"><h1>${title}</h1><label for="input-a">${firstLabel}</label><input id="input-a" type="text" inputmode="decimal" autocomplete="off"><div${secondLabel === null ? ' hidden' : ''}><label for="input-b">${secondLabel ?? '第二个输入'}</label><input id="input-b" type="text" inputmode="decimal" autocomplete="off"></div><button id="calculate" type="button">计算</button><button id="reset" type="button">重置</button><output id="result" aria-live="polite"></output><p id="message" role="status"></p></main>
<script>'use strict';
const a=document.getElementById('input-a'),b=document.getElementById('input-b'),result=document.getElementById('result'),message=document.getElementById('message');
document.getElementById('calculate').addEventListener('click',()=>{message.textContent='';${calculation}});
document.getElementById('reset').addEventListener('click',()=>{a.value='';b.value='';result.textContent='';message.textContent='';});
</script></body></html>`;
}

const minuteError = '请输入 0–1439 的整数';
const minuteCalculation = (rounding: 'floor' | 'ceil') => String.raw`if(!/^\d+$/.test(a.value)){message.textContent='${minuteError}';return;}const n=Number(a.value);if(!Number.isSafeInteger(n)||n<0||n>1439){message.textContent='${minuteError}';return;}result.textContent=String(Math.${rounding}(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');`;
const rangeError = '请输入 -50–50 的整数且起点不大于终点';
const rangeCalculation = (loop: string) => String.raw`if(!/^-?\d+$/.test(a.value)||!/^-?\d+$/.test(b.value)){message.textContent='${rangeError}';return;}const lo=Number(a.value),hi=Number(b.value);if(!Number.isSafeInteger(lo)||!Number.isSafeInteger(hi)||lo< -50||hi>50||lo>hi){message.textContent='${rangeError}';return;}let total=0;${loop}result.textContent=String(total);`;
const digitError = '请输入 0–9999 的整数';
const digitCalculation = (calculation: string) => String.raw`if(!/^\d+$/.test(a.value)){message.textContent='${digitError}';return;}const n=Number(a.value);if(!Number.isSafeInteger(n)||n<0||n>9999){message.textContent='${digitError}';return;}${calculation}`;

export const VERIFIER_DEV_CORPUS: VerifierDevPool[] = immutable([
  {
    id: 'DEV-01', goal: '把当天经过的整数分钟转换为两位小时与两位分钟的 HH:MM。',
    acceptance: '只接受 0–1439 的十进制整数分钟。0→00:00、59→00:59、60→01:00、65→01:05、1439→23:59。空值、非数字、小数和越界必须显示输入错误且保留上次结果。再次计算必须由当前输入重算；重置清空输入、结果及错误。',
    candidates: [
      { id: 'cand-41a9', value: { html: document('分钟转换', '当天经过的分钟', null, minuteCalculation('ceil')) } },
      { id: 'cand-8c52', value: { html: document('分钟转换', '当天经过的分钟', null, minuteCalculation('floor')) } },
    ],
    checks: [
      check('零分钟转换', one('0', '00:00')),
      check('小时前边界转换', one('59', '00:59')),
      check('整小时边界转换', one('60', '01:00')),
      check('小时后边界与当前输入重算', [...one('60', '01:00'), ...one('65', '01:05')]),
      check('当天最后一分钟转换', one('1439', '23:59')),
      check('分钟越界拒绝且保留结果', [...one('60', '01:00'), ...invalidOne('-1', minuteError, '01:00'), ...invalidOne('1440', minuteError, '01:00')]),
      check('非整数输入拒绝且保留结果', [...one('60', '01:00'), ...invalidOne('1.5', minuteError, '01:00'), ...invalidOne('', minuteError, '01:00'), ...invalidOne('abc', minuteError, '01:00')]),
      check('分钟重置清空全部状态', [...one('60', '01:00'), ...invalidOne('-1', minuteError, '01:00'), ...resetSteps]),
    ],
  },
  {
    id: 'DEV-02', goal: '计算含起点和终点的整数闭区间之和。',
    acceptance: '起点、终点为 -50–50 的十进制整数且起点≤终点。包括两个端点：7..7→7、2..4→9、-2..3→3、-2..2→0。空值、非数字、小数、越界或倒置区间必须显示输入错误且保留上次结果。再次计算由当前输入重算；重置清空两个输入、结果及错误。',
    candidates: [
      { id: 'cand-23f6', value: { html: document('闭区间求和', '起点', '终点', rangeCalculation('for(let i=lo;i<hi;i++)total+=i;')) } },
      { id: 'cand-b704', value: { html: document('闭区间求和', '起点', '终点', rangeCalculation('for(let i=lo+1;i<=hi;i++)total+=i;')) } },
    ],
    checks: [
      check('单点闭区间包含端点', pair('7', '7', '7')),
      check('正数闭区间包括两端点', pair('2', '4', '9')),
      check('非对称跨零区间包括两端点', pair('-2', '3', '3')),
      check('对称跨零区间精确为零', pair('-2', '2', '0')),
      check('倒置和越界拒绝且保留结果', [...pair('0', '0', '0'), ...invalidPair('4', '2', rangeError, '0'), ...invalidPair('-51', '4', rangeError, '0'), ...invalidPair('2', '51', rangeError, '0')]),
      check('非整数区间拒绝且保留结果', [...pair('0', '0', '0'), ...invalidPair('1.5', '4', rangeError, '0'), ...invalidPair('', '4', rangeError, '0'), ...invalidPair('2', 'abc', rangeError, '0')]),
      check('区间重置清空全部状态', [...pair('0', '0', '0'), ...invalidPair('4', '2', rangeError, '0'), ...resetSteps]),
    ],
  },
  {
    id: 'DEV-03', goal: '计算非负整数的十进制各位数字之和。',
    acceptance: '只接受 0–9999 的十进制整数。0→0、909→18、1000→1、9999→36。空值、非数字、小数和越界必须显示输入错误且保留上次结果。再次计算必须重算而不是累加旧结果；重置清空输入、结果及错误。允许等义实现，不按代码风格判断质量。',
    candidates: [
      { id: 'cand-6d18', value: { html: document('数字求和', '非负整数', null, digitCalculation("result.textContent=String(String(n).split('').reduce((sum,digit)=>sum+Number(digit),0));")) } },
      { id: 'cand-95e3', value: { html: document('数字求和', '非负整数', null, digitCalculation('let remaining=n,total=0;while(remaining>0){total+=remaining%10;remaining=Math.floor(remaining/10);}result.textContent=String(total);')) } },
    ],
    checks: [
      check('零和含零数字与当前输入重算', [...one('0', '0'), ...one('909', '18'), ...one('1000', '1'), ...one('9999', '36')]),
      check('数字越界拒绝且保留结果', [...one('909', '18'), ...invalidOne('-1', digitError, '18'), ...invalidOne('10000', digitError, '18')]),
      check('数字非整数拒绝且保留结果', [...one('909', '18'), ...invalidOne('1.5', digitError, '18'), ...invalidOne('', digitError, '18'), ...invalidOne('abc', digitError, '18')]),
      check('数字重置清空全部状态', [...one('909', '18'), ...invalidOne('-1', digitError, '18'), ...resetSteps]),
    ],
  },
]);

/** Control-plane labels/defects: NEVER include this export in a model request. */
export const VERIFIER_DEV_EXPECTATIONS = immutable([
  { poolId: 'DEV-01' as const, candidateId: 'cand-41a9', expectedPass: false, defect: '向上取整小时，59/65/1439 分钟产生错误小时。' },
  { poolId: 'DEV-01' as const, candidateId: 'cand-8c52', expectedPass: true, defect: null },
  { poolId: 'DEV-02' as const, candidateId: 'cand-23f6', expectedPass: false, defect: '遗漏上端点。' },
  { poolId: 'DEV-02' as const, candidateId: 'cand-b704', expectedPass: false, defect: '遗漏下端点。' },
  { poolId: 'DEV-03' as const, candidateId: 'cand-6d18', expectedPass: true, defect: null },
  { poolId: 'DEV-03' as const, candidateId: 'cand-95e3', expectedPass: true, defect: null },
]);

/** Whitelisted blind review snapshot: no gold/defect/Oracle results or opinions. */
export function verifierDevReviewSnapshot(poolId: VerifierDevPoolId, frozen: { version: string; hash: string }) {
  const pool = VERIFIER_DEV_CORPUS.find(item => item.id === poolId);
  if (!pool || !/^[a-f0-9]{64}$/.test(frozen.hash) || !/^[a-z0-9-]{1,100}$/.test(frozen.version)) throw new Error('Invalid development pool or frozen contract reference');
  return immutable({
    phase: 'implement', capability: 'offline-single-html' as const, goal: pool.goal, acceptance: pool.acceptance, frozenHash: frozen.hash,
    candidates: pool.candidates.map(candidate => ({ id: candidate.id, value: { html: candidate.value.html } })),
    reviewContext: {
      contextSource: 'Hand-authored development fixture, not prior autonomous role execution',
      product: { goal: pool.goal, scope: 'offline-single-html', acceptance: [pool.acceptance], exclusions: ['No backend, host execution, external requests or camera'] },
      research: { observations: ['Apply the supplied exact integer range and result requirements.'], constraints: ['Complete inline offline HTML; keep frozen business checks immutable.'], unknowns: ['deferred: real model decisions have not been measured for this development pool'] },
      plan: { decision: 'proceed', summary: 'Implement all supplied behavior checks within the controlled offline capability.', tasks: [{ id: 'implementation', owner: 'developer', description: pool.goal }, { id: 'validation', owner: 'tester', description: 'Execute the same frozen business checks against each candidate.' }], risks: [] },
      frozenContract: { version: frozen.version, hash: frozen.hash, checks: structuredClone(pool.checks) },
      knownPlatform: { capability: 'offline-single-html', output: 'Complete inline HTML5; no external resources', execution: 'Short-lived request-denying Chromium; no generated host Node/shell execution', verificationBoundary: 'Independent frozen behavior Gate still required' },
      coverageContract: productionCoverageContract('offline-single-html'), feedback: null, cycle: 0,
    },
  });
}
