import { useEffect, useState } from 'react';
import { ResearchWorkspace } from './ResearchWorkspace';
import { pagesPopulation } from './pages-api';

type View = 'research' | 'residents' | 'city' | 'submission';
const readView = (): View => ['research', 'residents', 'city', 'submission'].includes(location.hash.slice(1)) ? location.hash.slice(1) as View : 'research';
const names: Record<View, string> = { research: '虚拟社会调查', residents: '人群 Agent 预设', city: '人口来源与方法', submission: '申报材料与演示' };
const publicReviewBase = 'https://litianyi-007.github.io/city-agent/submission-next/';
export function PagesApp() {
  const [view, setView] = useState<View>(readView); const [dirty, setDirty] = useState(false); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const change = () => {
      const next = readView();
      if (busy && next !== view) { history.replaceState(null, '', `#${view}`); return; }
      if (['research', 'residents'].includes(view) && !['research', 'residents'].includes(next) && dirty && !confirm('调查或预设有未保存修改，是否离开？')) { history.replaceState(null, '', `#${view}`); return; }
      setView(next);
    };
    addEventListener('hashchange', change); return () => removeEventListener('hashchange', change);
  }, [view, dirty, busy]);
  return <div className="app-shell pages-shell"><aside className="sidebar"><a className="brand" href="#research"><span className="brand-mark">c<span>·</span>a</span><span>city agent<small>VIRTUAL SOCIETY</small></span></a><div className="nav-caption">公开体验</div><nav aria-label="主导航">{(Object.keys(names) as View[]).map((value, index) => <a key={value} className={`nav-item ${value === view ? 'selected' : ''}`} href={`#${value}`}><span className="nav-icon">{['◎', '◈', '▥', '▤'][index]}</span>{names[value]}<span className="nav-key">0{index + 1}</span></a>)}</nav><div className="sidebar-project"><div className="tiny-label">EVIDENCE FIRST</div><strong>滨江 · 问卷仿真</strong><p>人口证据、情景画像、答卷与成本记录一起回查。</p><span className="outline-tag">API Key · 页面输入</span></div></aside>
  <main className="main-area"><header className="topbar"><div><span className="breadcrumb">CITY AGENT</span><span className="slash">/</span>{names[view]}</div><span className="local-badge">GITHUB PAGES · 浏览器体验</span></header><div className="content"><div className="page-heading"><div><div className="eyebrow">TRACEABLE SURVEY SIMULATION</div><h1>{names[view]}</h1><p>准备问卷与人群，运行合成实验，回查每一份画像、答卷和运行记录。</p></div><a className="primary" href={`${publicReviewBase}index.html`} target="_blank" rel="noreferrer">新版公开评审材料 ↗</a></div>
    {(view === 'research' || view === 'residents') && <ResearchWorkspace section={view === 'research' ? 'projects' : 'residents'} onSectionChange={section => { if (!busy) location.hash = section === 'projects' ? 'research' : 'residents'; }} onDirtyChange={setDirty} onBusyChange={setBusy} />}
    {view === 'city' && <section className="panel research-panel pages-evidence"><h2>2020 七普 · 可追溯人口框</h2><p>历史常住人口 {pagesPopulation.population.toLocaleString()} 人；15+框 {pagesPopulation.eligiblePopulation.toLocaleString()} 人，包含15–17岁。最新区级总量与历史街道结构分别记录。</p><div className="pages-metrics">{pagesPopulation.areas.map(area => <span key={area.code}>{area.name}<strong>{area.population.toLocaleString()} 人</strong></span>)}</div><h3>人群构建路径</h3><ol><li>冻结地区、时期、常住口径与统计单位。</li><li>官方原表逐格转录，保留页表行列、原件与SHA-256。</li><li>街道内年龄×性别采用明确独立性假设，生成24个逻辑单元。</li><li>从符合问卷与预设交集的单元进行覆盖抽样；细分年龄与业务资格标为假设。</li><li>逐画像独立作答，按题型校验，确定性汇总并保存失败分母。</li></ol><p>覆盖实验无总体权重，当前没有把合成偏好校准为滨江真人偏好。</p>{pagesPopulation.sources.map(source => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><br/><code>{source.sha256}</code></p>)}<a className="secondary" href={`${import.meta.env.BASE_URL}submission/sources.json`} target="_blank" rel="noreferrer">下载来源清单</a></section>}
    {view === 'submission' && <section className="panel research-panel">
      <h2>新版公开评审证据包</h2>
      <p>本轮真实 API 合成居民调查，原文与失败同册；不是真人。具体执行状态、通过率、耗时、Token 与成本以本轮报告和账本为准，不把合成答卷升级为滨江真人市场结论。</p>
      <div className="research-save-bar">
        <a className="primary" href={`${publicReviewBase}index.html`} target="_blank" rel="noreferrer">新版公开评审材料 · 非提交回执 ↗</a>
        <a className="secondary" href={`${publicReviewBase}project-materials.pdf`} target="_blank" rel="noreferrer">新版评审 PDF ↗</a>
        <a className="secondary" href={`${publicReviewBase}live-proof/report.md`} target="_blank" rel="noreferrer">本轮真实 API 调查报告 ↗</a>
        <a className="secondary" href={`${publicReviewBase}live-proof/report.json`} target="_blank" rel="noreferrer">本轮真实 API 证据 JSON ↗</a>
        <a className="secondary" href={`${publicReviewBase}manifest.json`} target="_blank" rel="noreferrer">公开证据索引 ↗</a>
      </div>
      <h3>零费用工程示例（独立留档）</h3>
      <p>五层人群构建方法与两个17/18题完整业务工程示例仍保留。工程示例始终为0次模型调用；规则夹具结果不计真实模型质量、人格效度或市场偏好。</p>
      <div className="research-save-bar"><a className="secondary" href={`${publicReviewBase}business-proof/proof-report.md`} target="_blank" rel="noreferrer">工程夹具报告 · 0次 API ↗</a><a className="secondary" href={`${publicReviewBase}demo-next.mp4`} target="_blank" rel="noreferrer">前次零费用 UI 操作录屏 ↗</a></div>
      <h3>原冻结里程碑（保留）</h3>
      <p>15题问卷、旧真实模型答卷、重复与对照实验、失败记录、Prompt、耗时和费用。无需Key即可在调查页载入旧实测快照；旧重复实验与交付失败仍按原记录展示，不被新版覆盖。当前没有真人市场校准。</p>
      <div className="research-save-bar"><a className="secondary" href={`${import.meta.env.BASE_URL}submission/index.html`}>原项目材料</a><a className="secondary" href={`${import.meta.env.BASE_URL}submission/demo.mp4`}>原演示录屏</a><a className="secondary" href={`${import.meta.env.BASE_URL}submission/live-run.json`}>旧真实问卷证据</a><a className="secondary" href={`${import.meta.env.BASE_URL}submission/evaluation-summary.json`}>原实验诊断</a></div>
      <p>公开评审发布不等于正式比赛提交，提交状态须以回执为准。浏览器新发真实请求需要自行填写Key，且供应商须支持浏览器跨域；公网调用检查结果见本轮证据。本机版提供DeepSeek Harness居民执行与四角色编排，GitHub Pages不运行本机后端或四角色自动开发。</p>
    </section>}
  </div></main></div>;
}
