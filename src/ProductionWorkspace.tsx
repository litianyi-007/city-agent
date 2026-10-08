import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProductionAgent, ProductionAgentInput, ProductionCapability, ProductionRole, ProductionRun, ProductionRunInput, ProductionVerification } from '../shared/production-schema';
import { PRODUCTION_DEFAULT_MODEL_ID } from '../shared/production-schema';
import type { ProductionLaunchPreflightReport } from '../shared/production-launch-preflight';
import { PRODUCTION_DEMO_CASES } from '../shared/production-benchmarks';
import { isUnresolvedJevIntent, productionRequestCounts, projectProductionLedger } from '../shared/production-ledger';
import type { JevEvaluation, JevPublicConfig } from '../shared/jev-schema';
import JevSettings from './JevSettings';
import VerifierStudyPanel from './VerifierStudyPanel';
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
type CameraBusinessConstraints = NonNullable<ProductionRunInput['cameraBusinessConstraints']>;
function emptyRequirement(): ProductionRunInput['requirement'] {
  return { id: '', source: '', background: '', acceptance: '', difficulty: 'low', kind: 'illustrative' };
}
const format = (value: number | null | undefined) => value == null ? 'unknown' : new Intl.NumberFormat('zh-CN').format(value);
const displayScore = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : 'unknown';
const displayCost = (value: number | null) => value == null || !Number.isFinite(value) || value < 0 ? 'unknown' : value > 0 && value < 0.00000001 ? value.toExponential(3) : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 8 }).format(value);
const active = (run: ProductionRun | null) => !!run && ['queued', 'running'].includes(run.status);
const artifactUrl = (runId: string, name: string) => `/api/production/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(name)}`;
const jevEvidenceId = (callId: string) => `prod-jev-call-${encodeURIComponent(callId)}`;
const VERIFICATION_ENGINE_LABELS: Record<NonNullable<ProductionVerification['engine']>, string> = {
  'llm-rubric': 'LLM 序数评审',
  jev: 'Jev 类型化决策',
  'jev-llm-fallback': '独立 LLM 复核（Jev 不确定）',
  'jev-llm-protocol-fallback': '独立 LLM 复核（Jev 算术异常）',
};

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
  const [cameraBusinessConstraints, setCameraBusinessConstraints] = useState<CameraBusinessConstraints>({});
  const [verifierEngine, setVerifierEngine] = useState<'llm-rubric' | 'jev-cascade'>('llm-rubric');
  const [requireImplementationEvidence, setRequireImplementationEvidence] = useState(false);
  const [jevConfig, setJevConfig] = useState<JevPublicConfig | null>(null);
  const [candidateCount, setCandidateCount] = useState<1 | 2>(1);
  const [limits, setLimits] = useState(DEFAULT_LIMITS);
  const [budgetAuthorized, setBudgetAuthorized] = useState(false);
  const [requirementOpen, setRequirementOpen] = useState(false);
  const [detail, setDetail] = useState<'events' | 'verifier' | 'delivery' | 'calls'>('events');
  const [preview, setPreview] = useState(false);
  const [launchPreflight, setLaunchPreflight] = useState<ProductionLaunchPreflightReport | null>(null);
  const [preparingLaunch, setPreparingLaunch] = useState(false);
  const preparationEpoch = useRef(0);
  const preparationController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const selectionRequest = useRef(0);
  const submissionPending = useRef(false);
  const briefInput = useRef<HTMLTextAreaElement>(null);
  const handleJevConfigChange = useCallback((value: JevPublicConfig) => { setJevConfig(value); setBudgetAuthorized(false); }, []);

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    Promise.all([request<ProductionAgent[]>('/agents', undefined, controller.signal), request<ProductionRun[]>('/runs', undefined, controller.signal)])
      .then(([team, history]) => {
        setAgents(team); setRuns(history); setRun(history[0] ?? null);
        setSelection(Object.fromEntries(ROLE_ORDER.map(role => [role, team.find(agent => agent.role === role && agent.enabled)?.id])));
      }).catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { mounted.current = false; controller.abort(); preparationController.current?.abort(); };
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
      const version = selectionRequest.current;
      try {
        const [next, history] = await Promise.all([request<ProductionRun>(`/runs/${run!.id}`, undefined, controller.signal), request<ProductionRun[]>('/runs', undefined, controller.signal)]);
        if (controller.signal.aborted) return;
        if (selectionRequest.current === version) setRun(previous => previous?.id === next.id ? next : previous);
        setRuns(history);
        if (active(next)) timer = setTimeout(poll, 1200);
      } catch (e) {
        if (!controller.signal.aborted) { if (selectionRequest.current === version) setError(e instanceof Error ? e.message : '更新运行状态失败'); timer = setTimeout(poll, 2500); }
      }
    };
    timer = setTimeout(poll, 500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [run?.id, run?.status]);

  async function refreshAgents() {
    invalidateLaunchPreflight();
    // A successful save may already have changed the server-side Key/model.
    // Revoke the old consent before even a failed or delayed public refresh.
    setBudgetAuthorized(false);
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
    event.preventDefault();
    if (submissionPending.current || preparationController.current) return;
    if (!canLaunch) { setError('请补齐需求来源与验收、角色配置，并在当前配置下重新确认有限预算；自定义需求不能运行固定 Mock。'); return; }
    submissionPending.current = true;
    const authorized = budgetAuthorized;
    const version = ++selectionRequest.current;
    setBusy(true); setError(''); setPreview(false); setBudgetAuthorized(false);
    invalidateLaunchPreflight();
    try {
      const next = await request<ProductionRun>('/runs', json({ brief, capability, mode, implementationEvidencePolicy: mode === 'live' && capability === 'offline-single-html' && requireImplementationEvidence ? 'source-bound-v1' : 'legacy', agentIds: ROLE_ORDER.map(role => selection[role]), candidateCount, limits, requirement, budgetAuthorized: mode !== 'demo' && authorized, ...(capability === 'camera-scene-v1' && mode === 'live' && Object.keys(cameraBusinessConstraints).length ? { cameraBusinessConstraints } : {}), ...(mode !== 'live' && demoCaseId ? { demoCaseId } : {}), ...(mode === 'mock-jev' || mode === 'live' && verifierEngine === 'jev-cascade' ? { verifierEngine: 'jev-cascade' } : {}) }));
      if (!mounted.current) return;
      setRuns(previous => [next, ...previous.filter(item => item.id !== next.id)]);
      if (selectionRequest.current === version) {
        setRun(next); setDetail('events');
        setNotice(mode === 'demo' ? '已启动工程夹具：不会调用真实模型，不计入自主交付良品率。' : mode === 'mock-jev' ? '已启动混合验证：固定研发夹具 + 真实 Jev 决策，产生 Jev 费用，但不计为自主研发交付。' : '已启动真实模型任务；预算、返修与时间限制已冻结。');
      }
    } catch (e) { if (mounted.current && selectionRequest.current === version) setError(e instanceof Error ? e.message : '启动失败'); }
    finally { submissionPending.current = false; if (mounted.current) setBusy(false); }
  }
  async function cancel() {
    if (!run || submissionPending.current) return;
    submissionPending.current = true;
    const version = selectionRequest.current;
    const cancelledRun = run;
    setBusy(true); setError(''); setPreview(false); setBudgetAuthorized(false);
    try { const next = await request<ProductionRun>(`/runs/${cancelledRun.id}/cancel`, { method: 'POST' }); if (mounted.current) { if (selectionRequest.current === version) setRun(previous => previous?.id === cancelledRun.id ? next : previous); setRuns(previous => previous.map(item => item.id === next.id ? next : item)); if (selectionRequest.current === version) setNotice(`「${cancelledRun.input.requirement.id}」取消请求已发送，终止与清理结果请查看该运行日志。`); } }
    catch (e) { if (mounted.current && selectionRequest.current === version) setError(e instanceof Error ? e.message : '取消失败'); }
    finally { submissionPending.current = false; if (mounted.current) setBusy(false); }
  }

  function detachMock() {
    setDemoCaseId(undefined);
    setRequirementOpen(true);
    setNotice('已解除固定 Mock 关联，旧编号、来源、背景与验收已清空。请重新填写自定义需求材料；自拟需求不会自动标为真实业务需求。');
  }
  function editBrief(value: string) {
    setBrief(value); setBudgetAuthorized(false);
    if (demoCaseId) { setRequirement(emptyRequirement()); detachMock(); }
  }
  function editRequirement(patch: Partial<ProductionRunInput['requirement']>) {
    setBudgetAuthorized(false);
    if (demoCaseId) { setRequirement({ ...emptyRequirement(), ...patch }); detachMock(); }
    else setRequirement(previous => ({ ...previous, ...patch }));
  }
  function newCustomRequirement() {
    invalidateLaunchPreflight();
    setBrief(''); setRequirement(emptyRequirement()); setDemoCaseId(undefined);
    setCameraBusinessConstraints({});
    setMode('live'); setBudgetAuthorized(false); setRequirementOpen(true); setError('');
    setNotice('已新建自定义需求，尚未启动或产生费用。请填写原话、编号、来源和验收；当前仅支持受限 HTML / 声明式摄像头场景，不是任意仓库开发。');
    briefInput.current?.focus();
  }
  function changeCapability(next: ProductionCapability) {
    setCapability(next); setBudgetAuthorized(false); setCameraBusinessConstraints({});
    if (next === 'camera-scene-v1') {
      setMode('live');
      if (demoCaseId) { setBrief(''); setRequirement(emptyRequirement()); setDemoCaseId(undefined); setRequirementOpen(true); }
      setNotice('已选择受控摄像头场景。HTML Mock 不会继承为摄像头需求或来源；请填写对应需求与验收，重新确认有限预算。场景行为与实机验收分别记录。');
    }
  }
  function invalidateAuthorization(event: FormEvent<HTMLFormElement>) {
    // Consent applies only to the current input/configuration. Keep this tied
    // to the user event, rather than an effect that could reset a fresh click.
    if ((event.target as HTMLInputElement).id !== 'prod-budget-authorization') { setBudgetAuthorized(false); invalidateLaunchPreflight(); }
  }
  function invalidateLaunchPreflight() {
    preparationEpoch.current++;
    preparationController.current?.abort(); preparationController.current = null;
    setPreparingLaunch(false); setLaunchPreflight(null);
  }
  async function prepareLaunch() {
    if (!canPrepareLaunch || preparationController.current) return;
    // This endpoint cannot accept authority or start a run. Revoke any old
    // consent even when the public configuration appears unchanged.
    setBudgetAuthorized(false); setError(''); setLaunchPreflight(null);
    const epoch = ++preparationEpoch.current; const controller = new AbortController();
    preparationController.current = controller; setPreparingLaunch(true);
    try {
      const report = await request<ProductionLaunchPreflightReport>('/runs/preflight', json({ brief, capability, mode, verifierEngine, implementationEvidencePolicy: requireImplementationEvidence ? 'source-bound-v1' : 'legacy', agentIds: ROLE_ORDER.map(role => selection[role]), candidateCount, limits, requirement, budgetAuthorized: false }), controller.signal);
      if (!mounted.current || controller.signal.aborted || epoch !== preparationEpoch.current) return;
      setLaunchPreflight(report);
      setNotice('免费启动预检已完成：未调用模型、未创建任务、未授予付费权限。修改需求或配置后须重新预检。');
    } catch (e) {
      if (mounted.current && !controller.signal.aborted && epoch === preparationEpoch.current) setError(e instanceof Error ? e.message : '免费启动预检失败；未启动任务。');
    } finally {
      if (mounted.current && epoch === preparationEpoch.current) { preparationController.current = null; setPreparingLaunch(false); }
    }
  }
  function changeCameraConstraint<K extends keyof CameraBusinessConstraints>(key: K, value: CameraBusinessConstraints[K] | '') {
    setBudgetAuthorized(false);
    setCameraBusinessConstraints(previous => {
      const next = { ...previous };
      if (value === '') delete next[key]; else next[key] = value;
      return next;
    });
  }

  const selectedAgents = ROLE_ORDER.map(role => agents.find(agent => agent.id === selection[role] && agent.role === role && agent.enabled));
  const teamReady = selectedAgents.every(Boolean);
  const liveMissing = selectedAgents.filter(agent => !agent?.hasApiKey || !agent.pricing || agent.pricing.currency !== limits.currency);
  const anotherRunActive = runs.some(item => ['queued', 'running'].includes(item.status));
  const jevReady = !!jevConfig?.enabled && jevConfig.hasApiKey && limits.currency === 'USD';
  const registeredCase = PRODUCTION_DEMO_CASES.find(item => item.operation === demoCaseId);
  const registeredRequirement = registeredCase ? caseRequirement(registeredCase) : null;
  const fixtureReady = capability === 'offline-single-html' && !!registeredCase && !!registeredRequirement && brief === registeredCase.brief && (Object.keys(registeredRequirement) as Array<keyof ProductionRunInput['requirement']>).every(key => requirement[key] === registeredRequirement[key]);
  const missingRequirement = [brief.trim().length < 3 ? '需求原话（至少 3 字）' : '', !requirement.id.trim() ? '编号' : '', !requirement.source.trim() ? '来源' : '', !requirement.acceptance.trim() ? '业务验收要求' : ''].filter(Boolean);
  const cameraConstraintConflict = capability === 'camera-scene-v1' && cameraBusinessConstraints.openPalm !== undefined && cameraBusinessConstraints.openPalm === cameraBusinessConstraints.closedFist;
  const evidencePolicyConflict = mode === 'live' && capability === 'offline-single-html' && requireImplementationEvidence && verifierEngine !== 'llm-rubric';
  const canPrepareLaunch = !loading && !busy && !preparingLaunch && !anotherRunActive && teamReady && missingRequirement.length === 0 && mode === 'live' && capability === 'offline-single-html' && verifierEngine === 'llm-rubric';
  const canLaunch = !loading && !busy && !preparingLaunch && !anotherRunActive && launchPreflight?.ready !== false && teamReady && !cameraConstraintConflict && !evidencePolicyConflict && missingRequirement.length === 0 && (mode === 'demo' ? fixtureReady : mode === 'mock-jev' ? fixtureReady && budgetAuthorized && jevReady : budgetAuthorized && liveMissing.length === 0 && (verifierEngine === 'llm-rubric' || jevReady));
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
        <div className="prod-compose" onChangeCapture={event => { if (!(event.target as HTMLElement).closest('form')) invalidateLaunchPreflight(); }}>
          <form className="prod-panel prod-request" onSubmit={start} onChangeCapture={invalidateAuthorization}>
            <div className="prod-section-heading"><h2>提出一个软件需求</h2><button className="prod-button" type="button" onClick={newCustomRequirement}>新建自定义需求</button></div>
            <p className="prod-caption prod-custom-guidance">固定案例可免费运行工程链路；你的新需求仅在真实模型模式执行，补齐来源、验收和配置并授权有限预算后才会启动。</p>
            <label className="prod-capability" htmlFor="prod-capability">受控交付能力<select id="prod-capability" aria-label="受控交付能力" value={capability} onChange={event => changeCapability(event.target.value as ProductionCapability)}><option value="offline-single-html">离线单页 HTML 小型应用</option><option value="camera-scene-v1">摄像头交互 · 声明式三维粒子场景 v1</option></select></label>
            {capability === 'offline-single-html' ? <><div className="prod-presets" aria-label="三个 Mock 需求">{PRODUCTION_DEMO_CASES.map(item => <button type="button" key={item.id} aria-pressed={fixtureReady && demoCaseId === item.operation} onClick={() => { invalidateLaunchPreflight(); setDemoCaseId(item.operation); setBrief(item.brief); setRequirement(caseRequirement(item)); setBudgetAuthorized(false); setNotice('已载入固定 Mock 快照，来源与验收属于该案例；编辑后将解除关联，真实调用需重新授权。'); }}>{item.title}</button>)}</div><p className="prod-caption">以上是团队自拟 Mock，不是来自实际业务的真实需求。夹具仅验证工程链路。</p></> : <p className="prod-camera-boundary">模型只生成受限场景 JSON，固定可信运行时负责渲染与本地摄像头识别。支持 cone / sphere / ring / star、聚散与旋转；不执行模型 HTML / JS。合成场景 Gate 不等于真实摄像头或完整需求通过。</p>}
            {capability === 'camera-scene-v1' ? <fieldset className="prod-camera-constraints"><legend>明确的手势动作要求（可选）</legend><p className="prod-caption">填写明确要求；未指定的动作允许 Agent 选择，实际验收须冻结相应映射。不会从原话自动猜测或改写来源；合成行为检查仍不代表实机验收。</p><div className="prod-fields">
              <label htmlFor="prod-open-palm">张掌动作要求<select id="prod-open-palm" aria-label="张掌动作要求" value={cameraBusinessConstraints.openPalm ?? ''} onChange={e => changeCameraConstraint('openPalm', e.target.value as 'scatter' | 'gather' | '')}><option value="">未指定，由 Agent 选择</option><option value="scatter">散开（scatter）</option><option value="gather">聚合（gather）</option></select></label>
              <label htmlFor="prod-closed-fist">握拳动作要求<select id="prod-closed-fist" aria-label="握拳动作要求" value={cameraBusinessConstraints.closedFist ?? ''} onChange={e => changeCameraConstraint('closedFist', e.target.value as 'scatter' | 'gather' | '')}><option value="">未指定，由 Agent 选择</option><option value="scatter">散开（scatter）</option><option value="gather">聚合（gather）</option></select></label>
              <label htmlFor="prod-palm-x">横移动作要求<select id="prod-palm-x" aria-label="横移动作要求" value={cameraBusinessConstraints.palmX ?? ''} onChange={e => changeCameraConstraint('palmX', e.target.value as 'rotate' | 'none' | '')}><option value="">未指定，由 Agent 选择</option><option value="rotate">旋转（rotate）</option><option value="none">不启用旋转（none）</option></select></label>
            </div>{cameraConstraintConflict ? <p className="prod-constraint-error" role="alert">张掌与握拳的要求不能相同。请选择相反动作，或将其中一项设为未指定；当前不能启动。</p> : null}</fieldset> : null}
            <label htmlFor="prod-brief">需求原话<textarea id="prod-brief" aria-label="需求原话" ref={briefInput} required minLength={3} maxLength={6000} value={brief} onChange={e => editBrief(e.target.value)} placeholder="例如：做一个能筛选、统计和管理待办的页面…" /></label>
            <details className="prod-settings" open={requirementOpen} onToggle={event => setRequirementOpen(event.currentTarget.open)}><summary>需求来源与验收材料</summary><p className="prod-caption">“真实业务需求”是你的来源声明，不是平台认证；自拟题或改写的 Mock 请保留“自拟 / 演示需求”。</p><div className="prod-fields">
              <label htmlFor="prod-requirement-kind">需求来源类型<select id="prod-requirement-kind" aria-label="需求来源类型" value={requirement.kind} onChange={e => editRequirement({ kind: e.target.value as 'illustrative' | 'user-declared-real' })}><option value="illustrative">自拟 / 演示需求（illustrative）</option><option value="user-declared-real">用户声明的真实业务需求（user-declared-real）</option></select></label>
              <label htmlFor="prod-requirement-id">编号<input id="prod-requirement-id" required maxLength={80} value={requirement.id} onChange={e => editRequirement({ id: e.target.value })} placeholder="例如：CUSTOM-001" /></label>
              <label htmlFor="prod-difficulty">难度<select id="prod-difficulty" aria-label="难度" value={requirement.difficulty} onChange={e => editRequirement({ difficulty: e.target.value as 'low' | 'medium' | 'high' })}><option value="low">低：单页确定性功能</option><option value="medium">中：多状态交互</option><option value="high">高：复合逻辑</option></select></label>
              <label className="prod-full" htmlFor="prod-source">来源<input id="prod-source" required maxLength={300} value={requirement.source} onChange={e => editRequirement({ source: e.target.value })} placeholder="自拟验证题，或工单 / 用户反馈及出处" /></label>
              <label className="prod-full" htmlFor="prod-background">背景<textarea id="prod-background" aria-label="背景" maxLength={3000} value={requirement.background} onChange={e => editRequirement({ background: e.target.value })} /></label>
              <label className="prod-full" htmlFor="prod-acceptance">业务验收要求<textarea id="prod-acceptance" aria-label="业务验收要求" required maxLength={3000} value={requirement.acceptance} onChange={e => editRequirement({ acceptance: e.target.value })} placeholder="写出可观察的功能行为与通过条件…" /></label>
            </div></details>
            {mode === 'live' && capability === 'offline-single-html' && verifierEngine === 'llm-rubric' ? <section className="prod-preflight" aria-labelledby="prod-preflight-title">
              <div className="prod-section-heading"><h3 id="prod-preflight-title">先检查，再授权</h3><button className="prod-button" type="button" disabled={!canPrepareLaunch} onClick={() => void prepareLaunch()}>{preparingLaunch ? '正在免费预检…' : '免费启动预检'}</button></div>
              <p className="prod-caption">检查需求、公开模型配置、第一请求预算预留和启动身份，不读取完整 Key、不调用模型、不创建运行。预检不替代最终行为 Gate，也不授予付费权限。</p>
              {launchPreflight ? <LaunchPreflightDetail report={launchPreflight} /> : <p className="prod-caption">补齐需求来源、验收和六角色选择后可预检；缺 Key 或费率会列为阻塞项。Key 轮换、服务重启或配置修改后应重新检查。</p>}
            </section> : null}
            {missingRequirement.length ? <p className="prod-caption prod-required-guidance" role="status">启动前请补齐：{missingRequirement.join('、')}。不会用旧 Mock 材料自动补全。</p> : null}
<div className="prod-mode-row"><fieldset className="prod-mode"><legend className="prod-visually-hidden">执行模式</legend><label><input type="radio" name="prod-mode" disabled={capability === 'camera-scene-v1'} checked={mode === 'demo'} onChange={() => setMode('demo')} />工程夹具 / Mock</label><label><input type="radio" name="prod-mode" disabled={capability === 'camera-scene-v1'} checked={mode === 'mock-jev'} onChange={() => setMode('mock-jev')} />Mock + 真实 Jev</label><label><input type="radio" name="prod-mode" checked={mode === 'live'} onChange={() => setMode('live')} />真实模型</label></fieldset><span className="prod-caption">{mode === 'demo' ? '不产生模型费用' : mode === 'mock-jev' ? '仅决策层为真实调用' : '使用本工作区页面配置'}</span></div>
{mode === 'live' ? <label className="prod-verifier-engine" htmlFor="prod-verifier-engine">候选验证引擎<select id="prod-verifier-engine" aria-label="候选验证引擎" value={verifierEngine} onChange={e => setVerifierEngine(e.target.value as 'llm-rubric' | 'jev-cascade')}><option value="llm-rubric">LLM 序数评审</option><option value="jev-cascade">Jev 决策 → 有界独立 LLM 复核</option></select></label> : null}
{mode === 'live' && capability === 'offline-single-html' ? <div className="prod-live-notice"><label className="prod-checkbox" htmlFor="prod-implementation-evidence"><input id="prod-implementation-evidence" name="implementationEvidencePolicy" type="checkbox" aria-describedby="prod-evidence-explanation" checked={requireImplementationEvidence} onChange={event => setRequireImplementationEvidence(event.target.checked)} />启用条款证据门禁（LLM）</label><p id="prod-evidence-explanation" className="prod-caption">研发／返修评审逐条提供当前候选的短源码引用和冻结业务断言索引；缺项或引用不符则拒绝。引用核验不证明语义正确，最终浏览器 Gate 仍必需。默认保留兼容模式；新门禁的工程验证与真实模型效果分别记录。</p>{evidencePolicyConflict ? <p role="status">条款证据模式仅支持 LLM 序数评审，请切换引擎或明确关闭此门禁；不会静默降级或追加 Jev 费用。</p> : null}</div> : null}
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
            {mode !== 'demo' ? <div className="prod-live-notice"><p>{mode === 'mock-jev' ? '研发与项目经理产物来自固定夹具；只有 Jev 决策真实，不能计为自主研发或良品率。' : liveMissing.length ? `请先在研发团队配置所有已选角色的 Key，以及与 ${limits.currency} 一致的每百万 Token 单价。当前 ${liveMissing.length} 个角色不满足。` : '六角色配置齐备。价格由你提供，账本为估算，不是供应商最终账单。'}</p>{mode === 'mock-jev' || verifierEngine === 'jev-cascade' ? <p>{jevReady ? `Jev 已启用：每维最低 ${jevConfig!.minScore}/4，分布集中度 ≥ ${jevConfig!.minConfidence}；这些门限尚未校准，不是正确率。` : '请在决策设置启用并配置 Jev Key；当前 Jev 预算只支持 USD。'}{mode === 'mock-jev' && !demoCaseId ? ' 自定义需求不适用固定夹具，请重新选择 Mock 需求。' : ''}</p> : null}<label className="prod-checkbox"><input id="prod-budget-authorization" type="checkbox" checked={budgetAuthorized} onChange={e => setBudgetAuthorized(e.target.checked)} />我授权本次在上述有限预算内执行真实调用；不迁移原项目 Key。</label></div> : !demoCaseId ? <p className="prod-live-notice">自定义需求或验收需要真实模型处理。请重新选择上方 Mock 需求运行对应的固定工程夹具，或切换真实模型。</p> : null}
            <div className="prod-launch"><p className="prod-caption">全局最多 {limits.maxRepairCycles} 次自动返修：阶段生成纠错与 Gate 返修共用该预算；超限、超时、验证拒绝会保存失败证据，不会无限循环。</p><button className="prod-button prod-primary" disabled={!canLaunch} type="submit"><Mark />{busy ? '正在处理…' : mode === 'demo' ? '运行 Mock 链路' : mode === 'mock-jev' ? '运行 Mock + Jev 验证' : '启动真实生产'}</button></div>
          </form>
          <aside className="prod-panel prod-team-selector"><div className="prod-section-heading"><h2>本次研发团队</h2><button className="prod-link-button" type="button" onClick={() => setView('team')}>配置团队</button></div>{ROLE_ORDER.map(role => { const chosen = agents.find(agent => agent.id === selection[role]); return <div className="prod-team-slot" key={role}><span className={`prod-role prod-role-${role}`}>{ROLE_INFO[role].initials}</span><div><label htmlFor={`prod-agent-${role}`}>{ROLE_INFO[role].label}<select id={`prod-agent-${role}`} aria-label={`${ROLE_INFO[role].label} Agent`} value={selection[role] ?? ''} onChange={e => { setSelection(previous => ({ ...previous, [role]: e.target.value })); setBudgetAuthorized(false); }}><option value="" disabled>请选择启用的角色 Agent</option>{agents.filter(agent => agent.role === role && agent.enabled).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><small>{chosen ? `${chosen.provider} · ${chosen.modelId}` : '尚未配置'}</small></div><span className={`prod-key-status ${chosen?.hasApiKey ? 'ready' : ''}`}>{chosen?.hasApiKey ? 'Key 已配置' : '无 Key'}</span></div>; })}<p className="prod-caption prod-team-footnote">每个角色可使用独立模型。不同 Model ID 仅说明配置不同，不证明底层权重独立。Key 不会在页面回显。</p></aside>
        </div>
        <div className="prod-section-heading prod-history-heading"><div><h2>执行与交付</h2><span className="prod-caption">全部启动尝试保留在账本</span></div><label className="prod-history-select" htmlFor="prod-history">选择运行<select id="prod-history" aria-label="选择运行" value={run?.id ?? ''} onChange={e => void selectRun(e.target.value)}><option value="" disabled>暂无运行</option>{runs.map(item => <option key={item.id} value={item.id}>{item.input.requirement.id} · {item.evidenceKind === 'real-model' ? '真实' : 'Mock'} · {STATUS[item.status]} · {item.createdAt.slice(11, 19)}</option>)}</select></label></div>
        {run ? <RunDetail run={run} detail={detail} setDetail={setDetail} preview={preview} setPreview={setPreview} cancel={cancel} busy={busy} /> : <div className="prod-empty"><Mark /><h3>等待第一份交付证据</h3><p>先运行 Mock 查看端到端流程；真实模型通过冻结 Gate 后，才会计入自主交付成功。</p></div>}
      </> : null}
      {view === 'decision' ? <><JevSettings onConfigChange={handleJevConfigChange} /><VerifierStudyPanel agents={agents} disabled={anotherRunActive || busy} /></> : null}
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

function LaunchPreflightDetail({ report }: { report: ProductionLaunchPreflightReport }) {
  const { budget, execution } = report;
  return <div className="prod-preflight-result" aria-label="免费启动预检结果">
    <p role="status"><strong>{report.ready ? '采集时预检无阻塞' : '启动条件存在阻塞'}</strong> · 模型请求 0 · 付费授权未授予 · 最终 Gate 尚未生成</p>
    <p className="prod-caption">此报告只是当前配置快照，不能提交为授权令牌，不保证整条链路成功或费用覆盖所有返修。最终测试仍由测试 Agent 生成、预检并在研发前冻结。</p>
    {report.issues.length ? <ul className="prod-preflight-issues">{report.issues.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul> : null}
    {report.warnings.length ? <ul className="prod-preflight-warnings">{report.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{warning.message}</li>)}</ul> : null}
    <dl>
      <div><dt>正常 / 最坏角色调用槽位</dt><dd>{budget.baseCalls} / {budget.worstCaseCalls}（不是实际 HTTP 数）</dd></div>
      <div><dt>单请求 Token 预留</dt><dd>{format(budget.firstRequest.totalTokens)}</dd></div>
      <div><dt>首次产品请求费用预留</dt><dd>{displayCost(budget.firstRequest.estimatedCost)} {budget.firstRequest.currency}</dd></div>
      <div><dt>整链最大费用预留包络</dt><dd>{displayCost(budget.envelope.worstCaseEstimatedCost)} {budget.envelope.currency}（保守预留，不是预测账单）</dd></div>
      <div><dt>源码 / 构建</dt><dd>{execution.commit ?? 'unknown'} / {execution.buildSnapshot?.platformCommit ?? 'unknown'}</dd></div>
      <div><dt>报告 SHA-256</dt><dd>{report.reportHash}</dd></div>
    </dl>
    <details><summary>本次六角色公开模型与费率</summary><ul>{report.models.map(agent => <li key={agent.id}><b>{ROLE_INFO[agent.role].label}</b>：{agent.provider} / {agent.modelId}<br />{agent.baseUrl}<br />{agent.pricing ? `输入 ${agent.pricing.inputPerMillion} / 输出 ${agent.pricing.outputPerMillion} ${agent.pricing.currency} / 百万 Token` : '费率 unknown'}；{agent.hasApiKey ? 'Key 已配置（不回显）' : 'Key 未配置'}</li>)}</ul></details>
  </div>;
}

function RunLedger({ run }: { run: ProductionRun }) {
  const { requests, usage } = projectProductionLedger(run);
  const requestText = (total: number | null, subtotal: number | null, unknown: number) => total == null ? `unknown（已观测小计 ${format(subtotal)}；${unknown} 条记录未观测）` : format(total);
  const injected = run.evidenceKind === 'injected-test';
  return <section className="prod-run-ledger" aria-label="请求与用量账本">
    <h3>请求与用量账本</h3>
    <p className="prod-caption">角色记录、Harness 调用意图、预算记录和实际 HTTP POST 是不同口径。失败前登记的意图不代表发出了请求；HTTP 观察也不是供应商账单。</p>
    <div className="prod-ledger-grid">
      <div><h4>意图与 HTTP 观察</h4><dl>
        <div><dt>Harness 调用意图</dt><dd>{requests.harnessInvocations} 条</dd></div>
        <div><dt>Harness 实际 HTTP POST</dt><dd>{requestText(requests.unknownHarnessRequestIntents ? null : requests.knownHarnessProviderRequests, requests.knownHarnessProviderRequests, requests.unknownHarnessRequestIntents)}</dd></div>
        <div><dt>Jev 实际 HTTP POST</dt><dd>{requestText(requests.jevProviderRequests, requests.knownJevProviderRequests, requests.unknownJevRequestIntents)}</dd></div>
        <div><dt>总实际 HTTP POST</dt><dd>{requestText(requests.actualProviderRequests, requests.knownProviderRequests, requests.unknownRequestIntents)}</dd></div>
        <div><dt>HTTP 请求数未知记录</dt><dd>{requests.unknownRequestIntents} 条</dd></div>
        <div><dt>Mock / 注入角色记录</dt><dd>{requests.simulatedStageRecords} / {requests.injectedTestRecords} 条</dd></div>
        {requests.unclassifiedCallRecords ? <div><dt>来源未记录的旧角色记录</dt><dd>{requests.unclassifiedCallRecords} 条（不猜为零请求）</dd></div> : null}
        {injected && run.jevCalls?.length ? <div><dt>Jev 派发记录（未验证 HTTP）</dt><dd>{requestText(requests.unknownJevDispatchIntents ? null : requests.observedJevDispatches, requests.observedJevDispatches, requests.unknownJevDispatchIntents)}</dd></div> : null}
      </dl></div>
      <div><h4>{injected ? '注入用量记录小计（非真实支出）' : '已报告用量小计（非总额）'}</h4><dl>
        <div><dt>已报告输入 Token 小计</dt><dd>{format(usage.inputTokens.knownSubtotal)}<small>{usage.inputTokens.reportedEntries} 条已报告；{usage.inputTokens.unknownEntries} 条未知</small></dd></div>
        <div><dt>已报告输出 Token 小计</dt><dd>{format(usage.outputTokens.knownSubtotal)}<small>{usage.outputTokens.reportedEntries} 条已报告；{usage.outputTokens.unknownEntries} 条未知</small></dd></div>
        <div><dt>已报告估算费用小计</dt><dd>{displayCost(usage.estimatedCost.knownSubtotal)} {usage.currency ?? '币种 unknown'}<small>{usage.estimatedCost.reportedEntries} 条同币种已报告；{usage.estimatedCost.unknownEntries} 条未知</small></dd></div>
        <div><dt>用量明细含未知记录</dt><dd>{usage.unknownUsageEntries} / {usage.entries} 条</dd></div>
      </dl>{usage.currencyMismatchEntries ? <p className="prod-caption">{usage.currencyMismatchEntries} 条费用的币种缺失、不支持或不一致，未并入费用小计；不换汇或猜测币种。</p> : null}</div>
    </div>
    <p className="prod-caption prod-ledger-boundary">上方总账直接保留原始字段；已报告小计不替代 unknown 总额。观察到 POST = 0 也不推造已报告的 0 Token / 费用。{usage.entries === 0 ? '尚无可汇总的调用用量明细。' : ''}{injected ? '注入派发没有真实 HTTP 证据，不能当作供应商请求或支出。' : ''}</p>
  </section>;
}

function CallRequestObservation({ call }: { call: ProductionRun['calls'][number] }) {
  if (call.executionSource === 'mock' || call.executionSource === 'injected') return <p className="prod-caption prod-call-observation">{call.executionSource === 'mock' ? 'Mock' : '注入测试'}角色记录；不当作真实模型 HTTP 请求证据。</p>;
  const counts = productionRequestCounts({ calls: [call] });
  return <p className="prod-caption prod-call-observation">{call.executionSource === 'harness' ? 'Harness 调用意图 1 条' : '旧记录执行来源未记录'} · 实际 HTTP POST {format(counts.actualProviderRequests)}。{counts.actualProviderRequests === 0 ? '确定的 0 POST 不推造 0 Token / 费用。' : counts.actualProviderRequests == null ? '缺少合法 HTTP 观察字段，不按零请求处理。' : 'HTTP 观察不是供应商账单。'}</p>;
}

function unobservedJevRequest(evaluation: JevEvaluation): boolean {
  return isUnresolvedJevIntent(evaluation);
}

function JevDecisionEvidence({ calls, snapshot, dispatchOnly = false }: { calls: NonNullable<ProductionRun['jevCalls']>; snapshot?: JevPublicConfig; dispatchOnly?: boolean }) {
  const labels: Record<JevEvaluation['status'], string> = { accepted: '接受候选', uncertain: '不确定 → 需复核', rejected: '拒绝候选', error: '请求 / 契约错误' };
  const dimensions = { coverage: '验收覆盖', consistency: '约束一致性', scope: '范围可执行性' };
  return <section className="prod-jev-evidence" aria-label="Jev 决策证据">
    <h3>Jev 类型化决策记录</h3>
    <p className="prod-muted">每维分数是等级分布加权值（0–4）；confidence 是分布集中度，不是答案正确率。{snapshot ? `本次冻结门限：每维 ≥ ${snapshot.minScore}，集中度 ≥ ${snapshot.minConfidence}。` : ''}通过决策不代表通过最终行为 Gate。</p>
    {calls.map(call => {
      const evaluation = call.evaluation;
      const pending = unobservedJevRequest(evaluation);
      const arithmeticError = evaluation.status === 'error' && evaluation.errorKind === 'arithmetic-drift';
      const fatalError = evaluation.status === 'error' && evaluation.errorKind === 'fatal';
      const label = pending ? '请求意图未完成 / 未观测' : arithmeticError ? 'Jev 异常决策未采信' : fatalError ? 'Jev 致命错误 / 决策未采信' : labels[evaluation.status];
      return <article className="prod-verification" id={jevEvidenceId(call.id)} tabIndex={-1} key={call.id}>
        <div className="prod-section-heading"><h3>{call.phase}</h3><span className={`prod-pill ${evaluation.status === 'accepted' ? '' : 'prod-pill-warning'}`}>{label}</span></div>
        <p className="prod-caption">Jev 调用 ID：<code>{call.id}</code> · 决策版本：<code>{evaluation.policyVersion}</code></p>
        {arithmeticError ? <p className="prod-boundary prod-jev-error-boundary">算术一致性异常；原始分数、选择与通过判断均未采信。独立复核是另一次判断，不把本次 Jev 错误改成通过。</p> : fatalError ? <p className="prod-boundary prod-jev-error-boundary">可信校验器记录为致命错误，不进入算术异常的独立复核分支。本次 Jev 决策未采信。</p> : null}
        <p>{evaluation.reason}</p>
        {evaluation.diagnostics?.length ? <ul className="prod-jev-diagnostics" aria-label="可信校验诊断">{evaluation.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.answerId}-${diagnostic.code}-${index}`}><code>{diagnostic.code}</code> · 答案 <code>{diagnostic.answerId}</code></li>)}</ul> : null}
        <p className="prod-caption">{evaluation.modelIdReturned ?? evaluation.modelIdRequested} · {dispatchOnly ? '派发记录（未验证 HTTP）' : '实际请求'} {pending || !Number.isSafeInteger(evaluation.providerRequests) || evaluation.providerRequests < 0 ? '未观测 / unknown' : evaluation.providerRequests} · 选中 {evaluation.selectedCandidateId ?? '无'} · {dispatchOnly ? '注入用量费用记录' : '估算费用'} {evaluation.usage.estimatedCost == null ? 'unknown' : `${evaluation.usage.estimatedCost.toFixed(6)} USD`}</p>
        {evaluation.scores.map(candidate => <div className="prod-jev-candidate" key={candidate.candidateId}><code>{candidate.candidateId}</code><dl>{Object.entries(candidate.dimensions).map(([dimension, answer]) => <div key={dimension}><dt>{dimensions[dimension as keyof typeof dimensions]}</dt><dd>加权分数 <b>{answer.score.toFixed(3)} / 4</b><span>分布集中度 {answer.confidence.toFixed(3)}</span></dd></div>)}</dl><p className="prod-caption">Noul 范围判断 p(yes) = {candidate.scopeProbability.toFixed(3)}；派生集中度 = {candidate.scopeCertainty.toFixed(3)}。{candidate.qualified ? '满足该候选门限。' : '未满足全部候选门限。'}</p></div>)}
        {evaluation.choice ? <p className="prod-caption prod-jev-choice">Choice：{evaluation.choice.choice} · 分布集中度 {evaluation.choice.confidence.toFixed(3)}</p> : null}
        <details className="prod-output"><summary>完整分布、原始响应、请求快照与配置 hash</summary><pre>{JSON.stringify({ id: call.id, phase: call.phase, startedAt: call.startedAt, configHash: call.configHash, evaluation }, null, 2)}</pre></details>
      </article>;
    })}
  </section>;
}

function JevSourceReference({ sourceJevCallId, jevCalls }: { sourceJevCallId?: string; jevCalls: NonNullable<ProductionRun['jevCalls']> }) {
  const source = sourceJevCallId ? jevCalls.find(call => call.id === sourceJevCallId) : undefined;
  function focusSource() {
    if (!source) return;
    const target = document.getElementById(jevEvidenceId(source.id));
    target?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target?.focus({ preventScroll: true });
  }
  return source ? <button className="prod-button prod-jev-source" type="button" onClick={focusSource}>查看来源 Jev 调用 <code>{source.id}</code></button> : <p className="prod-caption prod-jev-source-missing">{sourceJevCallId ? <>来源 Jev 调用 <code>{sourceJevCallId}</code>：当前快照找不到原调用。</> : '来源 Jev 调用 ID 未记录；不按阶段或错误文字推断来源。'}</p>;
}

function VerificationRequestContext({ call, jevCalls }: { call: ProductionRun['calls'][number]; jevCalls: NonNullable<ProductionRun['jevCalls']> }) {
  if (!call.verificationEngine) return null;
  const fallback = call.verificationEngine === 'jev-llm-fallback' || call.verificationEngine === 'jev-llm-protocol-fallback';
  return <section className="prod-call-verification-context" aria-label="复核请求上下文">
    <p className="prod-caption prod-verifier-engine">{VERIFICATION_ENGINE_LABELS[call.verificationEngine]} · 请求 ID：<code>{call.id}</code></p>
    {call.error ? <p className="prod-boundary prod-verification-request-failed">复核请求失败，未取得合法结论；此处没有通过或模型弃权判定。unknown 用量或费用不记为零，也不自动追加预算。</p> : <p className="prod-caption">这是复核请求记录，不单独证明取得了合法评审结论；实际结论以候选验证记录为准。</p>}
    {fallback ? <JevSourceReference sourceJevCallId={call.sourceJevCallId} jevCalls={jevCalls} /> : null}
  </section>;
}

function CandidateVerification({ verification, jevCalls }: { verification: ProductionVerification; jevCalls: NonNullable<ProductionRun['jevCalls']> }) {
  const protocolFallback = verification.engine === 'jev-llm-protocol-fallback';
  const uncertainFallback = verification.engine === 'jev-llm-fallback';
  return <article className="prod-verification">
    <div className="prod-section-heading"><h3>{verification.phase}</h3><span className={`prod-pill ${verification.decision === 'abstain' ? 'prod-pill-warning' : ''}`}>{verification.decision === 'accept' ? '选择候选' : '拒绝 / 弃权'}</span></div>
    <p className="prod-caption prod-verifier-engine">{verification.engine ? VERIFICATION_ENGINE_LABELS[verification.engine] : '引擎未记录（旧版）'}</p>
    {protocolFallback ? <p className="prod-boundary prod-protocol-fallback">原 Jev 异常决策未采信；独立 LLM 按原始任务、候选和冻结验收重新评审，不以异常分数作为依据。</p> : uncertainFallback ? <p className="prod-boundary prod-uncertain-fallback">原 Jev 决策不确定；以下是独立 LLM 的另一份评审，不是将 Jev 原决策改成通过。</p> : null}
    {protocolFallback || uncertainFallback ? <>
      <p className="prod-caption prod-fallback-budget">本次复核计入原调用、Token、时间与费用上限，不额外增加预算或返修次数。复核结论不是最终 Gate，也不证明准确率或高性价比。</p>
      <JevSourceReference sourceJevCallId={verification.sourceJevCallId} jevCalls={jevCalls} />
    </> : null}
    <p>{verification.reason}</p>
    <p className="prod-caption">选中 ID：{verification.selectedCandidateId ?? '无'} · 评审标准 hash：<code>{verification.criteriaHash}</code></p>
    {verification.scores.map(score => <div className="prod-score" key={score.candidateId}><b>评分 {displayScore(score.score)}{verification.engine === 'jev' ? '（管线排序值）' : ' / 5'}</b><code>{score.candidateId}</code><p>{score.reason}</p></div>)}
  </article>;
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
  const requests = productionRequestCounts(run);
  const unknownJevIntents = requests.unknownJevRequestIntents;
  const knownJevRequests = requests.knownJevProviderRequests;
  const isHybrid = run.evidenceKind === 'fixture-with-real-jev';
  return <section className="prod-panel prod-run-detail" aria-label="当前运行详情">
<div className="prod-run-header"><div><span className={`prod-status prod-status-${run.status}`}>{isCamera && run.status === 'completed' ? '场景行为通过' : STATUS[run.status]}</span><span className="prod-pill">{run.evidenceKind === 'real-model' ? '真实模型证据' : isHybrid ? '固定研发夹具 + 真实 Jev' : run.evidenceKind === 'fixture' ? 'Mock / 工程夹具' : '注入测试'}</span><strong>{run.input.requirement.id}</strong><code>{run.id}</code></div>{active(run) ? <button className="prod-button prod-danger" type="button" disabled={busy} onClick={() => void cancel()}>取消任务</button> : null}</div>
    {run.evidenceKind !== 'real-model' ? <p className="prod-fixture-note">{isHybrid ? '研发和项目经理输出是固定夹具，仅 Jev 决策层真实且收费；这是混合验证，不是自主生成产品。' : '该记录用于工程与浏览器行为验证，不代表平台内部真实 Agent 自主交付成功。'}</p> : null}
    {isCamera ? <aside className="prod-camera-boundary"><b>{run.cameraVerification?.boundedScenePassed ? '场景行为通过，摄像头待实机验收' : '摄像头场景：行为验证尚未通过'}</b><p>合成关键点验证的是受控场景行为；视觉模型质量、真实摄像头和完整需求均未验收，不计入完整自主交付良品率。</p>{run.cameraVerification ? <details className="prod-output"><summary>场景验证范围与限制</summary><pre>{JSON.stringify(run.cameraVerification, null, 2)}</pre></details> : null}</aside> : null}
    <div className="prod-loop"><b>项目经理闭环</b><span>思考 → 设计 → 实施 → 测试 → 反馈 → 再规划</span><strong>{globalRepairPolicy ? '全局返修' : run.repairPolicyVersion ? '未知版本返修' : '旧版研发 / Gate 返修'} {run.repairs} / {run.input.limits.maxRepairCycles}</strong></div>
    <RepairHistory run={run} />
    <div className="prod-run-roles">{ROLE_ORDER.map(role => { const called = run.calls.some(call => call.role === role); const events = run.events.some(event => event.role === role); return <div className={latestRole === role && active(run) ? 'current' : ''} key={role}><span className={`prod-role prod-role-${role}`}>{ROLE_INFO[role].initials}</span><span>{ROLE_INFO[role].label}<small>{latestRole === role && active(run) ? '当前环节' : called ? `${run.calls.filter(call => call.role === role).length} 条记录` : events ? '已有事件' : '待执行'}</small></span></div>; })}</div>
    <div className="prod-run-summary"><span>时间 <b>{run.durationMs == null ? active(run) ? '进行中' : 'unknown' : `${(run.durationMs / 1000).toFixed(1)}s`}</b></span><span>{run.evidenceKind === 'fixture' || isHybrid ? '模拟环节记录' : '角色调用记录'} <b>{run.calls.length}</b></span><span>调用预算记录 <b>{run.calls.length + jevCalls.length} / {run.input.limits.maxCalls}</b></span>{jevCalls.length ? <span>{run.evidenceKind === 'injected-test' ? 'Jev 派发记录（未验证 HTTP）' : 'Jev 实际请求'} <b>{run.evidenceKind === 'injected-test' ? requests.unknownJevDispatchIntents ? `unknown（已知派发 ${format(requests.observedJevDispatches)}；${requests.unknownJevDispatchIntents} 个意图未观测）` : format(requests.observedJevDispatches) : unknownJevIntents ? `unknown（已知 ${format(knownJevRequests)} 次；${unknownJevIntents} 个请求意图未观测）` : format(knownJevRequests)}</b></span> : null}<span>输入 / 输出 Token <b>{format(run.usage.inputTokens)} / {format(run.usage.outputTokens)}</b></span><span>估算费用 <b>{run.usage.estimatedCost == null ? 'unknown' : `${run.usage.estimatedCost.toFixed(6)} ${run.usage.currency}`}</b></span></div>
    <RunLedger run={run} />
    {run.error ? <p className="prod-run-error" role="alert">{run.error}</p> : null}
    <nav className="prod-detail-tabs" aria-label="运行详情分组">{([['events', '执行链路'], ['verifier', '候选验证'], ['delivery', '门禁与交付'], ['calls', '原始调用']] as const).map(([value, label]) => <button type="button" aria-pressed={detail === value} key={value} onClick={() => setDetail(value)}>{label}<small>{value === 'calls' ? run.calls.length : value === 'verifier' ? run.verifications.length : value === 'events' ? run.events.length : run.artifacts.length}</small></button>)}</nav>
    <div className="prod-detail-body">
      {detail === 'events' ? <><ol className="prod-events">{run.events.map(event => <li key={event.id}><time dateTime={event.time}>{new Date(event.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><span className="prod-event-role">{event.role ? ROLE_INFO[event.role].label : event.phase}</span><p>{event.message}</p></li>)}</ol><details className="prod-output"><summary>输入快照与已选角色产物（{run.outputs.length}）</summary><pre>{JSON.stringify({ input: run.input, agentSnapshot: run.agentSnapshot, outputs: run.outputs }, null, 2)}</pre></details></> : null}
{detail === 'verifier' ? <><p className="prod-muted">每个候选均经过结构预检与评审，包括单候选。LLM 序数评分不代表概率；Jev 分布与集中度单独展示。所有验证器都不能放宽冻结 Gate。评分仅在展示时保留两位小数，不改变原始数值、选择结果或门限。</p>{run.verifications.length ? run.verifications.map((verification, index) => <CandidateVerification key={`${verification.phase}-${index}`} verification={verification} jevCalls={jevCalls} />) : <p className="prod-empty-text">尚无候选评审结果。</p>}{jevCalls.length ? <JevDecisionEvidence calls={jevCalls} snapshot={run.jevSnapshot} dispatchOnly={run.evidenceKind === 'injected-test'} /> : null}</> : null}
{detail === 'delivery' ? <><div className="prod-contract"><h3>冻结验收契约</h3>{run.frozenContract ? <><p>版本 <b>{run.frozenContract.version}</b> · 冻结于 {run.frozenContract.frozenAt}</p><code>{run.frozenContract.hash}</code><details className="prod-output"><summary>查看不可在返修中放宽的检查快照</summary><pre>{JSON.stringify(run.frozenContract, null, 2)}</pre></details></> : <p className="prod-muted">尚未冻结。研发开始前必须完成业务与测试契约冻结。</p>}</div><div className="prod-gate"><h3>{isCamera ? run.gate ? run.gate.passed ? '场景行为 Gate：通过（合成输入）' : '场景行为 Gate：未通过' : '场景行为 Gate：未执行' : run.gate ? run.gate.passed ? '最终行为 Gate：通过' : '最终行为 Gate：未通过' : '最终行为 Gate：未执行'}</h3>{gateFailureLabel ? <p className="prod-boundary prod-gate-failure-kind">{gateFailureLabel}：{active(run) ? '停止处理中' : '已停止'}，未作为代码质量返修。</p> : null}{run.gate?.summary ? <p>{run.gate.summary}</p> : null}{run.gate?.checks.map((check, index) => <div className={`prod-check ${check.passed ? '' : 'failed'}`} key={`${check.name}-${index}`}><span>{check.passed ? '通过' : '失败'}</span><b>{check.name}</b>{check.detail ? <p>{check.detail}</p> : null}</div>)}{run.gateHistory.length ? <details className="prod-output"><summary>全部 Gate 尝试（{run.gateHistory.length}）</summary><pre>{JSON.stringify(run.gateHistory, null, 2)}</pre></details> : null}</div><div className="prod-artifacts"><h3>交付物与证据</h3>{run.artifacts.length ? <div className="prod-artifact-list">{run.artifacts.map(artifact => <a className="prod-button" key={artifact.name} href={artifactUrl(run.id, artifact.name)} download={artifact.name}>{artifact.name}<small>{artifact.type}</small></a>)}</div> : <p className="prod-muted">尚无交付物。失败不会被替换成模板成功。</p>}{!isCamera ? <p className="prod-caption prod-download-warning">HTML 仅以源码文本下载。下载后在其他环境运行不再受平台隔离保护，不能视为网络安全承诺。</p> : sceneArtifact ? <p className="prod-caption prod-scene-download-note">scene.json 是声明式场景数据，不含模型脚本；下载文件不代表场景行为、摄像头或完整需求已验收。</p> : null}</div>{cameraPreviewReady ? <section className="prod-camera-delivery" aria-label="受控摄像头场景预览"><h3>声明式场景交互预览</h3><p className="prod-caption">新窗口只运行固定平台代码与已校验的场景数据，摄像头默认关闭。请手动授权；画面留在本机。场景 Gate 通过不能替代实机验收。</p><a className="prod-button prod-primary" href={`/api/production/runs/${encodeURIComponent(run.id)}/scene-preview`} target="_blank" rel="noopener noreferrer">打开受控场景预览</a><p className="prod-caption">关闭预览或停止摄像头会释放识别资源；不会恢复生成 HTML 的执行型 iframe。</p></section> : isCamera ? <p className="prod-camera-boundary">交互预览未开放；{sceneArtifact ? '可以下载上方已有场景与失败证据。' : run.artifacts.length ? '尚无场景文件，仅可下载上方已列出的证据。' : '尚无场景文件或交付物。'}</p> : null}{!isCamera && html ? <div className="prod-preview"><div><p>受控浏览器静态截图 · 不是实时交互预览</p><button className="prod-button" type="button" onClick={() => setPreview(!preview)}>{preview ? '关闭预览' : '打开运行预览'}</button></div><p className="prod-caption prod-preview-explanation">不在你的浏览器执行生成脚本。行为验收来自独立 Gate，截图不替代测试，也不证明产物安全。</p>{preview ? <ControlledPreview key={run.id} run={run} /> : null}</div> : null}</> : null}
{detail === 'calls' ? <><p className="prod-muted">{run.evidenceKind === 'fixture' || isHybrid ? '以下研发角色记录均为固定工程夹具的模拟环节记录，模型字段仅是配置快照；实际研发模型请求数为 0；Jev 原始决策在下方单独列出。' : '保留各次原始输出、错误与使用量；所选与被拒绝的候选均可追溯。'}不记录模型隐藏思维链。</p>{run.calls.length ? run.calls.map(call => <details className="prod-output" key={call.id}><summary><span>{ROLE_INFO[call.role].label} · {call.phase}</span><span className="prod-pill">{call.error ? call.verificationEngine ? '复核请求失败 / 未取得合法结论' : '调用失败' : call.selected ? '已选择' : '未选择 / 评审调用'}</span></summary><VerificationRequestContext call={call} jevCalls={jevCalls} /><CallRequestObservation call={call} /><div className="prod-call-meta"><p>{call.executionSource === 'mock' || run.evidenceKind === 'fixture' ? '未请求此模型 · 配置快照：' : ''}{call.model.provider} / {call.model.modelId} · {call.startedAt}</p><p>输入 {format(call.usage.inputTokens)} / 输出 {format(call.usage.outputTokens)} Token · 估算费用 {call.usage.estimatedCost == null ? 'unknown' : `${call.usage.estimatedCost.toFixed(4)} ${call.usage.currency}`}</p><p>Prompt {call.promptVersion} · <code>{call.promptHash}</code></p>{call.error ? <p className="prod-run-error">{call.error}</p> : null}</div><pre>{call.rawOutput || '（未收到输出）'}</pre><details className="prod-prompt"><summary>调用输入 Prompt 与配置 hash</summary><pre>{JSON.stringify({ candidateId: call.candidateId, verificationEngine: call.verificationEngine, sourceJevCallId: call.sourceJevCallId, configHash: call.configHash, systemPrompt: call.systemPrompt, userPrompt: call.userPrompt }, null, 2)}</pre></details></details>) : <p className="prod-empty-text">尚无请求或模拟环节记录。</p>}{jevCalls.length ? <JevDecisionEvidence calls={jevCalls} snapshot={run.jevSnapshot} dispatchOnly={run.evidenceKind === 'injected-test'} /> : null}</> : null}
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
  const [modelId, setModelId] = useState(agent?.modelId ?? PRODUCTION_DEFAULT_MODEL_ID);
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
