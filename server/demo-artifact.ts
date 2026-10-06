import type { SurveyResult } from './city.js';
import type { AcceptanceCheck } from './gate.js';
import type { ResearchCaseReport } from './research-cases.js';

export const DEMO_ACCEPTANCE: AcceptanceCheck[] = [
  {
    name: '展示人口数据、模拟边界与来源',
    steps: [
      { action: 'assertVisible', selector: 'h1' },
      { action: 'assertText', selector: '#population', text: '503,859' },
      { action: 'assertText', selector: '#disclaimer', text: '模拟' },
      { action: 'assertVisible', selector: '#sources' },
    ],
  },
  {
    name: '修改价格后重新计算接受度',
    steps: [
      { action: 'fill', selector: '#price', value: '0' },
      { action: 'click', selector: '#simulate' },
      { action: 'fill', selector: '#price', value: '999' },
      { action: 'assertChanged', selector: '#acceptance', after: { action: 'click', selector: '#simulate' } },
      { action: 'assertValue', selector: '#price', value: '999' },
    ],
  },
];

export const DEMO_CASE_ACCEPTANCE: AcceptanceCheck[] = [
  { name: '场景展示数据不足、样本不匹配及来源', steps: [
    { action: 'assertVisible', selector: 'h1' },
    { action: 'assertText', selector: '#decision-status', text: 'needs-data' },
    { action: 'assertText', selector: '#frame-fit', text: '不适用' },
    { action: 'assertText', selector: '#disclaimer', text: '模拟' },
    { action: 'assertVisible', selector: '#facts' },
    { action: 'assertVisible', selector: '#sources' },
  ] },
  { name: '切换条件假设会改变方案，保留数据不足状态', steps: [
    { action: 'assertChanged', selector: '#scenario-summary', after: { action: 'click', selector: '#next-hypothesis' } },
    { action: 'assertText', selector: '#decision-status', text: 'needs-data' },
  ] },
  { name: '补采计划选择改变但不冒充数据采集完成', steps: [
    { action: 'assertText', selector: '#gap-status', text: '已加入补采计划 0 项' },
    { action: 'assertChanged', selector: '#gap-status', after: { action: 'click', selector: '#gap-plan-0' } },
    { action: 'assertText', selector: '#gap-status', text: '已加入补采计划 1 项' },
    { action: 'assertText', selector: '#decision-status', text: 'needs-data' },
  ] },
];

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
}

function escapeJson(value: unknown) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** Offline review artifact for demo mode, explicitly a template rather than LLM-authored code. */
export function buildDemoHtml(survey: SurveyResult, task: string): string {
  const data = escapeJson({ survey, task });
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(survey.product)} · 滨江商品调研预演</title>
<style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#263b35;background:#f5f4ef;font-synthesis:none}*{box-sizing:border-box}body{margin:0}button,input{font:inherit}a{color:#1d6650;text-underline-offset:3px}button,a,input{touch-action:manipulation}:focus-visible{outline:3px solid #cb8737;outline-offset:4px}header,main,footer{width:min(1080px,calc(100% - 48px));margin:auto}header{padding:28px 0 22px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #dce1d8;gap:20px}.brand{font-weight:750;letter-spacing:.03em}.brand span{color:#4a7a63}.tag{border:1px solid #c9d9ca;background:#eef3eb;padding:6px 11px;border-radius:20px;font-size:12px;white-space:nowrap}main{padding:42px 0}.eyebrow{font-size:12px;letter-spacing:.12em;font-weight:650;color:#688374;margin:0 0 12px}h1{font-size:clamp(25px,4vw,40px);line-height:1.25;margin:0 0 14px;overflow-wrap:anywhere}h2{font-size:18px;margin:0 0 18px}p{line-height:1.75}.lead{color:#69766d;max-width:720px;margin:0}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:30px 0}.stat,.panel{background:#fff;border:1px solid #dde3d9;border-radius:14px}.stat{padding:21px 24px}.label{font-size:12px;color:#65776c;display:block;margin-bottom:8px}.value{font-size:28px;font-variant-numeric:tabular-nums;font-weight:650}.hint{font-size:12px;color:#778478;margin:8px 0 0}.workspace{display:grid;grid-template-columns:1fr 1.15fr;gap:22px}.panel{padding:25px}.panel p{color:#6a786e;font-size:13px}.price-row{display:flex;gap:10px;align-items:end;margin:20px 0 24px}.price-row label{flex:1;font-size:13px}input{display:block;width:100%;padding:12px 14px;margin-top:8px;border:1px solid #bac9bd;border-radius:8px;background:#fcfdf9;color:#203d2f}button{border:0;border-radius:8px;padding:13px 18px;background:#245a43;color:#fff;cursor:pointer;white-space:nowrap}button:hover{background:#174731}.result{background:#edf4ec;border-radius:10px;padding:20px}.result .value{font-size:46px;color:#245a43}.result .hint{line-height:1.6}.error{min-height:18px;color:#a34837;font-size:12px;margin-top:-13px}.street-row{padding:16px 0;border-bottom:1px solid #e9ede5}.street-row:last-child{border-bottom:0}.street-top{display:flex;justify-content:space-between;gap:12px;font-size:14px}.street-percent{font-weight:650;font-variant-numeric:tabular-nums}.track{height:8px;border-radius:8px;background:#edf0e9;margin:12px 0 9px;overflow:hidden}.bar{height:100%;background:#648d69;border-radius:8px;min-width:0}.caption{font-size:11px;color:#788475}.note{background:#f8f0df;border:1px solid #ecdfc1;border-radius:10px;padding:16px 19px;margin:25px 0;color:#776037;font-size:13px;line-height:1.8}.provenance{display:grid;grid-template-columns:repeat(3,1fr);gap:15px;margin:20px 0}.source-kind{font-size:12px;font-weight:700}.fact{color:#306c4e}.infer{color:#8b6a2f}.generated{color:#6c6890}.provenance p{font-size:12px;margin:7px 0 0;color:#6f7b71;line-height:1.75}details{border-top:1px solid #e0e5dc;margin-top:22px;padding-top:17px}summary{font-size:13px;cursor:pointer;color:#48644f}details p,details li{font-size:12px;color:#728072;line-height:1.9}ul{padding-left:20px}#task{white-space:pre-wrap;overflow-wrap:anywhere}.source-list{display:flex;flex-direction:column;gap:8px;font-size:12px}.source-list a{overflow-wrap:anywhere}footer{border-top:1px solid #dce1d8;padding:22px 0 30px;font-size:11px;color:#7a857b;display:flex;justify-content:space-between;gap:16px}@media(max-width:700px){header,main,footer{width:calc(100% - 28px)}header{padding:20px 0}.tag{font-size:10px}.workspace{grid-template-columns:1fr}.stats{gap:8px}.stat{padding:14px 10px}.stat .value{font-size:20px}.stat .hint{font-size:10px}.provenance{grid-template-columns:1fr}.panel{padding:20px}main{padding-top:30px}.price-row{flex-wrap:wrap}footer{flex-direction:column}}
</style>
</head>
<body>
<header><div class="brand">CITY<span>AGENT</span> / 城市研究室</div><span class="tag">离线 Demo · 固定规则预演</span></header>
<main>
<p class="eyebrow">BINJIANG / CONCEPT RESEARCH</p>
<h1>${escapeHtml(survey.product)}</h1>
<p class="lead">以滨江历史人口结构为起点，比较不同报价下的模拟接受度。调整价格，观察三个街道的规则响应。</p>
<div class="stats">
<div class="stat"><span class="label">历史常住人口</span><span id="population" class="value">${survey.population.toLocaleString('en-US')}</span><p class="hint">2020 年七普 · 全年龄</p></div>
<div class="stat"><span class="label">本次调研框</span><span class="value">${survey.eligiblePopulation.toLocaleString('en-US')}</span><p class="hint">15 岁及以上 · 包含 15–17 岁</p></div>
<div class="stat"><span class="label">合成代表样本</span><span class="value">${survey.sampleSize.toLocaleString('en-US')}</span><p class="hint">12 个推断层 · seed ${survey.seed}</p></div>
</div>
<div class="workspace">
<section class="panel" aria-labelledby="scenario-title"><h2 id="scenario-title">比较一个报价</h2><p>同一批合成样本、同一组生成偏好。报价改变时，仅重新计算预设价格函数。</p>
<div id="price-form"><div class="price-row"><label for="price">商品报价 / 元<input id="price" name="price" type="number" min="0" max="100000" step="any" value="${survey.price}" required></label><button type="button" id="simulate">重新模拟</button></div><div id="error" class="error" role="alert"></div></div>
<div class="result" aria-live="polite" aria-atomic="true"><span class="label">规则预期接受度</span><span id="acceptance" class="value">—</span><p id="offer-caption" class="hint"></p></div>
<p class="hint">此处为加权接受概率的期望值；原始模拟作答的一次接受率见方法说明，两者含义不同。</p>
</section>
<section class="panel" aria-labelledby="street-title"><h2 id="street-title">按街道查看</h2><p>人口权重来自历史统计与联合分布假设。每个组采用相同偏好分布。</p><div id="streets"></div></section>
</div>
<div class="note" id="disclaimer" role="note">模拟结果仅用于问卷预演与假设讨论，不是市场数据、真人调查或购买预测。当前为固定模板 Demo，页面与受访者回答均不代表 LLM 自主开发或作答的证据。</div>
<section class="panel"><h2>每个数字来自哪里</h2>
<div class="provenance"><div><span class="source-kind fact">fact / 公开事实</span><p>2020 年街道常住人口、街道与年龄分布、街道与性别分布。</p></div><div><span class="source-kind infer">infer / 统计推断</span><p>街道内年龄与性别独立的假设，以及合成样本对应的联合人口层。</p></div><div><span class="source-kind generated">generated / 规则生成</span><p>兴趣、预算、回答和价格接受概率。模型未校准真实商品偏好。</p></div></div>
<div class="source-list" id="sources"></div>
<details><summary>方法、边界与原始任务</summary><p id="method"></p><ul id="limitations"></ul><p id="task"></p></details>
</section>
</main><footer><span>City Agent / Binjiang research fixture · v1</span><span>本文件可离线打开 · 数据不会提交到任何服务</span></footer>
<script type="application/json" id="app-data">${data}</script>
<script>
(() => {
  'use strict';
  const {survey, task} = JSON.parse(document.getElementById('app-data').textContent);
  const formatNumber = (value) => new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 0}).format(value);
  const percent = (value) => (value * 100).toFixed(1) + '%';
  const probability = (row, price) => row.interestScore / (1 + Math.exp(Math.min(700, (price - row.willingnessToPay) / 15)));
  const aggregate = (rows, price) => {
    const weight = rows.reduce((sum, row) => sum + row.weight, 0);
    return rows.reduce((sum, row) => sum + probability(row, price) * row.weight, 0) / weight;
  };
  const streetNodes = survey.byStreet.map((street) => {
    const root = document.createElement('div'); root.className = 'street-row';
    const top = document.createElement('div'); top.className = 'street-top';
    const title = document.createElement('span'); title.textContent = street.name;
    const value = document.createElement('span'); value.className = 'street-percent';
    top.append(title, value);
    const track = document.createElement('div'); track.className = 'track'; track.setAttribute('aria-hidden', 'true');
    const bar = document.createElement('div'); bar.className = 'bar'; track.append(bar);
    const caption = document.createElement('div'); caption.className = 'caption';
    caption.textContent = '15+ 调研框 ' + formatNumber(street.population) + ' 人 · 合成样本 ' + street.sampleSize + ' 个';
    root.append(top, track, caption); document.getElementById('streets').append(root);
    return {id: street.id, value, bar};
  });
  function calculate() {
    const raw = document.getElementById('price').value;
    const price = Number(raw);
    if (!raw.trim() || !Number.isFinite(price) || price < 0 || price > 100000) {
      document.getElementById('error').textContent = '请输入 0–100000 之间的有效报价。'; return;
    }
    document.getElementById('error').textContent = '';
    document.getElementById('acceptance').textContent = percent(aggregate(survey.responses, price));
    document.getElementById('offer-caption').textContent = '报价 ¥' + price + ' · 加权合成样本的预期比例，非真人购买率';
    for (const node of streetNodes) {
      const rate = aggregate(survey.responses.filter((row) => row.streetId === node.id), price);
      node.value.textContent = percent(rate); node.bar.style.width = (rate * 100) + '%';
    }
  }
  document.getElementById('simulate').addEventListener('click', calculate);
  document.getElementById('price').addEventListener('keydown', (event) => {if(event.key === 'Enter') {event.preventDefault(); calculate();}});
  for (const source of survey.sources) {
    const line = document.createElement('div');
    const a = document.createElement('a');
    const url = new URL(source.url);
    if (url.protocol === 'https:' || url.protocol === 'http:') a.href = source.url;
    a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = source.title + ' · ' + source.locator; line.append(a);
    document.getElementById('sources').append(line);
  }
  for (const text of survey.disclaimers) {const li = document.createElement('li'); li.textContent = text; document.getElementById('limitations').append(li);}
  document.getElementById('method').textContent = '模板版本 ' + survey.modelVersion + '。接受概率 = 兴趣 / (1 + exp((价格 − 生成预算) / 15))；按各样本的人口权重求平均。价格单调性由公式决定，不能证明真实市场弹性。原始报价 ¥' + survey.price + ' 的一次随机模拟作答接受率为 ' + percent(survey.summary.acceptanceRate) + '。产品名称只作标签，当前不分析商品语义。';
  document.getElementById('task').textContent = '原始任务：' + task;
  calculate();
})();
</script>
</body></html>`;
}

/** Case-specific mock. No generic survey responses or acceptance metrics enter this document. */
export function buildCaseHtml(report: ResearchCaseReport): string {
  if (report.kind === 'generic') throw new Error('专用研究模板需要学校或宠物场景。');
  const factItems = report.facts.map(fact => `<li><strong>${escapeHtml(fact.claim)}${fact.value === undefined ? '' : `：${fact.value.toLocaleString('en-US')} ${escapeHtml(fact.unit ?? '')}`}</strong><p>${escapeHtml(fact.period)} · fact · ${escapeHtml(fact.sourceIds.join(' / '))}</p><p>${escapeHtml(fact.useLimit)}</p></li>`).join('');
  const gapItems = report.dataGaps.map((gap, index) => `<li><label><input id="gap-plan-${index}" type="checkbox" data-gap="${escapeHtml(gap.id)}">将“${escapeHtml(gap.title)}”加入补采计划</label><p>${escapeHtml(gap.requiredFor)}</p><p>最小字段：${escapeHtml(gap.expectedFields.join('、'))}</p><p>建议来源：${escapeHtml(gap.suggestedSources.join('；'))}</p></li>`).join('');
  const sources = report.sources.map(source => {
    let url = '';
    try { const parsed = new URL(source.url); if (['http:', 'https:'].includes(parsed.protocol)) url = parsed.href; } catch { /* Invalid source links remain plain text. */ }
    const title = `${source.title} · ${source.locator}`;
    return `<li>${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title)}<p>${escapeHtml(source.id)} · ${escapeHtml(source.publisher)} · ${escapeHtml(source.period)}</p></li>`;
  }).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.title)}</title>
<style>
:root{font-family:system-ui,-apple-system,"PingFang SC",sans-serif;background:#f5f4ef;color:#203b31}*{box-sizing:border-box}body{margin:0}main,header,footer{width:min(1120px,calc(100% - 36px));margin:auto}header{padding:25px 0;border-bottom:1px solid #d3ddd4;display:flex;justify-content:space-between;gap:16px}main{padding:34px 0}h1{font-size:clamp(25px,4vw,38px);margin:10px 0 16px}h2{font-size:19px;margin:0 0 16px}h3{font-size:16px}p,li{line-height:1.7}p{margin:7px 0;color:#506c5e}a{color:#276845;overflow-wrap:anywhere}button,input{font:inherit;touch-action:manipulation}:focus-visible{outline:3px solid #bd7b25;outline-offset:4px}button{border:0;border-radius:8px;padding:12px 18px;background:#245a43;color:white;cursor:pointer}label{cursor:pointer;font-weight:600}input{margin:0 10px 0 0;width:18px;height:18px;vertical-align:middle}.tag{font-size:12px;color:#64796b}.status{padding:18px 22px;border:1px solid #e4caa0;background:#fff4df;border-radius:12px;margin:22px 0}.status strong{display:block;font-size:18px;color:#805826}.grid{display:grid;grid-template-columns:1fr 1.1fr;gap:20px;align-items:start}.panel{padding:25px;border:1px solid #dce3d9;border-radius:14px;background:#fff;margin-bottom:20px}.panel li{padding:12px 0;border-bottom:1px solid #e5ebe3;overflow-wrap:anywhere}.panel li:last-child{border-bottom:0}ul,ol{padding-left:22px}.subtle{font-size:12px;color:#6e8074}.mock{padding:10px 15px;background:#eef1fa;color:#565b80;border-radius:8px;font-size:13px}.hypothesis{background:#f1f6ee;border-radius:10px;padding:18px;margin:17px 0}.hypothesis p{font-size:14px}#gap-status{padding:13px;background:#edf2ed;border-radius:8px}.task{white-space:pre-wrap;overflow-wrap:anywhere}footer{padding:22px 0 30px;border-top:1px solid #d3ddd4;font-size:12px;color:#6e8074}@media(max-width:760px){.grid{grid-template-columns:1fr}.panel{padding:20px}header{flex-direction:column;gap:8px}}
</style></head><body>
<header><strong>CITY AGENT / 条件研究室</strong><span class="tag">四角色 mock · 离线交互交付</span></header>
<main><p class="tag">EVIDENCE → GAPS → CONDITIONAL EXPERIMENTS</p><h1>${escapeHtml(report.title)}</h1>
<p class="task">${escapeHtml(report.task)}</p>
<div class="status"><strong id="decision-status">needs-data · 商业决策仍待补采</strong><p id="frame-fit">${escapeHtml(report.frameFit.reason)}</p><p>目标人群：${escapeHtml(report.frameFit.targetPopulation)}</p></div>
<p class="mock" id="disclaimer">模拟方案用于检查研究流程和比较条件假设，不是真人调查或已验证市场结论。此页不使用不匹配样本的生成接受率。页面验收通过不代表商业研究完成。</p>
<div class="grid"><div>
<section class="panel"><h2>可追溯的人口背景</h2><ul id="facts">${factItems}</ul></section>
<section class="panel"><h2>完成补采后怎么决策</h2><ol>${report.conditionalNextSteps.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ol></section>
</div><div>
<section class="panel"><h2>比较一个待验证假设</h2><p class="subtle">以下方案均为 generated / mock-only；没有实际选址或既定价格。切换方案不会改变证据状态。</p>
<div id="scenario-summary" class="hypothesis" aria-live="polite"></div><button id="next-hypothesis" type="button">切换条件假设</button></section>
<section class="panel"><h2>组织下一轮补采</h2><p>勾选只加入计划，不表示已经采集或核验。</p><p id="gap-status" aria-live="polite">已加入补采计划 0 项；全部证据仍待核验。</p><ul>${gapItems}</ul></section>
</div></div>
<section class="panel"><h2>来源与边界</h2><ul id="sources">${sources}</ul><ul>${report.limitations.map(text => `<li>${escapeHtml(text)}</li>`).join('')}</ul></section>
</main><footer>City Agent · research-case-template-v1 · 本文件不联网，模拟不增加真实证据</footer>
<script id="case-data" type="application/json">${escapeJson(report)}</script>
<script>(()=>{'use strict';
  const report=JSON.parse(document.getElementById('case-data').textContent);let active=0;
  function show(){const hypothesis=report.hypotheses[active];const root=document.getElementById('scenario-summary');root.replaceChildren();const title=document.createElement('h3');title.textContent=hypothesis.title;root.append(title);
    for(const text of ['选址条件：'+hypothesis.locationApproach,'品类实验：'+hypothesis.assortment,'价格方法：'+hypothesis.pricingApproach,'成立前提：'+hypothesis.testConditions.join('；'),'推翻条件：'+hypothesis.falsifiedBy]){const p=document.createElement('p');p.textContent=text;root.append(p);}}
  document.getElementById('next-hypothesis').addEventListener('click',()=>{active=(active+1)%report.hypotheses.length;show();});
  for(const input of document.querySelectorAll('[data-gap]')) input.addEventListener('change',()=>{const count=document.querySelectorAll('[data-gap]:checked').length;document.getElementById('gap-status').textContent='已加入补采计划 '+count+' 项；全部证据仍待核验。';});show();
})();</script></body></html>`;
}
