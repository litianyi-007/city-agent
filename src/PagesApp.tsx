import { useEffect, useState } from 'react';
import { ResearchWorkspace } from './ResearchWorkspace';
import { pagesPopulation } from './pages-api';

type View = 'research' | 'residents' | 'city' | 'submission';
const readView = (): View => ['research', 'residents', 'city', 'submission'].includes(location.hash.slice(1)) ? location.hash.slice(1) as View : 'research';
const names: Record<View, string> = { research: '虚拟社会调查', residents: '人群 Agent 预设', city: '人口来源与方法', submission: '申报材料与演示' };
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
  <main className="main-area"><header className="topbar"><div><span className="breadcrumb">CITY AGENT</span><span className="slash">/</span>{names[view]}</div><span className="local-badge">GITHUB PAGES · 浏览器体验</span></header><div className="content"><div className="page-heading"><div><div className="eyebrow">TRACEABLE SURVEY SIMULATION</div><h1>{names[view]}</h1><p>准备问卷与人群，运行合成实验，回查每一份画像、答卷和运行记录。</p></div><a className="primary" href={`${import.meta.env.BASE_URL}submission/index.html`} target="_blank" rel="noreferrer">查看申报材料</a></div>
    {(view === 'research' || view === 'residents') && <ResearchWorkspace section={view === 'research' ? 'projects' : 'residents'} onSectionChange={section => { if (!busy) location.hash = section === 'projects' ? 'research' : 'residents'; }} onDirtyChange={setDirty} onBusyChange={setBusy} />}
    {view === 'city' && <section className="panel research-panel pages-evidence"><h2>2020 七普 · 可追溯人口框</h2><p>历史常住人口 {pagesPopulation.population.toLocaleString()} 人；15+框 {pagesPopulation.eligiblePopulation.toLocaleString()} 人，包含15–17岁。最新区级总量与历史街道结构分别记录。</p><div className="pages-metrics">{pagesPopulation.areas.map(area => <span key={area.code}>{area.name}<strong>{area.population.toLocaleString()} 人</strong></span>)}</div><h3>人群构建路径</h3><ol><li>冻结地区、时期、常住口径与统计单位。</li><li>官方原表逐格转录，保留页表行列、原件与SHA-256。</li><li>街道内年龄×性别采用明确独立性假设，生成24个逻辑单元。</li><li>从符合问卷与预设交集的单元进行覆盖抽样；细分年龄与业务资格标为假设。</li><li>逐画像独立作答，按题型校验，确定性汇总并保存失败分母。</li></ol><p>覆盖实验无总体权重，当前没有把合成偏好校准为滨江真人偏好。</p>{pagesPopulation.sources.map(source => <p key={source.id}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a><br/><code>{source.sha256}</code></p>)}<a className="secondary" href={`${import.meta.env.BASE_URL}submission/sources.json`} target="_blank" rel="noreferrer">下载来源清单</a></section>}
    {view === 'submission' && <section className="panel research-panel"><h2>申报证据包</h2><p>包含来源、人群方法、15题问卷、真实模型答卷、重复与对照实验、失败记录、Prompt、耗时和费用。</p><p>无需Key即可在调查页载入已发布实测；工程夹具与真实实验分别留档。当前没有真人市场校准。</p><div className="research-save-bar"><a className="primary" href={`${import.meta.env.BASE_URL}submission/index.html`}>打开项目材料</a><a className="secondary" href={`${import.meta.env.BASE_URL}submission/demo.mp4`}>播放演示录屏</a><a className="secondary" href={`${import.meta.env.BASE_URL}submission/live-run.json`}>真实问卷证据</a><a className="secondary" href={`${import.meta.env.BASE_URL}submission/evaluation-summary.json`}>实验诊断</a></div><p>外网版由浏览器直接调用模型接口；本机版提供DeepSeek Harness居民执行与四角色编排。GitHub Pages不运行本机后端或四角色自动开发。</p></section>}
  </div></main></div>;
}
