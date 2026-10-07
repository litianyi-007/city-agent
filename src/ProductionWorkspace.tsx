import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProductionAgent, ProductionAgentInput, ProductionCapability, ProductionRole, ProductionRun, ProductionRunInput } from '../shared/production-schema';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks';
import type { JevEvaluation, JevPublicConfig } from '../shared/jev-schema';
import JevSettings from './JevSettings';
import './production.css';

const ROLE_ORDER: ProductionRole[] = ['product', 'project-manager', 'researcher', 'developer', 'tester', 'verifier'];
const ROLE_INFO: Record<ProductionRole, { label: string; initials: string; responsibility: string }> = {
  product: { label: '产品经理', initials: 'PM', responsibility: '一句话 → 可执行产品目标' },
  'project-manager': { label: '项目经理', initials: 'PL', responsibility: '拆解任务 · 有界自主闭环' },
  researcher: { label: '研究员', initials: 'RS', responsibility: '研究约束 · 澄清未知项' },
  developer: { label: '研发', initials: 'DE', responsibility: '实现产品 · 按反馈返修' },
  tester: { label: '测试', initials: 'QA', responsibility: '冻结断言 · 浏览器验证' },
  verifier: { label: 'Verifier', initials: 'VE', responsibility: '评审候选 · 不合格则拒绝' },
};
const STATUS: Record<ProductionRun['status'], string> = { queued: '等待执行', running: '执行中', completed: '门禁通过', failed: '交付失败', cancelled: '已取消', interrupted: '运行中断' };
const DEFAULT_LIMITS: ProductionRunInput['limits'] = { maxCalls: 24, maxRepairCycles: 2, maxTokens: 500000, maxOutputTokens: 6000, maxDurationMs: 600000, maxCost: 5, currency: 'USD' };
function caseRequirement(item: (typeof PRODUCTION_DEMO_CASES)[number]): ProductionRunInput['requirement'] {
  return { id: item.id, source: item.source, background: item.background, acceptance: item.acceptance, difficulty: item.difficulty, kind: item.kind };
}
const DEFAULT_REQUIREMENT = caseRequirement(PRODUCTION_DEMO_CASES[0]);
const DEFAULT_BRIEF = PRODUCTION_DEMO_CASES[0].brief;
const format = (value: number | null | undefined) => value == null ? 'unknown' : new Intl.NumberFormat('zh-CN').format(value);
const displayScore = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'unknown';
const active = (run: ProductionRun | null) => !!run && ['queued', 'running'].includes(run.status);
const artifactUrl = (runId: string, name: string) => `/api/production/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`;

async function request<T>(path: string, init?: RequestInit, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/production${path}`, { ...init, signal, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.error || payload?.message || `请求失败（${response.status}）`);
  return payload as T;
}
const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });

function Mark({ className = '' }: { className?: string }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M8 4H4v16h4M16 4h4v16h-4M9 8l6 4-6 4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function ProductionWorkspace() {
  const [view, setView] = useState<'workbench' | 'team' | 'decision' | 'report'>('workbench');
  const [agents, setAgents] = useState<ProductionAgent[]>([]);
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [run, setRun] = useState<ProductionRun | null>(null);
  const [selection, setSelection] = useState<Partial<Record<ProductionRole, string>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<ProductionAgent | 'new' | null>(null);
  const [brief, setBrief] = useState<string>(DEFAULT_BRIEF);
  const [requirement, setRequirement] = useState(DEFAULT_REQUIREMENT);
  const [demoCaseId, setDemoCaseId] = useState<string | undefined>(PRODUCTION_DEMO_CASES[0].operation);
  const [mode, setMode] = useState<'demo' | 'mock-jev' | 'live'>('demo');
  const [capability, setCapability] = useState<ProductionCapability>('offline-single-html');
  const [verifierEngine, setVerifierEngine] = useState<'llm-rubric' | 'jev-cascade'>('llm-rubric');
  const [jevConfig, setJevConfig] = useState<JevPublicConfig | null>(null);
  const [candidateCount, setCandidateCount] = useState<1 | 2>(1);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [budgetAuthorized, setBudgetAuthorized] = useState(false);
  const [detail, setDetail] = useState<'events' | 'verifier' | 'delivery' | 'calls'>('events');
  const [preview, setPreview] = useState(false);
  const mounted = useRef(true);
  const selectionRequest = useRef(0);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    Promise.all([request<ProductionAgent[]>('/agents', undefined, controller.signal), request<ProductionRun[]>('/runs', undefined, controller.signal)])
      .then(([team, history]) => {
        setAgents(team); setRuns(history); setRun(history[0] ?? null);
        setSelection(Object.fromEntries(ROLE_ORDER.map(role => [role, team.find(agent => agent.role === role && agent.enabled)?.id])));
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    request<JevPublicConfig>('/jev/config', undefined, controller.signal).then(value => { if (!controller.signal.aborted) setJevConfig(value); }).catch(() => { /* Existing service compatibility: unavailable Jev never enables paid mode. */ });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!active(run)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const [next, history] = await Promise.all([request<ProductionRun>(`/runs/${run!.id}`, undefined, controller.signal), request<ProductionRun[]>('/runs', undefined, controller.signal)]);
        if (controller.signal.aborted) return;
        setRun(next); setRuns(history);
        if (active(next)) timer = setTimeout(poll, 1200);
      } catch (e) {
        if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : '更新运行状态失败'); timer = setTimeout(poll, 2500); }
      }
    };
    timer = setTimeout(poll, 500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [run?.id, run?.status]);

  async function refreshAgents() {
    const team = await request<ProductionAgent[]>('/agents');
    if (!mounted.current) return;
    setAgents(team);
    setSelection(previous => Object.fromEntries(ROLE_ORDER.map(role => [role, team.find(agent => agent.id === previous[role] && agent.role === role && agent.enabled)?.id ?? team.find(agent => agent.role === role && agent.enabled)?.id])));
  }
  async function changeAgent(action: 'clone' | 'delete', agent: ProductionAgent) {
    if (action === 'delete' && !window.confirm(`删除「${agent.name}」？历史运行快照会保留。`)) return;
    setBusy(true); setError('');
    try { await request(`/agents/${agent.id}${action === 'clone' ? '/clone' : ''}`, { method: action === 'clone' ? 'POST' : 'DELETE' }); await refreshAgents(); setNotice(action === 'clone' ? '已复制 Agent，可独立修改角色与模型。' : '已删除 Agent。'); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function selectRun(id: string) {
    const version = ++selectionRequest.current;
    setPreview(false); setError('');
    try { const next = await request<ProductionRun>(`/runs/${id}`); if (mounted.current && version === selectionRequest.current) setRun(next); }
    catch (e) { if (version === selectionRequest.current) setError(e instanceof Error ? e.message : '读取运行失败'); }
  }
  async function start(event: FormEvent) {
    event.preventDefault(); ++selectionRequest.current; setBusy(true); setError(''); setPreview(false);
    try {
      const next = await request<ProductionRun>('/runs', json({ brief, capability, mode, agentIds: ROLE_ORDER.map(role => selection[role]), candidateCount, limits, requirement, budgetAuthorized: mode !== 'demo' && budgetAuthorized, ...(mode !== 'live' && demoCaseId ? { demoCaseId } : {}), ...(mode === 'mock-jev' || mode === 'live' && verifierEngine === 'jev-cascade' ? { verifierEngine: 'jev-cascade' } : {}) }));
      if (!mounted.current) return;
      setRun(next); setRuns(previous => [next, ...previous.filter(item => item.id !== next.id)]); setDetail('events');
      setNotice(mode === 'demo' ? '已启动工程夹具：不会调用真实模型，不计入自主交付良品率。' : mode === 'mock-jev' ? '已启动混合验证：固定研发夹具 + 真实 Jev 决策，产生 Jev 费用，但不计为自主研发交付。' : '已启动真实模型任务；预算、返修与时间限制已冻结。');
    } catch (e) { setError(e instanceof Error ? e.message : '启动失败'); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    if (!run) return;
    setBusy(true); setError(''); setPreview(false);
    try { const next = await request<ProductionRun>(`/runs/${run.id}/cancel`, { method: 'POST' }); if (mounted.current) { setRun(next); setRuns(previous => previous.map(item => item.id === next.id ? next : item)); setNotice('取消请求已发送，终止与清理结果请查看执行日志。'); } }
    catch (e) { setError(e instanceof Error ? e.message : '取消失败'); }
    finally { if (mounted.current) setBusy(false); }
  }

  const selectedAgents = ROLE_ORDER.map(role => agents.find(agent => agent.id === selection[role] && agent.role === role && agent.enabled));
  const teamReady = selectedAgents.every(Boolean);
  const liveMissing = selectedAgents.filter(agent => !agent?.hasApiKey || !agent.pricing || agent.pricing.currency !== limits.currency);
  const anotherRunActive = runs.some(item => ['queued', 'running'].includes(item.status));
  const jevReady = !!jevConfig?.enabled && jevConfig.hasApiKey && limits.currency === 'USD';
  const canLaunch = !loading && !busy && !anotherRunActive && teamReady && (mode === 'demo' ? !!demoCaseId : mode === 'mock-jev' ? !!demoCaseId && budgetAuthorized && jevReady : budgetAuthorized && liveMissing.length === 0 && (verifierEngine === 'llm-rubric' || jevReady));
  const realRuns = runs.filter(item => item.evidenceKind === 'real-model');
  const realTerminal = realRuns.filter(item => !['queued', 'running'].includes(item.status));
  const realPassed = realRuns.filter(item => item.status === 'completed' && item.gate?.passed && (item.input.capability !== 'camera-scene-v1' || Boolean(item.cameraVerification?.fullRequirementVerified)));
  const fixtureRuns = runs.filter(item => item.evidenceKind !== 'real-model');
  const goodRate = realTerminal.length ? `${((realPassed.length / realTerminal.length) * 100).toFixed(1)}%` : 'unknown';

  return <div className="production-root">
    <a className="prod-skip-link" href="#prod-main">跳至生产工作区</a>
    <header className="prod-header">
      <a className="prod-brand" href="#production" aria-label="Agent Delivery Studio 自动化研发工作区" onClick={() => setView('workbench')}><span className="prod-brand-symbol"><Mark /></span><span>Agent Delivery Studio<small>有界 L4 / L5 · 自动化软件生产</small></span></a>
      <nav className="prod-nav" aria-label="生产工作区导航">{([['workbench', '生产工作台'], ['team', '研发团队'], ['decision', '决策设置'], ['report', '证据与申报']] as const).map(([value, label]) => <button key={value} type="button" aria-current={view === value ? 'page' : undefined} onClick={() => setView(value)}>{label}</button>)}</nav>
      <a className="prod-back" href="#research">返回虚拟社会</a>
    </header>
    <main className="prod-main" id="prod-main" tabIndex={-1}>
<div className="prod-heading"><div><p className="prod-eyebrow">AUTONOMOUS DELIVERY / 研发生产线</p><h1>{view === 'team' ? '一支可以配置、复制的研发团队' : view === 'decision' ? '让候选决策有分布，也有边界' : view === 'report' ? '用证据描述能力，而不是用承诺' : '把一句话，交给一支研发团队。'}</h1><p className="prod-muted">产品目标 → 项目经理闭环 → 研发实现 → 浏览器验收 → 可追溯交付。</p></div><span className="prod-scope">当前执行范围<strong>受限 HTML / 声明式摄像头场景</strong></span></div>
      <aside className="prod-boundary">工作区与虚拟社会调查独立。当前不在宿主执行生成的 Node / shell；通用仓库构建需要另外验证隔离执行器。模型评审不能替代最终行为 Gate。</aside>
      {error ? <div className="prod-alert prod-alert-error" role="alert"><span>{error}</span><button type="button" aria-label="关闭错误提示" onClick={() => setError('')}>×</button></div> : null}
      {notice ? <div className="prod-alert" role="status"><span>{notice}</span><button type="button" aria-label="关闭操作提示" onClick={() => setNotice('')}>×</button></div> : null}
      {loading ? <div className="prod-loading" role="status">正在载入独立团队与运行账本…</div> : null}
      {view === 'workbench' ? <>
        <div className="prod-workflow" aria-label="六角色工作流程">{ROLE_ORDER.map((role, index) => <div className="prod-flow-role" key={role}><span className={`prod-role prod-role-${role}`}>{ROLE_INFO[role].initials}</span><div><b>{ROLE_INFO[role].label}</b><small>{ROLE_INFO[role].responsibility}</small></div><span className="prod-flow-number">{String(index + 1).padStart(2, '0')}</span></div>)}</div>
        <div className="prod-compose">
          <form className="prod-panel prod-request" onSubmit={start}>
            <div className="prod-section-heading"><h2>提出一个软件需求</h2><span className="prod-pill">一句话也可以开始</span></div>
            <label className="prod-capability" htmlFor="prod-capability">受控交付能力<select id="prod-capability" value={capability} onChange={event => { const next = event.target.value as ProductionCapability; setCapability(next); if (next === 'camera-scene-v1') { setMode('live'); setDemoCaseId(undefined); setBudgetAuthorized(false); setNotice('已选择受控摄像头场景。请填写对应需求与验收；原有 Mock 文本不会自动变成真实业务需求。场景行为与摄像头实机验收分别记录。'); } }}><option value="offline-single-html">离线单页 HTML 小型应用</option><option value="camera-scene-v1">摄像头交互 · 声明式三维粒子场景 v1</option></select></label>
            {capability === 'offline-single-html' ? <><div className="prod-presets" aria-label="三个 Mock 需求">{PRODUCTION_DEMO_CASES.map(item => <button type="button" key={item.id} aria-pressed={demoCaseId === item.operation} onClick={() => { setDemoCaseId(item.operation); setBrief(item.brief); setRequirement(caseRequirement(item)); }}>{item.title}</button>)}</div><p className="prod-caption">以上是团队自拟 Mock，不是来自实际业务的真实需求。夹具仅验证工程链路。</p></> : <p className="prod-camera-boundary">模型只生成受限场景 JSON，固定可信运行时负责渲染与本地摄像头识别。支持 cone / sphere / ring / star、聚散与旋转；不执行模型 HTML / JS。合成场景 Gate 不等于真实摄像头或完整需求通过。</p>}
            <label htmlFor="prod-brief">需求原话<textarea id="prod-brief" required minLength={3} maxLength={6000} value={brief} onChange={e => { setBrief(e.target.value); setDemoCaseId(undefined); }} placeholder="例如：做一个能筛选、统计和管理待办的页面…" /></label>
            <details className="prod-settings"><summary>需求来源与验收材料</summary><div className="prod-fields"><label htmlFor="prod-requirement-id">编号<input id="prod-requirement-id" required maxLength={80} value={requirement.id} onChange={e => setRequirement(previous => ({ ...previous, id: e.target.value }))} /></label><label htmlFor="prod-difficulty">难度<select id="prod-difficulty" aria-label="难度" value={requirement.difficulty} onChange={e => setRequirement(previous => ({ ...previous, difficulty: e.target.value as 'low' | 'medium' | 'high' }))}><option value="low">低：单页确定性功能</option><option value="medium">中：多状态交互</option><option value="high">高：复合逻辑</option></select></label><label className="prod-full" htmlFor="prod-source">来源<input id="prod-source" required maxLength={300} value={requirement.source} onChange={e => setRequirement(previous => ({ ...previous, source: e.target.value }))} /></label><label className="prod-full" htmlFor="prod-background">背景<textarea id="prod-background" maxLength={3000} value={requirement.background} onChange={e => setRequirement(previous => ({ ...previous, background: e.target.value }))} /></label><label className="prod-full" htmlFor="prod-acceptance">业务验收要求<textarea id="prod-acceptance" required maxLength={3000} value={requirement.acceptance} onChange={e => { setRequirement(previous => ({ ...previous, acceptance: e.target.value })); setDemoCaseId(undefined); }} /></label></div></details>
<div className="prod-mode-row"><fieldset className="prod-mode"><legend className="prod-visually-hidden">执行模式</legend><label><input type="radio" name="prod-mode" disabled={capability === 'camera-scene-v1'} checked={mode === 'demo'} onChange={() => setMode('demo')} />工程夹具 / Mock</label><label><input type="radio" name="prod-mode" disabled={capability === 'camera-scene-v1'} checked={mode === 'mock-jev'} onChange={() => setMode('mock-jev')} />Mock + 真实 Jev</label><label><input type="radio" name="prod-mode" checked={mode === 'live'} onChange={() => setMode('live')} />真实模型</label></fieldset><span className="prod-caption">{mode === 'demo' ? '不产生模型费用' : mode === 'mock-jev' ? '仅决策层为真实调用' : '使用本工作区页面配置'}</span></div>
            {mode === 'live' ? <label className="prod-verifier-engine" htmlFor="prod-verifier-engine">候选验证引擎<select id="prod-verifier-engine" aria-label="候选验证引擎" value={verifierEngine} onChange={e => setVerifierEngine(e.target.value as 'llm-rubric' | 'jev-cascade')}><option value="llm-rubric">LLM 序数评审</option><option value="jev-cascade">Jev 决策 → 不确定时 LLM 复核</option></select></label> : null}
            <details className="prod-settings"><summary>候选验证与有界执行预算</summary><p className="prod-caption">默认本地单次上限 5 USD，用于控制性价比；不是用户指定的总预算。双候选增加模型调用，Verifier 分数为序数评分，不是正确率。</p><div className="prod-fields">
              <label htmlFor="prod-candidates">每环节候选数<select id="prod-candidates" aria-label="每环节候选数" value={candidateCount} onChange={e => setCandidateCount(Number(e.target.value) as 1 | 2)}><option value="1">1 个（仍需验证）</option><option value="2">2 个（比较后选择）</option></select></label>
              <label htmlFor="prod-max-calls">最多模型调用<input id="prod-max-calls" type="number" required min={12} max={80} value={limits.maxCalls} onChange={e => setLimits(previous => ({ ...previous, maxCalls: Number(e.target.value) }))} /></label>
              <label htmlFor="prod-repairs">全局自动返修上限<input id="prod-repairs" type="number" required min={0} max={2} value={limits.maxRepairCycles} onChange={e => setLimits(previous => ({ ...previous, maxRepairCycles: Number(e.target.value) }))} /></label>
              <label htmlFor="prod-duration">时间上限（秒）<input id="prod-duration" type="number" required min={1} max={1800} value={limits.maxDurationMs / 1000} onChange={e => setLimits(previous => ({ ...previous, maxDurationMs: Number(e.target.value) * 1000 }))} /></label>
              <label htmlFor="prod-token-limit">总 Token 上限<input id="prod-token-limit" type="number" required min={2048} max={5000000} value={limits.maxTokens} onChange={e => setLimits(previous => ({ ...previous, maxTokens: Number(e.target.value) }))} /></label>
              <label htmlFor="prod-output-limit">每次输出 Token 上限<input id="prod-output-limit" type="number" required min={128} max={12000} value={limits.maxOutputTokens} onChange={e => setLimits(previous => ({ ...previous, maxOutputTokens: Number(e.target.value) }))} /></label>
              <label htmlFor="prod-cost-limit">单次估算费用上限<input id="prod-cost-limit" type="number" required min={0.01} max={10000} step={0.01} value={limits.maxCost} onChange={e => setLimits(previous => ({ ...previous, maxCost: Number(e.target.value) }))} /></label>
              <label htmlFor="prod-currency">币种<select id="prod-currency" aria-label="币种" value={limits.currency} onChange={e => setLimits(previous => ({ ...previous, currency: e.target.value as 'USD' | 'CNY' }))}><option value="USD">USD</option><option value="CNY">CNY</option></select></label>
            </div></details>
            {mode !== 'demo' ? <div className="prod-live-notice"><p>{mode === 'mock-jev' ? '研发与项目经理产物来自固定夹具；只有 Jev 决策真实，不能计为自主研发或良品率。' : liveMissing.length ? `请先在研发团队配置所有已选角色的 Key，以及与 ${limits.currency} 一致的每百万 Token 单价。当前 ${liveMissing.length} 个角色不满足。` : '六角色配置齐备。价格由你提供，账本为估算，不是供应商最终账单。'}</p>{mode === 'mock-jev' || verifierEngine === 'jev-cascade' ? <p>{jevReady ? `Jev 已启用：每维最低 ${jevConfig!.minScore}/4，分布集中度 ≥ ${jevConfig!.minConfidence}；这些门限尚未校准，不是正确率。` : '请在决策设置启用并配置 Jev Key；当前 Jev 预算只支持 USD。'}{mode === 'mock-jev' && !demoCaseId ? ' 自定义需求不适用固定夹具，请重新选择 Mock 需求。' : ''}</p> : null}<label className="prod-checkbox"><input type="checkbox" checked={budgetAuthorized} onChange={e => setBudgetAuthorized(e.target.checked)} />我授权本次在上述有限预算内执行真实调用；不迁移原项目 Key。</label></div> : !demoCaseId ? <p className="prod-live-notice">自定义需求或验收需要真实模型处理。请重新选择上方 Mock 需求运行对应的固定工程夹具，或切换真实模型。</p> : null}
            <div className="prod-launch"><p className="prod-caption">全局最多 {limits.maxRepairCycles} 次自动返修：阶段生成纠错与 Gate 返修共用该预算；超限、超时、验证拒绝会保存失败证据，不会无限循环。</p><button className="prod-button prod-primary" disabled={!canLaunch} type="submit"><Mark />{busy ? '正在处理…' : mode === 'demo' ? '运行 Mock 链路' : mode === 'mock-jev' ? '运行 Mock + Jev 验证' : '启动真实生产'}</button></div>
          </form>
          <aside className="prod-panel prod-team-selector"><div className="prod-section-heading"><h2>本次研发团队</h2><button className="prod-link-button" type="button" onClick={() => setView('team')}>配置团队</button></div>{ROLE_ORDER.map(role => { const chosen = agents.find(agent => agent.id === selection[role]); return <div className="prod-team-slot" key={role}><span className={`prod-role prod-role-${role}`}>{ROLE_INFO[role].initials}</span><div><label htmlFor={`prod-agent-${role}`}>{ROLE_INFO[role].label}<select id={`prod-agent-${role}`} aria-label={`${ROLE_INFO[role].label} Agent`} value={selection[role] ?? ''} onChange={e => setSelection(previous => ({ ...previous, [role]: e.target.value }))}><option value="" disabled>请选择启用的角色 Agent</option>{agents.filter(agent => agent.role === role && agent.enabled).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><small>{chosen ? `${chosen.provider} · ${chosen.modelId}` : '尚未配置'}</small></div><span className={`prod-key-status ${chosen?.hasApiKey ? 'ready' : ''}`}>{chosen?.hasApiKey ? 'Key 已配置' : '无 Key'}</span></div>; })}<p className="prod-caption prod-team-footnote">每个角色可使用独立模型。不同 Model ID 仅说明配置不同，不证明底层权重独立。Key 不会在页面回显。</p></aside>
        </div>
        <div className="prod-section-heading prod-history-heading"><div><h2>执行与交付</h2><span className="prod-caption">全部启动尝试保留在账本</span></div><label className="prod-history-select" htmlFor="prod-history">选择运行<select id="prod-history" aria-label="选择运行" value={run?.id ?? ''} onChange={e => void selectRun(e.target.value)}><option value="" disabled>暂无运行</option>{runs.map(item => <option key={item.id} value={item.id}>{item.input.requirement.id} · {item.evidenceKind === 'real-model' ? '真实' : 'Mock'} · {STATUS[item.status]} · {item.createdAt.slice(11, 19)}</option>)}</select></label></div>
        {run ? <RunDetail run={run} detail={detail} setDetail={setDetail} preview={preview} setPreview={setPreview} cancel={cancel} busy={busy} /> : <div className="prod-empty"><Mark /><h3>等待第一份交付证据</h3><p>先运行 Mock 查看端到端流程；真实模型通过冻结 Gate 后，才会计入自主交付成功。</p></div>}
      </> : null}
      {view === 'decision' ? <JevSettings onConfigChange={setJevConfig} /> : null}
      {view === 'team' ? <><div className="prod-section-heading"><p className="prod-muted">预设角色可复制与重配。API Key 仅写入本分支控制面，不写入 Prompt、源码、日志或导出。</p><button className="prod-button prod-primary" type="button" onClick={() => setEditing('new')}>创建 Agent</button></div><div className="prod-agent-grid">{agents.map(agent => <article className="prod-panel prod-agent-card" key={agent.id}><div className="prod-agent-top"><span className={`prod-role prod-role-${agent.role}`}>{ROLE_INFO[agent.role].initials}</span><span className={`prod-pill ${agent.enabled ? '' : 'prod-pill-muted'}`}>{agent.enabled ? '已启用' : '已停用'}</span></div><h2>{agent.name}</h2><p className="prod-muted">{ROLE_INFO[agent.role].label} · {ROLE_INFO[agent.role].responsibility}</p><dl><div><dt>Provider / Model</dt><dd>{agent.provider} / {agent.modelId}</dd></div><div><dt>Base URL</dt><dd>{agent.baseUrl}</dd></div><div><dt>API Key</dt><dd>{agent.hasApiKey ? '已配置 · 仅显示脱敏状态' : '未配置'}</dd></div><div><dt>每百万 Token 估算单价</dt><dd>{agent.pricing ? `输入 ${agent.pricing.inputPerMillion} / 输出 ${agent.pricing.outputPerMillion} ${agent.pricing.currency}` : 'unknown · 未填写价格'}</dd></div></dl><div className="prod-agent-actions"><button className="prod-button" type="button" onClick={() => setEditing(agent)}>编辑</button><button className="prod-button" disabled={busy} type="button" onClick={() => void changeAgent('clone', agent)}>复制</button><button className="prod-button prod-danger" disabled={busy} type="button" onClick={() => void changeAgent('delete', agent)}>删除</button></div></article>)}</div></> : null}
{view === 'report' ? <section className="prod-report"><div className="prod-metrics"><Metric label="真实模型启动尝试" value={String(realRuns.length)} note="包括失败、取消与中断" /><Metric label="真实自主交付良品率" value={goodRate} note={`${realPassed.length} 次完整验收通过 / ${realTerminal.length} 次终态尝试（含失败、取消、中断与摄像头完整验收待验证）`} /><Metric label="工程 / Mock 尝试" value={String(fixtureRuns.length)} note="不计入真实模型良品率" /><Metric label="实际业务需求" value={String(new Set(realRuns.filter(item => item.input.requirement.kind === 'user-declared-real').map(item => item.input.requirement.id)).size)} note="当前三个需求明确为 Mock" /></div><div className="prod-panel prod-report-body"><h2>七项申报材料的证据入口</h2><p>输入快照、模型配置、Prompt、候选评审、冻结契约、浏览器 Gate、原始调用和成本口径按运行留存。预测增效与未来能力须单独标注，不能充当实测。</p><a className="prod-button" href="/api/production/report" target="_blank" rel="noreferrer noopener">查看申报证据汇总 JSON</a><ol><li>基本信息与团队：六角色配置、管线类型与范围。</li><li>管线设计：项目经理有限闭环、候选 Verifier 与不可绕过的行为门禁。</li><li>需求清单：至少三项自拟 Mock；不冒充真实业务需求。</li><li>执行记录：从工作台选择运行，下载输入、证据与最终交付物。</li><li>指标统计：真实模型与工程夹具分开统计，unknown 不记作零。</li><li>归因改进：失败运行与 Gate 原始结果保留，不覆盖负结果。</li><li>L4 自评：依据有界操作定义；无官方参考文件，不宣称官方认证。</li></ol><aside className="prod-boundary">已接入 TypeSafe Jev HTTP 类型化决策，实测质量与用量以原始记录为准。开源 AnyJev 的本地推断与标注校准仍是下一阶段参考；LLM 序数评审不是原论文 score-token 算法的复现。</aside></div></section> : null}
      <footer className="prod-footer"><span>独立生产研发线 · 不修改冻结申报基线</span><span>实测 / 夹具 / 预测 / 待办分别标注</span></footer>
    </main>
    {editing ? <AgentEditor key={editing === 'new' ? 'new' : editing.id} agent={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); try { await refreshAgents(); setNotice('Agent 配置已保存，输入的 Key 已从编辑器清除。'); } catch (e) { setError(e instanceof Error ? `配置已保存，但刷新团队失败：${e.message}` : '配置已保存，但刷新团队失败。'); } }} /> : null}
  </div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <div className="prod-panel prod-metric"><small>{label}</small><strong>{value}</strong><p>{note}</p></div>;
}

function unobservedJevRequest(evaluation: JevEvaluation): boolean {
  return !evaluation.usage.complete && evaluation.providerRequests === 0 && evaluation.durationMs === 0 && evaluation.requestSnapshot == null && evaluation.rawResponse == null && evaluation.modelIdReturned == null && evaluation.httpStatus == null && !evaluation.error;
}

function JevDecisionEvidence({ calls, snapshot }: { calls: NonNullable<ProductionRun['jevCalls']>; snapshot?: JevPublicConfig }) {
  const labels: Record<JevEvaluation['status'], string> = { accepted: '接受候选', uncertain: '不确定 → 需复核', rejected: '拒绝候选', error: '请求 / 契约错误' };
  const dimensions = { coverage: '验收覆盖', consistency: '约束一致性', scope: '范围可执行性' };
  return <section className="prod-jev-evidence" aria-label="Jev 决策证据"><h3>Jev 类型化决策记录</h3><p className="prod-muted">每维分数是等级分布加权值（0–4）；confidence 是分布集中度，不是答案正确率。{snapshot ? `本次冻结门限：每维 ≥ ${snapshot.minScore}，集中度 ≥ ${snapshot.minConfidence}。` : ''}通过决策不代表通过最终行为 Gate。</p>{calls.map(call => <article className="prod-verification" key={call.id}><div className="prod-section-heading"><h3>{call.phase}</h3><span className={`prod-pill ${call.evaluation.status === 'accepted' ? '' : 'prod-pill-warning'}`}>{unobservedJevRequest(call.evaluation) ? '请求意图未完成 / 未观测' : labels[call.evaluation.status]}</span></div><p>{call.evaluation.reason}</p><p className="prod-caption">{call.evaluation.modelIdReturned ?? call.evaluation.modelIdRequested} · 实际请求 {unobservedJevRequest(call.evaluation) ? '未观测 / unknown' : call.evaluation.providerRequests} · 选中 {call.evaluation.selectedCandidateId ?? '无'} · 估算费用 {call.evaluation.usage.estimatedCost == null ? 'unknown' : `${call.evaluation.usage.estimatedCost.toFixed(6)} USD`}</p>{call.evaluation.scores.map(candidate => <div className="prod-jev-candidate" key={candidate.candidateId}><code>{candidate.candidateId}</code><dl>{Object.entries(candidate.dimensions).map(([dimension, answer]) => <div key={dimension}><dt>{dimensions[dimension as keyof typeof dimensions]}</dt><dd>加权分数 <b>{answer.score.toFixed(3)} / 4</b><span>分布集中度 {answer.confidence.toFixed(3)}</span></dd></div>)}</dl><p className="prod-caption">Noul 范围判断 p(yes) = {candidate.scopeProbability.toFixed(3)}；派生集中度 = {candidate.scopeCertainty.toFixed(3)}。{candidate.qualified ? '满足该候选门限。' : '未满足全部候选门限。'}</p></div>)}{call.evaluation.choice ? <p className="prod-caption prod-jev-choice">Choice：{call.evaluation.choice.choice} · 分布集中度 {call.evaluation.choice.confidence.toFixed(3)}</p> : null}<details className="prod-output"><summary>完整分布、原始响应、请求快照与配置 hash</summary><pre>{JSON.stringify({ phase: call.phase, startedAt: call.startedAt, configHash: call.configHash, evaluation: call.evaluation }, null, 2)}</pre></details></article>)}</section>;
}

function RunDetail({ run, detail, setDetail, preview, setPreview, cancel, busy }: { run: ProductionRun; detail: 'events' | 'verifier' | 'delivery' | 'calls'; setDetail: (value: 'events' | 'verifier' | 'delivery' | 'calls') => void; preview: boolean; setPreview: (value: boolean) => void; cancel: () => Promise<void>; busy: boolean }) {
  const globalRepairPolicy = run.repairPolicyVersion === 'production-global-repair-v1';
  const gateFailureLabel = run.gate?.failureKind === 'infrastructure' ? '执行环境失败' : run.gate?.failureKind === 'timeout' ? '执行器总时限耗尽' : null;
  const html = run.artifacts.find(artifact => artifact.name.endsWith('.html') || artifact.type === 'text/html');
  const isCamera = run.input.capability === 'camera-scene-v1';
  const sceneArtifact = run.artifacts.find(artifact => artifact.name === 'scene.json');
  const cameraPreviewReady = isCamera && !!sceneArtifact && run.status === 'completed' && !!run.cameraVerification?.boundedScenePassed;
  const latestRole = run.events.at(-1)?.role;
  const jevCalls = run.jevCalls ?? [];
  const unknownJevIntents = jevCalls.filter(call => unobservedJevRequest(call.evaluation)).length;
  const knownJevRequests = jevCalls.filter(call => !unobservedJevRequest(call.evaluation)).reduce((sum, call) => sum + call.evaluation.providerRequests, 0);
  const isHybrid = run.evidenceKind === 'fixture-with-real-jev';
  return <section className="prod-panel prod-run-detail" aria-label="当前运行详情">
<div className="prod-run-header"><div><span className={`prod-status prod-status-${run.status}`}>{isCamera && run.status === 'completed' ? '场景行为通过' : STATUS[run.status]}</span><span className="prod-pill">{run.evidenceKind === 'real-model' ? '真实模型证据' : isHybrid ? '固定研发夹具 + 真实 Jev' : run.evidenceKind === 'fixture' ? 'Mock / 工程夹具' : '注入测试'}</span><strong>{run.input.requirement.id}</strong><code>{run.id}</code></div>{active(run) ? <button className="prod-button prod-danger" type="button" disabled={busy} onClick={() => void cancel()}>取消任务</button> : null}</div>
    {run.evidenceKind !== 'real-model' ? <p className="prod-fixture-note">{isHybrid ? '研发和项目经理输出是固定夹具，仅 Jev 决策层真实且收费；这是混合验证，不是自主生成产品。' : '该记录用于工程与浏览器行为验证，不代表平台内部真实 Agent 自主交付成功。'}</p> : null}
    {isCamera ? <aside className="prod-camera-boundary"><b>{run.cameraVerification?.boundedScenePassed ? '场景行为通过，摄像头待实机验收' : '摄像头场景：行为验证尚未通过'}</b><p>合成关键点验证的是受控场景行为；视觉模型质量、真实摄像头和完整需求均未验收，不计入完整自主交付良品率。</p>{run.cameraVerification ? <details className="prod-output"><summary>场景验证范围与限制</summary><pre>{JSON.stringify(run.cameraVerification, null, 2)}</pre></details> : null}</aside> : null}
    <div className="prod-loop"><b>项目经理闭环</b><span>思考 → 设计 → 实施 → 测试 → 反馈 → 再规划</span><strong>{globalRepairPolicy ? '全局返修' : run.repairPolicyVersion ? '未知版本返修' : '旧版研发 / Gate 返修'} {run.repairs} / {run.input.limits.maxRepairCycles}</strong></div>
    <RepairHistory run={run} />
    <div className="prod-run-roles">{ROLE_ORDER.map(role => { const called = run.calls.some(call => call.role === role); const events = run.events.some(event => event.role === role); return <div className={latestRole === role && active(run) ? 'current' : ''} key={role}><span className={`prod-role prod-role-${role}`}>{ROLE_INFO[role].initials}</span><span>{ROLE_INFO[role].label}<small>{latestRole === role && active(run) ? '当前环节' : called ? `${run.calls.filter(call => call.role === role).length} 次调用` : events ? '已有事件' : '待执行'}</small></span></div>; })}</div>
    <div className="prod-run-summary"><span>时间 <b>{run.durationMs == null ? active(run) ? '进行中' : 'unknown' : `${(run.durationMs / 1000).toFixed(1)}s`}</b></span><span>{run.evidenceKind === 'fixture' || isHybrid ? '模拟环节记录' : '角色调用记录'} <b>{run.calls.length}</b></span><span>调用预算记录 <b>{run.calls.length + jevCalls.length} / {run.input.limits.maxCalls}</b></span>{jevCalls.length ? <span>Jev 实际请求 <b>{unknownJevIntents ? `unknown（已知 ${knownJevRequests} 次；${unknownJevIntents} 个请求意图未观测）` : knownJevRequests}</b></span> : null}<span>输入 / 输出 Token <b>{format(run.usage.inputTokens)} / {format(run.usage.outputTokens)}</b></span><span>估算费用 <b>{run.usage.estimatedCost == null ? 'unknown' : `${run.usage.estimatedCost.toFixed(6)} ${run.usage.currency}`}</b></span></div>
    {run.error ? <p className="prod-run-error" role="alert">{run.error}</p> : null}
    <nav className="prod-detail-tabs" aria-label="运行详情分组">{([['events', '执行链路'], ['verifier', '候选验证'], ['delivery', '门禁与交付'], ['calls', '原始调用']] as const).map(([value, label]) => <button type="button" aria-pressed={detail === value} key={value} onClick={() => setDetail(value)}>{label}<small>{value === 'calls' ? run.calls.length : value === 'verifier' ? run.verifications.length : value === 'events' ? run.events.length : run.artifacts.length}</small></button>)}</nav>
    <div className="prod-detail-body">
      {detail === 'events' ? <><ol className="prod-events">{run.events.map(event => <li key={event.id}><time dateTime={event.time}>{new Date(event.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><span className="prod-event-role">{event.role ? ROLE_INFO[event.role].label : event.phase}</span><p>{event.message}</p></li>)}</ol><details className="prod-output"><summary>输入快照与已选角色产物（{run.outputs.length}）</summary><pre>{JSON.stringify({ input: run.input, agentSnapshot: run.agentSnapshot, outputs: run.outputs }, null, 2)}</pre></details></> : null}
{detail === 'verifier' ? <><p className="prod-muted">每个候选均经过结构预检与评审，包括单候选。LLM 序数评分不代表概率；Jev 分布与集中度单独展示。所有验证器都不能放宽冻结 Gate。评分仅在展示时保留两位小数，不改变原始数值、选择结果或门限。</p>{run.verifications.length ? run.verifications.map((verification, index) => <article className="prod-verification" key={`${verification.phase}-${index}`}><div className="prod-section-heading"><h3>{verification.phase}</h3><span className={`prod-pill ${verification.decision === 'abstain' ? 'prod-pill-warning' : ''}`}>{verification.decision === 'accept' ? '选择候选' : '拒绝 / 弃权'}</span></div><p>{verification.reason}</p><p className="prod-caption">选中 ID：{verification.selectedCandidateId ?? '无'} · 评审标准 hash：<code>{verification.criteriaHash}</code></p>{verification.scores.map(score => <div className="prod-score" key={score.candidateId}><b>评分 {displayScore(score.score)}{verification.engine === 'jev' ? '（管线排序值）' : ' / 5'}</b><code>{score.candidateId}</code><p>{score.reason}</p></div>)}</article>) : <p className="prod-empty-text">尚无候选评审结果。</p>}{jevCalls.length ? <JevDecisionEvidence calls={jevCalls} snapshot={run.jevSnapshot} /> : null}</> : null}
{detail === 'delivery' ? <><div className="prod-contract"><h3>冻结验收契约</h3>{run.frozenContract ? <><p>版本 <b>{run.frozenContract.version}</b> · 冻结于 {run.frozenContract.frozenAt}</p><code>{run.frozenContract.hash}</code><details className="prod-output"><summary>查看不可在返修中放宽的检查快照</summary><pre>{JSON.stringify(run.frozenContract, null, 2)}</pre></details></> : <p className="prod-muted">尚未冻结。研发开始前必须完成业务与测试契约冻结。</p>}</div><div className="prod-gate"><h3>{isCamera ? run.gate ? run.gate.passed ? '场景行为 Gate：通过（合成输入）' : '场景行为 Gate：未通过' : '场景行为 Gate：未执行' : run.gate ? run.gate.passed ? '最终行为 Gate：通过' : '最终行为 Gate：未通过' : '最终行为 Gate：未执行'}</h3>{gateFailureLabel ? <p className="prod-boundary prod-gate-failure-kind">{gateFailureLabel}：{active(run) ? '停止处理中' : '已停止'}，未作为代码质量返修。</p> : null}{run.gate?.summary ? <p>{run.gate.summary}</p> : null}{run.gate?.checks.map((check, index) => <div className={`prod-check ${check.passed ? '' : 'failed'}`} key={`${check.name}-${index}`}><span>{check.passed ? '通过' : '失败'}</span><b>{check.name}</b>{check.detail ? <p>{check.detail}</p> : null}</div>)}{run.gateHistory.length ? <details className="prod-output"><summary>全部 Gate 尝试（{run.gateHistory.length}）</summary><pre>{JSON.stringify(run.gateHistory, null, 2)}</pre></details> : null}</div><div className="prod-artifacts"><h3>交付物与证据</h3>{run.artifacts.length ? <div className="prod-artifact-list">{run.artifacts.map(artifact => <a className="prod-button" key={artifact.name} href={artifactUrl(run.id, artifact.name)} download={artifact.name}>{artifact.name}<small>{artifact.type}</small></a>)}</div> : <p className="prod-muted">尚无交付物。失败不会被替换成模板成功。</p>}<p className="prod-caption prod-download-warning">HTML 仅以源码文本下载。下载后在其他环境运行不再受平台隔离保护，不能视为网络安全承诺。</p></div>{cameraPreviewReady ? <section className="prod-camera-delivery" aria-label="受控摄像头场景预览"><h3>声明式场景交互预览</h3><p className="prod-caption">新窗口只运行固定平台代码与已校验的场景数据，摄像头默认关闭。请手动授权；画面留在本机。场景 Gate 通过不能替代实机验收。</p><a className="prod-button prod-primary" href={`/api/production/runs/${encodeURIComponent(run.id)}/scene-preview`} target="_blank" rel="noopener noreferrer">打开受控场景预览</a><p className="prod-caption">关闭预览或停止摄像头会释放识别资源；不会恢复生成 HTML 的执行型 iframe。</p></section> : isCamera ? <p className="prod-camera-boundary">场景行为 Gate 尚未通过，交互预览未开放；可以下载已有场景与失败证据。</p> : null}{!isCamera && html ? <div className="prod-preview"><div><p>受控浏览器静态截图 · 不是实时交互预览</p><button className="prod-button" type="button" onClick={() => setPreview(!preview)}>{preview ? '关闭预览' : '打开运行预览'}</button></div><p className="prod-caption prod-preview-explanation">不在你的浏览器执行生成脚本。行为验收来自独立 Gate，截图不替代测试，也不证明产物安全。</p>{preview ? <ControlledPreview key={run.id} run={run} /> : null}</div> : null}</> : null}
      {detail === 'calls' ? <><p className="prod-muted">{run.evidenceKind === 'fixture' || isHybrid ? '以下研发角色记录均为固定工程夹具的模拟环节记录，模型字段仅是配置快照；实际研发模型请求数为 0；Jev 原始决策在下方单独列出。' : '保留各次原始输出、错误与使用量；所选与被拒绝的候选均可追溯。'}不记录模型隐藏思维链。</p>{run.calls.length ? run.calls.map(call => <details className="prod-output" key={call.id}><summary><span>{ROLE_INFO[call.role].label} · {call.phase}</span><span className="prod-pill">{call.error ? '调用失败' : call.selected ? '已选择' : '未选择 / 评审调用'}</span></summary><div className="prod-call-meta"><p>{call.executionSource === 'mock' || run.evidenceKind === 'fixture' ? '未请求此模型 · 配置快照：' : ''}{call.model.provider} / {call.model.modelId} · {call.startedAt}</p><p>输入 {format(call.usage.inputTokens)} / 输出 {format(call.usage.outputTokens)} Token · 估算费用 {call.usage.estimatedCost == null ? 'unknown' : `${call.usage.estimatedCost.toFixed(4)} ${call.usage.currency}`}</p><p>Prompt {call.promptVersion} · <code>{call.promptHash}</code></p>{call.error ? <p className="prod-run-error">{call.error}</p> : null}</div><pre>{call.rawOutput || '（未收到输出）'}</pre><details className="prod-prompt"><summary>调用输入 Prompt 与配置 hash</summary><pre>{JSON.stringify({ candidateId: call.candidateId, configHash: call.configHash, systemPrompt: call.systemPrompt, userPrompt: call.userPrompt }, null, 2)}</pre></details></details>) : <p className="prod-empty-text">尚无请求或模拟环节记录。</p>}{jevCalls.length ? <JevDecisionEvidence calls={jevCalls} snapshot={run.jevSnapshot} /> : null}</> : null}
    </div>
  </section>;
}

function RepairHistory({ run }: { run: ProductionRun }) {
  const globalPolicy = run.repairPolicyVersion === 'production-global-repair-v1';
  const history = run.repairHistory;
  return <details className="prod-output" aria-label="返修历史与计数口径"><summary>返修历史与计数口径</summary>
    <p className="prod-caption">{globalPolicy ? '全局自动返修池：阶段生成纠错与 Gate 返修合计消耗同一上限。attempt 是全局已消耗序号，不是各环节独立次数。' : run.repairPolicyVersion ? '该记录的返修策略版本无法识别，计数口径未验证；不按当前全局池解释。' : '旧版记录：计数为旧版研发 / Gate 返修，不按当前全局返修池解释。旧记录不会被迁移或补记。'}</p>
    <p className="prod-caption">策略版本：<code>{run.repairPolicyVersion ?? '未记录（旧版）'}</code></p>
    {!run.repairPolicyVersion && !history ? <p className="prod-live-notice">旧运行未记录全局返修历史；阶段生成前纠错的消耗不可追溯，不补记为 0。</p> : !history ? <p className="prod-live-notice">返修明细未记录 / unknown。不能把缺失账本解释成没有返修。</p> : history.length === 0 ? <p className="prod-caption">{run.repairs === 0 && globalPolicy ? '全局返修尚未消耗；当前账本明确为空。' : `当前明细账本为空，但计数记录为 ${run.repairs}；未推定没有返修。`}</p> : <section aria-label="已记录返修条目">{history.map(entry => <article className="prod-verification" key={entry.id}>
      <div className="prod-section-heading"><h3>第 {entry.attempt} 次 · {entry.kind === 'stage-regeneration' ? '阶段生成纠错' : entry.kind === 'gate-repair' ? 'Gate 返修' : '未知返修来源'}</h3><span className="prod-pill">{ROLE_INFO[entry.role]?.label ?? entry.role} · {entry.phase}</span></div>
      <p>{entry.reason}</p><p className="prod-caption"><time dateTime={entry.time}>{entry.time}</time> · 条目 ID：<code>{entry.id}</code></p>
      <p className="prod-caption">被拒绝候选引用：{entry.rejectedCandidateIds.length ? entry.rejectedCandidateIds.map((candidateId, index) => <span key={candidateId}>{index ? '；' : ''}<code>{candidateId}</code></span>) : '该条目明确未引用候选'}</p>
      <p className="prod-caption">冻结 hash：<code>{entry.frozenHash ?? '未记录 / null'}</code>（原始记录；不替换为当前 hash）</p>
    </article>)}</section>}
  </details>;
}

function ControlledPreview({ run }: { run: ProductionRun }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return <div className="prod-controlled-preview">
    {state === 'failed' ? <p className="prod-run-error" role="alert">受控截图生成失败。请查看 Gate 与源码证据；不会回退为在浏览器执行 HTML。</p> : <><p className="prod-caption" role="status">{state === 'loading' ? '正在生成受控浏览器截图…' : '截图已载入；不是实时交互预览。'}</p><img className="prod-preview-image" src={`/api/production/runs/${encodeURIComponent(run.id)}/preview`} alt={`受控浏览器截图 ${run.input.requirement.id}`} width={1280} height={900} onLoad={() => setState('loaded')} onError={() => setState('failed')} referrerPolicy="no-referrer" /></>}
  </div>;
}

function AgentEditor({ agent, onClose, onSaved }: { agent?: ProductionAgent; onClose: () => void; onSaved: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(agent?.name ?? '新的研发 Agent');
  const [role, setRole] = useState<ProductionRole>(agent?.role ?? 'developer');
  const [provider, setProvider] = useState<ProductionAgent['provider']>(agent?.provider ?? 'deepseek');
  const [baseUrl, setBaseUrl] = useState(agent?.baseUrl ?? 'https://api.deepseek.com');
  const [modelId, setModelId] = useState(agent?.modelId ?? 'deepseek-chat');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [enabled, setEnabled] = useState(agent?.enabled ?? true);
  const [inputPrice, setInputPrice] = useState(agent?.pricing?.inputPerMillion.toString() ?? '');
  const [outputPrice, setOutputPrice] = useState(agent?.pricing?.outputPerMillion.toString() ?? '');
  const [currency, setCurrency] = useState<'USD' | 'CNY'>(agent?.pricing?.currency ?? 'USD');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const endpointChanged = !!agent && (provider !== agent.provider || baseUrl.trim() !== agent.baseUrl);
  useEffect(() => { dialog.current?.showModal(); }, []);
  function close() { setApiKey(''); dialog.current?.close(); onClose(); }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const secret = apiKey.trim();
    setApiKey('');
    try {
      if ((inputPrice === '') !== (outputPrice === '')) throw new Error('输入与输出 Token 单价需要同时填写，或同时留空。');
      const value: ProductionAgentInput = { name, role, provider, baseUrl, modelId, enabled, pricing: inputPrice === '' ? null : { inputPerMillion: Number(inputPrice), outputPerMillion: Number(outputPrice), currency }, ...(secret ? { apiKey: secret } : clearKey || endpointChanged ? { apiKey: null } : {}) };
      await request(agent ? `/agents/${agent.id}` : '/agents', json(value, agent ? 'PATCH' : 'POST'));
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); setBusy(false); }
  }
  return <dialog ref={dialog} className="prod-agent-dialog" aria-labelledby="prod-editor-heading" onCancel={event => { event.preventDefault(); close(); }}><form onSubmit={save}><div className="prod-section-heading"><h2 id="prod-editor-heading">{agent ? '编辑 Agent' : '创建 Agent'}</h2><button className="prod-close" type="button" aria-label="关闭 Agent 配置" onClick={close}>×</button></div><p className="prod-caption">Key 不回显、不保存在浏览器存储；提交后输入框立即清空。新 Key 至少 16 个可见 ASCII 字符，不含引号、反斜线或空白；留空不迁移其他研发线的配置。</p>{error ? <p className="prod-run-error" role="alert">{error}</p> : null}<div className="prod-fields"><label className="prod-full" htmlFor="prod-editor-name">Agent 名称<input id="prod-editor-name" required maxLength={80} value={name} onChange={e => setName(e.target.value)} /></label><label htmlFor="prod-editor-role">角色<select id="prod-editor-role" aria-label="角色" value={role} onChange={e => setRole(e.target.value as ProductionRole)}>{ROLE_ORDER.map(value => <option key={value} value={value}>{ROLE_INFO[value].label}</option>)}</select></label><label htmlFor="prod-editor-provider">Provider<select id="prod-editor-provider" aria-label="Provider" value={provider} onChange={e => setProvider(e.target.value as ProductionAgent['provider'])}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI-compatible</option><option value="anthropic">Anthropic</option></select></label><label className="prod-full" htmlFor="prod-editor-base-url">Base URL<input id="prod-editor-base-url" type="url" required maxLength={500} value={baseUrl} onChange={e => setBaseUrl(e.target.value)} /></label><label className="prod-full" htmlFor="prod-editor-model">Model ID<input id="prod-editor-model" required maxLength={150} value={modelId} onChange={e => setModelId(e.target.value)} /></label><label className="prod-full" htmlFor="prod-editor-key">API Key（{agent?.hasApiKey ? '已配置；留空保留原值' : '未配置'}）<input id="prod-editor-key" name="new-agent-api-key" type="password" minLength={16} pattern={"(?!.*[\"'\\\\])[\\x21-\\x7e]{16,500}"} title="新 Key 至少 16 个可见 ASCII 字符；不含引号、反斜线或空白" autoComplete="new-password" spellCheck={false} maxLength={500} value={apiKey} disabled={clearKey} onChange={e => setApiKey(e.target.value)} placeholder="只输入新 Key，不回显现有 Key" /></label>{agent?.hasApiKey ? <label className="prod-checkbox prod-full"><input type="checkbox" checked={clearKey} onChange={e => { setClearKey(e.target.checked); setApiKey(''); }} />清除已保存的 Key</label> : null}{endpointChanged ? <p className="prod-live-notice prod-full">Provider 或 Base URL 已改变：如果不填新 Key，旧 Key 会被清除，避免发送到其他服务。</p> : null}<label htmlFor="prod-editor-input-price">输入 / 百万 Token<input id="prod-editor-input-price" type="number" min={0} max={10000} step="any" value={inputPrice} placeholder="未知可留空" onChange={e => setInputPrice(e.target.value)} /></label><label htmlFor="prod-editor-output-price">输出 / 百万 Token<input id="prod-editor-output-price" type="number" min={0} max={10000} step="any" value={outputPrice} placeholder="未知可留空" onChange={e => setOutputPrice(e.target.value)} /></label><label htmlFor="prod-editor-price-currency">定价币种<select id="prod-editor-price-currency" aria-label="定价币种" value={currency} onChange={e => setCurrency(e.target.value as 'USD' | 'CNY')}><option value="USD">USD</option><option value="CNY">CNY</option></select></label><label className="prod-checkbox"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />启用此 Agent</label></div><div className="prod-dialog-actions"><button className="prod-button" type="button" onClick={close}>取消</button><button className="prod-button prod-primary" type="submit" disabled={busy}>{busy ? '保存中…' : '保存配置'}</button></div></form></dialog>;
}
