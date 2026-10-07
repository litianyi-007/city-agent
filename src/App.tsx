import { useEffect, useRef, useState, type FormEvent } from 'react';
import { PopulationExplorer } from './PopulationExplorer';
import { ResearchCaseView } from './ResearchCaseView';
import { ResearchWorkspace } from './ResearchWorkspace';
import { SurveyResults } from './SurveyResults';
import type { AgentPublic, AgentInput, Role, Run, RunInput } from '../server/types';

const roleOrder: Role[] = ['product', 'researcher', 'developer', 'tester'];
const roles: Record<Role, { name: string; en: string; icon: string; description: string }> = {
  product: { name: '产品', en: 'PRODUCT', icon: 'P', description: '拆解需求 · 冻结规格' },
  researcher: { name: '研究员', en: 'RESEARCH', icon: 'R', description: '分析人群 · 提供依据' },
  developer: { name: '研发', en: 'DEVELOP', icon: 'D', description: '编写应用 · 自动返修' },
  tester: { name: '测试', en: 'QUALITY', icon: 'Q', description: '独立断言 · 浏览器验收' },
};
const statusLabel: Record<string, string> = { queued: '等待执行', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '运行中断', pending: '待执行', skipped: '已跳过' };
const initialTask = '为杭州滨江区西兴、长河、浦沿的模拟人群开发一个 AI 生活服务会员商品调研页面。展示人口结构、来源与模拟购买意愿，支持调整价格比较结果，并查看各街道差异。明确区分公开事实、统计推断和模型生成；提供可运行页面和验收报告。';

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.error || payload?.message || `请求失败 (${response.status})`);
  return payload as T;
}
const post = (value: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(value) });
const fmt = (n: number) => new Intl.NumberFormat('zh-CN').format(n);
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const activeRun = (r: Run | null) => r && ['running', 'queued'].includes(r.status);
const needsRunRefresh = (r: Run | null) => activeRun(r) || Boolean(r && ['completed', 'failed', 'cancelled'].includes(r.status) && !r.finishedAt);
type View = 'workspace' | 'agents' | 'city' | 'research' | 'residents';
const isResearchView = (view: View) => view === 'research' || view === 'residents';
const readView = (): View => {
  const value = window.location.hash.slice(1);
  return ['workspace', 'agents', 'city', 'research', 'residents'].includes(value) ? value as View : 'workspace';
};

interface City {
  name: string; population: number; eligiblePopulation?: number; period: string;
  populationBasis?: string; limitations?: string[];
  streets: { id: string; name: string; population: number; share: number }[];
  sources: { id?: string; title?: string; publisher?: string; url?: string; locator?: string }[];
}

export default function App() {
  const [view, setCurrentView] = useState<View>(readView);
  const [researchDirty, setResearchDirty] = useState(false);
  const [agents, setAgents] = useState<AgentPublic[]>([]);
  const [city, setCity] = useState<City | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [task, setTask] = useState(initialTask);
  const [mode, setMode] = useState<'demo' | 'live'>('demo');
  const [product, setProduct] = useState('AI 生活服务会员');
  const [price, setPrice] = useState(29);
  const [sampleSize, setSampleSize] = useState(120);
  const [seed, setSeed] = useState(42);
  const [selection, setSelection] = useState<Partial<Record<Role, string>>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<AgentPublic | 'new' | null>(null);
  const [detailTab, setDetailTab] = useState<'events' | 'deliverables' | 'plan' | 'research'>('events');
  const pollVersion = useRef(0);

  function setView(next: View) {
    if (isResearchView(view) && !isResearchView(next) && researchDirty && !window.confirm('调查或人群预设有未保存修改，是否离开？')) return;
    if (!isResearchView(next)) setResearchDirty(false);
    setCurrentView(next); window.history.pushState(null, '', `#${next}`);
  }
  useEffect(() => {
    const navigate = () => {
      const next = readView();
      if (isResearchView(view) && !isResearchView(next) && researchDirty && !window.confirm('调查或人群预设有未保存修改，是否离开？')) {
        window.history.replaceState(null, '', `#${view}`); return;
      }
      if (!isResearchView(next)) setResearchDirty(false);
      setCurrentView(next);
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, [view, researchDirty]);

  useEffect(() => {
    let stopped = false;
    Promise.all([api<AgentPublic[]>('/agents'), api<City>('/city'), api<Run[]>('/runs')])
      .then(([team, cityData, history]) => {
        if (stopped) return;
        setAgents(team); setCity(cityData); setRuns(history); setRun(history[0] ?? null);
        setSelection(Object.fromEntries(roleOrder.map(role => [role, team.find(a => a.role === role && a.enabled)?.id])));
      }).catch(e => !stopped && setError(e.message)).finally(() => !stopped && setLoading(false));
    return () => { stopped = true; };
  }, []);

  useEffect(() => {
    if (!needsRunRefresh(run)) return;
    const version = ++pollVersion.current;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [next, history] = await Promise.all([api<Run>(`/runs/${run!.id}`), api<Run[]>('/runs')]);
        if (stopped || version !== pollVersion.current) return;
        setRun(next); setRuns(history);
        if (needsRunRefresh(next)) timer = setTimeout(poll, 1000);
      } catch (e) { if (!stopped) { setError((e as Error).message); timer = setTimeout(poll, 3000); } }
    };
    timer = setTimeout(poll, 500);
    return () => { stopped = true; clearTimeout(timer); };
  }, [run?.id, run?.status, run?.finishedAt]);

  const refreshAgents = async () => {
    const list = await api<AgentPublic[]>('/agents'); setAgents(list);
    setSelection(current => Object.fromEntries(roleOrder.map(role => [role,
      list.some(a => a.id === current[role] && a.role === role && a.enabled)
        ? current[role] : list.find(a => a.role === role && a.enabled)?.id,
    ])));
  };

  async function launch(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice(''); setSubmitting(true);
    try {
      const input: RunInput = { task, mode, product, price, sampleSize, seed, agentIds: roleOrder.map(r => selection[r] || '') };
      const created = await api<Run>('/runs', post(input));
      setRun(created); setRuns(previous => [created, ...previous]); setDetailTab('events');
    } catch (e) { setError((e as Error).message); } finally { setSubmitting(false); }
  }

  async function clone(agent: AgentPublic) {
    try { await api(`/agents/${agent.id}/clone`, post({})); await refreshAgents(); setNotice(`已复制 ${agent.name}，可独立更换角色与模型。`); }
    catch (e) { setError((e as Error).message); }
  }

  async function remove(agent: AgentPublic) {
    if (!window.confirm(`删除智能体“${agent.name}”？历史运行仍保留。`)) return;
    try { await api(`/agents/${agent.id}`, { method: 'DELETE' }); await refreshAgents(); setNotice('智能体已删除，历史运行不受影响。'); }
    catch (e) { setError((e as Error).message); }
  }

  const selectedAgents = roleOrder.map(role => agents.find(a => a.id === selection[role]));
  const ready = selectedAgents.every(a => a?.enabled && (mode === 'demo' || a.hasApiKey));

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setView('workspace'); }}><span className="brand-mark">c<span>·</span>a</span><span>city agent<small>AUTONOMOUS STUDIO</small></span></a>
      <div className="nav-caption">工作空间</div>
      <nav aria-label="主导航">
        <button className={view === 'workspace' ? 'nav-item selected' : 'nav-item'} onClick={() => setView('workspace')}><span className="nav-icon">▦</span>任务工作台<span className="nav-key">01</span></button>
        <button className={isResearchView(view) ? 'nav-item selected' : 'nav-item'} onClick={() => setView('research')}><span className="nav-icon">◎</span>虚拟社会调查<span className="nav-key">02</span></button>
        <button className={view === 'agents' ? 'nav-item selected' : 'nav-item'} onClick={() => setView('agents')}><span className="nav-icon">◈</span>智能体团队<span className="nav-key">{agents.length.toString().padStart(2, '0')}</span></button>
        <button className={view === 'city' ? 'nav-item selected' : 'nav-item'} onClick={() => setView('city')}><span className="nav-icon">▥</span>城市与样本<span className="nav-key">03</span></button>
      </nav>
      <div className="sidebar-project"><div className="tiny-label">CURRENT SCENARIO</div><strong>滨江 · 商品调研</strong><p>从现实人口结构出发，<br />交付一个可运行的调研应用。</p><span className="outline-tag">L5 · 有界自主研发</span></div>
      <div className="sidebar-footer"><span className="engine-icon">⌘</span><div>DeepSeek Harness<small>本地工作空间 · Demo v0.1</small></div></div>
    </aside>
    <main>
      <header className="topbar"><div><span className="breadcrumb">CITY AGENT</span><span className="slash">/</span>{view === 'workspace' ? '任务工作台' : view === 'agents' ? '智能体团队' : isResearchView(view) ? '虚拟社会调查' : '城市与样本'}</div><span className="local-badge"><span />LOCAL WORKSPACE</span></header>
      <div className="page">
        <div className="page-heading"><div><div className="eyebrow">{isResearchView(view) ? 'VIRTUAL SOCIETY RESEARCH' : view === 'workspace' ? 'FROM INTENT TO DELIVERY' : view === 'agents' ? 'BUILD YOUR TEAM' : 'GROUNDED IN DATA'}</div><h1>{isResearchView(view) ? '虚拟社会调查' : view === 'workspace' ? '一个任务，一支自主团队。' : view === 'agents' ? '让合适的模型，承担合适的角色。' : '人口可信，才能推演城市。'}</h1><p>{isResearchView(view) ? '准备问卷、配置人群 Agent，先检查研究条件与证据缺口。' : view === 'workspace' ? '描述需求，选择团队。从拆解到验收，观察每一步交付。' : view === 'agents' ? '独立配置角色、模型与连接信息。复制智能体，快速尝试不同组合。' : '核验事实、追溯推断。把数据来源、适用边界和未知项一起交付。'}</p></div>{view === 'agents' ? <button className="primary" onClick={() => setEditing('new')}>＋ 新建智能体</button> : <span className="version-pill">DEMO / 01</span>}</div>
        {error && <div className="alert error" role="alert"><span>{error}</span><button aria-label="关闭错误" onClick={() => setError('')}>×</button></div>}
        {notice && <div className="alert success" role="status"><span>{notice}</span><button aria-label="关闭提示" onClick={() => setNotice('')}>×</button></div>}
        {loading ? <div className="loading-state">正在连接本地工作空间…</div> : <>
          {view === 'workspace' && <>
            <section className="workflow" aria-label="自动研发流程">{roleOrder.map((role, i) => <div className="workflow-step" key={role}><span className={`role-icon ${role}`}>{roles[role].icon}</span><div><b>{roles[role].name}<small>0{i + 1}</small></b><span>{roles[role].description}</span></div>{i < 3 && <span className="workflow-arrow">→</span>}</div>)}</section>
            <form className="compose-grid" onSubmit={launch}>
              <section className="panel task-panel"><div className="panel-heading"><h2>交给团队的任务</h2><span className="small-muted">01 / BRIEF</span></div><label className="sr-only" htmlFor="task">任务需求</label><textarea id="task" value={task} onChange={e => setTask(e.target.value)} maxLength={12000} minLength={10} required rows={5} /><div className="task-hint"><span>交付范围：离线单页 Web 应用</span><button type="button" className="text-button" onClick={() => setTask(initialTask)}>使用商品调研示例 ↗</button></div>
                <div className="scenario-presets" aria-label="研究验收案例"><span>端到端案例</span><button type="button" className="secondary compact" onClick={() => { setTask('我想调查下滨江区小学生的零食喜好，如果我要开家零食店，该怎么选址和选择零食品类？请先判断人口与调查数据是否满足需求，再提出有条件的假设和补采计划，交付可交互报告。'); setProduct('小学生零食偏好与门店选址'); setPrice(5); }}>小学生零食店</button><button type="button" className="secondary compact" onClick={() => { setTask('我想调查滨江区人口分布，如果我为了配合线上销售，计划要开设线下网点销售宠物零食，应该在什么区域，售卖主营什么价位的宠物零食，是卖猫粮为主还是狗粮为主？请先区分零食与主粮，检查数据缺口，再形成条件假设、补采计划和交互报告。'); setProduct('宠物零食线上线下网点'); setPrice(29); }}>宠物零食网点</button></div>
                <div className="scenario-fields"><label>商品名称<input value={product} onChange={e => setProduct(e.target.value)} maxLength={120} required /></label><label>参考价格 / 元<input type="number" min="0" max="10000" step="0.01" value={price} onChange={e => setPrice(Number(e.target.value))} required /></label><label>样本量<input type="number" min="30" max="600" value={sampleSize} onChange={e => setSampleSize(Number(e.target.value))} required /></label><label>随机种子<input type="number" min="0" max="2147483647" value={seed} onChange={e => setSeed(Number(e.target.value))} required /></label></div>
                <div className="mode-row"><div className="segmented" aria-label="运行模式"><button type="button" className={mode === 'demo' ? 'active' : ''} onClick={() => setMode('demo')}>流程演示</button><button type="button" className={mode === 'live' ? 'active' : ''} onClick={() => setMode('live')}>真实模型</button></div><span className="mode-note">{mode === 'demo' ? '无需 Key · 固定示例，不调用模型' : '真实调用已选模型 · 自动实现与返修'}</span></div>
                <div className="launch-row"><p>{mode === 'demo' ? '演示运行不作为真实 L5 成功证据。' : ready ? '任务提交后无需中途确认。最多自动返修 2 次。' : '请先为四个已选智能体填写 API Key。'}</p><button className="primary launch-button" disabled={submitting || !ready || Boolean(activeRun(run))}>{submitting ? '正在创建…' : activeRun(run) ? '团队执行中…' : '启动任务'}<span>↗</span></button></div>
              </section>
              <section className="panel team-panel"><div className="panel-heading"><h2>本次执行团队</h2><button type="button" className="text-button" onClick={() => setView('agents')}>管理 ↗</button></div><div className="team-list">{roleOrder.map(role => { const selected = agents.find(a => a.id === selection[role]); return <div className="team-slot" key={role}><span className={`role-icon small ${role}`}>{roles[role].icon}</span><div><label htmlFor={`select-${role}`}>{roles[role].name}</label><select id={`select-${role}`} value={selection[role] || ''} onChange={e => setSelection(s => ({ ...s, [role]: e.target.value }))}><option value="" disabled>选择智能体</option>{agents.filter(a => a.role === role && a.enabled).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select><span className="model-caption">{selected?.modelId || '尚未分配'}</span></div><span className={`key-status ${selected?.hasApiKey ? 'configured' : ''}`} title={selected?.hasApiKey ? '已配置 Key' : '未配置 Key'}>{selected?.hasApiKey ? '已连接配置' : '待配置'}</span></div>; })}</div><div className="team-footnote">每次运行保存独立配置快照。后续编辑不会改变已提交任务。</div></section>
            </form>
            <section className="run-area"><div className="section-heading"><div><h2>执行与交付</h2><span>从过程看见结果</span></div>{runs.length > 0 && <select aria-label="运行历史" value={run?.id || ''} onChange={e => { api<Run>(`/runs/${e.target.value}`).then(setRun).catch(e => setError(e.message)); }}><option value="" disabled>选择一次运行</option>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleTimeString('zh-CN')} · {statusLabel[r.status]} · {r.task.slice(0, 22)}</option>)}</select>}</div>
              {!run ? <div className="empty-state"><span className="empty-symbol">↗</span><div><h3>下一份交付，从这里开始</h3><p>提交上方任务后，查看角色产出、验收结果和可运行页面。</p></div><span className="empty-meta">NO RUNS YET</span></div> : <div className="panel run-panel"><div className="run-header"><div className="run-identity"><span className={`status-pill ${run.status}`}>{statusLabel[run.status]}</span><span className="mode-tag">{run.mode === 'demo' ? '流程演示 · 非 L5 证据' : '真实模型运行'}</span><code>{run.id.slice(0, 8)}</code></div>{activeRun(run) && <button className="secondary compact" onClick={async () => { try { setRun(await api<Run>(`/runs/${run.id}/cancel`, post({}))); } catch (e) { setError((e as Error).message); } }}>停止运行</button>}</div>
                  <div className="stage-track">{roleOrder.map(role => { const stage = run.stages.find(s => s.role === role); return <div key={role} className={`stage ${stage?.status || 'pending'}`}><span className="stage-sign">{stage?.status === 'completed' ? '✓' : stage?.status === 'running' ? '◌' : stage?.status === 'failed' ? '×' : '·'}</span><span>{roles[role].name}<small>{statusLabel[stage?.status || 'pending']}{stage && stage.attempt > 1 ? ` · 第 ${stage.attempt} 次` : ''}</small></span></div>; })}</div>
                  {run.error && <div className="run-error" role="alert">{run.error}</div>}
                  <div className="run-tabs" role="tablist" aria-label="运行详情">{(['events', 'deliverables', 'plan', 'research'] as const).map(tab => <button key={tab} role="tab" aria-selected={detailTab === tab} onClick={() => setDetailTab(tab)}>{({ events: '执行日志', deliverables: '交付产物', plan: '角色产出', research: '调研结果' })[tab]}{tab === 'deliverables' && run.artifacts.length > 0 && <span>{run.artifacts.length}</span>}</button>)}<div className="token-meta">{fmt(run.usage.inputTokens + run.usage.outputTokens)} tokens <span>· {run.mode === 'demo' ? '无模型费用' : '费用未估算'}</span></div></div>
                  <div className="run-content">
                    {detailTab === 'events' && <div className="event-list" aria-live="polite">{run.events.length === 0 ? <p className="muted">等待调度…</p> : run.events.map(event => <div className="event" key={event.id}><time>{new Date(event.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><span className={`event-role ${event.role || ''}`}>{event.role ? roles[event.role].name : '系统'}</span><p>{event.message}</p></div>)}</div>}
                    {detailTab === 'plan' && <div className="outputs">{run.stages.map(stage => <details key={stage.role} open={stage.role === 'product'}><summary><span className={`role-icon tiny ${stage.role}`}>{roles[stage.role].icon}</span>{roles[stage.role].name}<span className="muted">{statusLabel[stage.status]}</span></summary><pre>{stage.output || '尚无产出'}</pre></details>)}</div>}
                    {detailTab === 'deliverables' && <><div className="artifact-list">{run.artifacts.length ? run.artifacts.map(a => <a key={a.name} href={`/api/runs/${run.id}/artifacts/${encodeURIComponent(a.name)}`} target="_blank" rel="noreferrer"><span>↗</span><div><b>{a.name}</b><small>{a.type}</small></div></a>) : <p className="muted">验收完成后，产物会出现在这里。</p>}</div>{run.gate && <div className="gate"><h3>{run.gate.passed ? '✓ 验收通过' : '× 验收未通过'}</h3>{run.gate.checks.map((c, i) => <div className={c.passed ? 'check passed' : 'check failed'} key={i}><span>{c.passed ? '✓' : '×'}</span><b>{c.name}</b>{c.detail && <small>{c.detail}</small>}</div>)}</div>}{run.artifacts.some(a => a.name === 'index.html') && <div className="preview-wrap"><div><span>交付页面预览</span><small>隔离运行 · 禁止联网</small></div><iframe title="交付应用预览" sandbox="allow-scripts" src={`/api/runs/${run.id}/artifacts/index.html`} /></div>}</>}
                    {detailTab === 'research' && (run.questionnaireSurvey ? <SurveyResults run={run.questionnaireSurvey} /> : run.artifacts.some(a => a.name === 'case-report.json') || /小学|儿童|宠物|猫粮|狗粮/.test(run.task) ? <ResearchCaseView run={run} /> : <ResearchView survey={run.survey} />)}
                  </div>
                </div>}
            </section>
          </>}
          {view === 'agents' && <><div className="info-banner"><span>⌁</span> API Key 在本机服务端加密保存，页面只显示配置状态。复制会继承连接信息与 Key。</div><div className="agent-grid">{agents.map(agent => <article className="panel agent-card" key={agent.id}><div className="agent-card-top"><span className={`role-icon ${agent.role}`}>{roles[agent.role].icon}</span><span className={`status-pill ${agent.enabled ? 'completed' : 'pending'}`}>{agent.enabled ? '已启用' : '已停用'}</span></div><h2>{agent.name}</h2><span className="agent-role">{roles[agent.role].name} <span>/ {roles[agent.role].en}</span></span><dl><div><dt>PROVIDER</dt><dd>{agent.provider}</dd></div><div><dt>MODEL</dt><dd>{agent.modelId}</dd></div><div><dt>BASE URL</dt><dd title={agent.baseUrl}>{agent.baseUrl}</dd></div><div><dt>API KEY</dt><dd>{agent.hasApiKey ? '••••••••  已保存' : '未配置'}</dd></div></dl><div className="agent-actions"><button className="secondary" onClick={() => setEditing(agent)}>编辑配置</button><button className="text-button" onClick={() => clone(agent)} aria-label={`复制 ${agent.name}`}>复制</button><button className="text-button danger" onClick={() => remove(agent)} aria-label={`删除 ${agent.name}`}>删除</button></div></article>)}<button className="add-agent" onClick={() => setEditing('new')}><span>＋</span><b>添加一位团队成员</b><p>相同角色也可以有不同的模型选择</p></button></div></>}
          {view === 'city' && city && <PopulationExplorer />}
          {isResearchView(view) && <ResearchWorkspace section={view === 'residents' ? 'residents' : 'projects'} onSectionChange={section => setView(section === 'residents' ? 'residents' : 'research')} onDirtyChange={setResearchDirty} />}
        </>}
        <footer className="page-footer"><span>CITY AGENT</span><p>让需求成为可检查的交付。</p><span>2026 / LOCAL DEMO</span></footer>
      </div>
    </main>
    {editing && <AgentEditor agent={editing} onClose={() => setEditing(null)} onSave={async values => { await api(editing === 'new' ? '/agents' : `/agents/${editing.id}`, { method: editing === 'new' ? 'POST' : 'PATCH', body: JSON.stringify(values) }); await refreshAgents(); setEditing(null); setNotice('智能体配置已保存。'); }} />}
  </div>;
}

function AgentEditor({ agent, onClose, onSave }: { agent: AgentPublic | 'new'; onClose: () => void; onSave: (value: AgentInput) => Promise<void> }) {
  const [form, setForm] = useState<AgentInput>(() => agent === 'new' ? { name: '', role: 'developer', provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', enabled: true } : { name: agent.name, role: agent.role, provider: agent.provider, baseUrl: agent.baseUrl, modelId: agent.modelId, enabled: agent.enabled });
  const [key, setKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const set = <K extends keyof AgentInput>(field: K, value: AgentInput[K]) => setForm(current => ({ ...current, [field]: value }));
  const endpointChanged = agent !== 'new' && (form.provider !== agent.provider || form.baseUrl?.replace(/\/+$/, '') !== agent.baseUrl);
  return <dialog ref={dialog} className="agent-dialog" onCancel={onClose}><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { await onSave({ ...form, ...(key ? { apiKey: key } : clearKey ? { apiKey: null } : {}) }); } catch (e) { setError((e as Error).message); setBusy(false); } }}>
    <div className="dialog-heading"><div><div className="eyebrow">AGENT CONFIGURATION</div><h2>{agent === 'new' ? '新建智能体' : '编辑智能体'}</h2></div><button type="button" className="close-button" aria-label="关闭配置" onClick={onClose}>×</button></div>
    {error && <div className="alert error" role="alert">{error}</div>}
    <div className="form-two"><label>名称<input autoFocus value={form.name} onChange={e => set('name', e.target.value)} maxLength={80} required /></label><label>角色<select value={form.role} onChange={e => set('role', e.target.value as Role)}>{roleOrder.map(r => <option key={r} value={r}>{roles[r].name}</option>)}</select></label></div>
    <label>Provider<select value={form.provider} onChange={e => { const provider = e.target.value as AgentInput['provider']; setForm(f => ({ ...f, provider, baseUrl: provider === 'anthropic' ? 'https://api.anthropic.com' : provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1', modelId: provider === 'anthropic' ? '' : provider === 'deepseek' ? 'deepseek-flash' : '' })); }}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI Compatible（含自定义服务）</option><option value="anthropic">Anthropic</option></select></label>
    <label>Base URL<input type="url" value={form.baseUrl} onChange={e => set('baseUrl', e.target.value)} required placeholder="https://your-provider.example/v1" /></label>
    <label>Model ID<input value={form.modelId} onChange={e => set('modelId', e.target.value)} required placeholder="填写服务商提供的模型 ID" /></label>
    <label>API Key<input type="password" value={key} onChange={e => { setKey(e.target.value); setClearKey(false); }} autoComplete="new-password" placeholder={endpointChanged ? '填写新服务Key；留空将清除原Key' : agent !== 'new' && agent.hasApiKey ? '已保存，留空表示保持原 Key' : '输入后加密保存到本机'} /></label>
    {endpointChanged && <p className="research-note warning">已更换提供方或地址；如未明确填写新 Key，保存时会清除原 Key，避免发送给另一服务。</p>}
    {agent !== 'new' && agent.hasApiKey && <label className="checkbox-label"><input type="checkbox" checked={clearKey} onChange={e => { setClearKey(e.target.checked); setKey(''); }} />清除已保存的 Key</label>}
    <div className="form-two"><label className="checkbox-label enabled-label"><input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} />启用这个智能体</label></div>
    <div className="dialog-note">连接信息只在本机后端使用。请填写你信任的模型服务地址；不要将 Key 粘贴到名称或其他公开字段。</div>
    <div className="dialog-actions"><button type="button" className="secondary" onClick={onClose}>取消</button><button className="primary" disabled={busy}>{busy ? '保存中…' : '保存配置'}</button></div>
  </form></dialog>;
}

function ResearchView({ survey }: { survey: Run['survey'] }) {
  if (!survey) return <p className="muted">研究阶段完成后显示本次样本与模拟结果。</p>;
  const result = survey as unknown as { sampleSize: number; population: number; summary: { acceptanceRate: number }; byStreet: { street?: string; name?: string; acceptanceRate: number; sampleSize?: number; count?: number }[]; disclaimers: string[] };
  return <div className="research-result"><div className="research-warning">演示意愿模型 · 预设价格响应规则，未访谈真人，也不是 LLM 居民作答。</div><div className="research-metrics"><div><small>样本量</small><strong>{fmt(result.sampleSize)}</strong></div><div><small>历史总体</small><strong>{fmt(result.population)}</strong></div><div><small>模拟加权意愿</small><strong>{pct(result.summary.acceptanceRate)}</strong></div></div><div className="research-bars">{result.byStreet.map((s, i) => <div className="street" key={i}><div><b>{s.street || s.name}</b><span>{pct(s.acceptanceRate)}</span></div><div className="bar-track"><div style={{ width: `${s.acceptanceRate * 100}%` }} /></div></div>)}</div><ul className="research-limitations">{result.disclaimers.map((s, i) => <li key={i}>{s}</li>)}</ul></div>;
}
