import { useEffect, useRef, useState } from 'react';
import type { z } from 'zod';
import type { ProductionAgent } from '../shared/production-schema';
import {
  verifierStudyPreparationSchema, verifierStudyPublicRunSchema, verifierStudyRunListSchema,
  type VerifierStudyExecutionSource, type VerifierStudyPreparation, type VerifierStudyPublicRun,
} from '../shared/verifier-study-control-schema';
import './verifier-study.css';

const BASE = '/api/production/verifier-studies';
const STATUS: Record<VerifierStudyPublicRun['status'], string> = {
  running: '评测执行中', completed: '评测记录完成', failed: '评测失败', cancelled: '已取消', interrupted: '已中断（不会自动恢复）',
};
const number = (value: number | null | undefined) => value == null ? 'unknown' : new Intl.NumberFormat('zh-CN').format(value);
const money = (value: number | null | undefined) => value == null ? 'unknown' : `USD ${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 9 }).format(value)}`;
const running = (run: VerifierStudyPublicRun | null) => run?.status === 'running';
const modeName = (source: VerifierStudyExecutionSource) => source === 'real-provider' ? '真实模型 · 可能付费' : '免费工程 · 合成决策';

async function request<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { method: body === undefined ? 'GET' : 'POST', signal,
    headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload ? (payload as { error?: unknown }).error : null;
    throw new Error(typeof error === 'string' ? error : `评测请求失败（${response.status}）`);
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) throw new Error('评测响应与公开契约不一致；不会据此启动或恢复。');
  return parsed.data;
}

export default function VerifierStudyPanel({ agents, disabled }: { agents: ProductionAgent[]; disabled: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<VerifierStudyExecutionSource>('loopback-engineering');
  const [verifierId, setVerifierId] = useState('');
  const [preparation, setPreparation] = useState<VerifierStudyPreparation | null>(null);
  const [expired, setExpired] = useState(false);
  const [consumed, setConsumed] = useState(false);
  const [billingAck, setBillingAck] = useState(false);
  const [jevAck, setJevAck] = useState(false);
  const [runs, setRuns] = useState<VerifierStudyPublicRun[]>([]);
  const [run, setRun] = useState<VerifierStudyPublicRun | null>(null);
  const [busy, setBusy] = useState<'prepare' | 'start' | 'cancel' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const mounted = useRef(true);
  const selectionVersion = useRef(0);
  const operationVersion = useRef(0);
  const operationPending = useRef(false);
  const historyVersion = useRef(0);
  const operationController = useRef<AbortController | null>(null);
  const historyController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const currentRun = useRef(run);
  const eligible = agents.filter(agent => agent.role === 'verifier' && agent.enabled);
  const selectedId = verifierId || eligible[0]?.id || '';
  const selectedAgent = eligible.find(agent => agent.id === selectedId);
  const configurationKey = JSON.stringify({ mode, ...(mode === 'real-provider' ? { selectedId, agent: selectedAgent ?? null } : {}) });
  const currentConfiguration = useRef(configurationKey);
  currentConfiguration.current = configurationKey;
  currentRun.current = run;
  const anyRunning = running(run) || runs.some(item => running(item));
  const blocked = disabled || anyRunning;

  function advanceSelection() { const version = ++selectionVersion.current; setSelectionEpoch(version); return version; }

  function invalidatePreparation() {
    operationController.current?.abort(); operationVersion.current++; operationPending.current = false;
    setBusy(null); setPreparation(null); setExpired(false); setConsumed(false); setBillingAck(false); setJevAck(false);
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false; operationVersion.current++; selectionVersion.current++; historyVersion.current++;
      operationController.current?.abort(); historyController.current?.abort(); detailController.current?.abort();
    };
  }, []);
  // A page-config change cannot carry a previous freeze/checkbox authorization.
  useEffect(() => { invalidatePreparation(); }, [configurationKey]);
  useEffect(() => {
    if (!preparation) return;
    const remaining = Date.parse(preparation.expiresAt) - Date.now();
    setExpired(remaining <= 0);
    const timer = remaining > 0 ? setTimeout(() => { setExpired(true); setBillingAck(false); setJevAck(false); }, Math.min(remaining, 2_147_483_647)) : undefined;
    return () => { if (timer) clearTimeout(timer); };
  }, [preparation?.id, preparation?.expiresAt]);

  async function refresh() {
    historyController.current?.abort();
    const controller = new AbortController(); historyController.current = controller;
    const version = ++historyVersion.current; const selected = selectionVersion.current;
    setLoading(true); setError('');
    try {
      const history = await request('', verifierStudyRunListSchema, controller.signal);
      if (!mounted.current || controller.signal.aborted || version !== historyVersion.current) return;
      const latest = currentRun.current;
      setRuns(latest && !history.some(item => item.id === latest.id) ? [latest, ...history] : history);
      if (selectionVersion.current === selected) setRun(previous => previous ?? history[0] ?? null);
    } catch (e) {
      if (mounted.current && !controller.signal.aborted && version === historyVersion.current) setError(e instanceof Error ? e.message : '读取评测记录失败');
    } finally {
      if (mounted.current && version === historyVersion.current) setLoading(false);
    }
  }
  useEffect(() => {
    if (!expanded) return;
    void refresh();
    return () => { historyVersion.current++; historyController.current?.abort(); detailController.current?.abort(); };
  }, [expanded]);

  useEffect(() => {
    if (!expanded || !run || !running(run)) return;
    const id = run.id; const version = selectionVersion.current; const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await request(`/${encodeURIComponent(id)}`, verifierStudyPublicRunSchema, controller.signal);
        if (!mounted.current || controller.signal.aborted || version !== selectionVersion.current) return;
        if (next.id !== id) throw new Error('评测状态来源不匹配；已停止更新。');
        setRun(previous => previous?.id === id && previous.status === 'running' ? next : previous);
        setRuns(previous => previous.map(item => item.id === id && item.status === 'running' ? next : item));
        if (running(next)) timer = setTimeout(poll, 1200);
      } catch (e) {
        if (!controller.signal.aborted && mounted.current && version === selectionVersion.current) {
          setError(e instanceof Error ? e.message : '更新评测状态失败'); timer = setTimeout(poll, 2500);
        }
      }
    };
    timer = setTimeout(poll, 500);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [expanded, run?.id, run?.status, selectionEpoch]);

  function toggle() {
    if (expanded) {
      invalidatePreparation(); historyVersion.current++; advanceSelection();
      historyController.current?.abort(); detailController.current?.abort(); setLoading(false);
    }
    setExpanded(previous => !previous);
  }
  async function prepare() {
    if (operationPending.current || blocked) return;
    if (mode === 'real-provider' && !selectedAgent) { setError('请先选择本工作区的 Verifier Agent。'); return; }
    const configuration = configurationKey; const version = ++operationVersion.current;
    const controller = new AbortController(); operationController.current = controller; operationPending.current = true;
    setBusy('prepare'); setError(''); setNotice(''); setPreparation(null); setBillingAck(false); setJevAck(false); setConsumed(false);
    try {
      const value = await request('/prepare', verifierStudyPreparationSchema, controller.signal,
        { executionSource: mode, ...(mode === 'real-provider' ? { verifierAgentId: selectedId } : {}) });
      if (!mounted.current || controller.signal.aborted || version !== operationVersion.current || currentConfiguration.current !== configuration) return;
      if (value.executionSource !== mode) throw new Error('冻结响应的执行来源不匹配，请重新准备。');
      setPreparation(value); setNotice('配置已冻结；尚未启动，也未调用模型。请核对后明确点击启动。');
    } catch (e) {
      if (mounted.current && !controller.signal.aborted && version === operationVersion.current) setError(e instanceof Error ? e.message : '准备评测失败');
    } finally {
      if (version === operationVersion.current) { operationPending.current = false; if (mounted.current) setBusy(null); }
    }
  }
  async function start() {
    if (operationPending.current || blocked || !preparation || consumed) return;
    if (Date.parse(preparation.expiresAt) <= Date.now()) { setExpired(true); setError('冻结准备已过期，请重新准备；不会自动启动。'); return; }
    if (preparation.executionSource !== mode || mode === 'real-provider' && (!billingAck || !jevAck)) return;
    const version = ++operationVersion.current; const selected = advanceSelection();
    const configuration = configurationKey; const controller = new AbortController(); operationController.current = controller;
    operationPending.current = true; setBusy('start'); setError(''); setBillingAck(false); setJevAck(false);
    try {
      const next = await request('/start', verifierStudyPublicRunSchema, controller.signal, {
        preparationId: preparation.id, estimatedBillingOnlyAcknowledged: true, jevOutputObservationOnlyAcknowledged: true,
      });
      if (!mounted.current || controller.signal.aborted || version !== operationVersion.current || currentConfiguration.current !== configuration) return;
      if (next.executionSource !== preparation.executionSource || next.frozenStudySha256 !== preparation.frozenStudySha256) throw new Error('启动响应与已确认的冻结版本不匹配，请刷新记录核对。');
      setConsumed(true); setRuns(previous => [next, ...previous.filter(item => item.id !== next.id)]);
      if (selected === selectionVersion.current) setRun(next);
      setNotice(next.executionSource === 'real-provider' ? '本次真实评测已启动。仅持续读取进度，不会自动重试或恢复付费调用。' : '已启动免费工程评测：真实执行器与 Chromium，合成模型决策，不计为真实模型效果。');
    } catch (e) {
      if (mounted.current && !controller.signal.aborted && version === operationVersion.current) {
        setConsumed(true); setError(`${e instanceof Error ? e.message : '启动请求未确认'} 请刷新记录核对；不会自动重发启动请求。`);
      }
    } finally {
      if (version === operationVersion.current) { operationPending.current = false; if (mounted.current) setBusy(null); }
    }
  }
  async function selectRun(id: string) {
    detailController.current?.abort(); const controller = new AbortController(); detailController.current = controller;
    const version = advanceSelection(); setError('');
    try {
      const next = await request(`/${encodeURIComponent(id)}`, verifierStudyPublicRunSchema, controller.signal);
      if (!mounted.current || controller.signal.aborted || version !== selectionVersion.current) return;
      if (next.id !== id) throw new Error('评测记录来源不匹配。');
      setRun(next); setRuns(previous => previous.map(item => item.id === id ? next : item));
    } catch (e) { if (mounted.current && !controller.signal.aborted && version === selectionVersion.current) setError(e instanceof Error ? e.message : '读取评测详情失败'); }
  }
  async function cancel() {
    if (!run || !running(run) || operationPending.current) return;
    const id = run.id; const selected = advanceSelection(); const version = ++operationVersion.current;
    const controller = new AbortController(); operationController.current = controller; operationPending.current = true;
    setBusy('cancel'); setError(''); setBillingAck(false); setJevAck(false);
    try {
      const next = await request(`/${encodeURIComponent(id)}/cancel`, verifierStudyPublicRunSchema, controller.signal, {});
      if (!mounted.current || controller.signal.aborted || version !== operationVersion.current) return;
      if (next.id !== id) throw new Error('取消响应的运行来源不匹配，请刷新核对。');
      if (selectionVersion.current === selected) setRun(previous => previous?.id === id ? next : previous);
      setRuns(previous => previous.map(item => item.id === id ? next : item));
      setNotice('取消操作已返回。请以运行终态和证据中的清理记录为准；不会自动恢复。');
    } catch (e) { if (mounted.current && !controller.signal.aborted && version === operationVersion.current) setError(e instanceof Error ? e.message : '取消请求未确认，请刷新核对'); }
    finally { if (version === operationVersion.current) { operationPending.current = false; if (mounted.current) setBusy(null); } }
  }

  const canStart = !blocked && !busy && preparation && !expired && !consumed && preparation.executionSource === mode
    && (mode === 'loopback-engineering' || billingAck && jevAck);
  const summary = run?.summary;
  const estimate = preparation ? preparation.plan.poolIds.length * (
    (preparation.plan.strategies.includes('llm') ? 1 : 0) * preparation.plan.reservations.llm.estimatedCostUsd
    + (preparation.plan.strategies.includes('jev-cascade') ? preparation.plan.reservations.jev.estimatedCostUsd + preparation.plan.reservations.llm.estimatedCostUsd : 0)) : null;
  return <section className="verifier-study-panel" aria-labelledby="verifier-study-title">
    <div className="verifier-study-heading"><div><h2 id="verifier-study-title">Verifier A/B/C 评测</h2><p>18 个固定候选池 · 54 次盲决策 · 36 个实际行为 Oracle。与软件需求交付分开记账。</p></div>
      <button type="button" className="prod-button verifier-study-toggle" aria-expanded={expanded} aria-controls="verifier-study-content" onClick={toggle}>{expanded ? '收起评测入口' : '展开评测并测试'}</button></div>
    {expanded ? <div id="verifier-study-content">
      <p className="verifier-study-boundary">免费工程验证真实执行链；真实评测才衡量模型选择。评测完成不等于自主交付成功。收起页面不会取消已启动运行，重新展开只读取记录。</p>
      {error ? <p className="verifier-study-error" role="alert">{error}</p> : null}
      {notice ? <p className="verifier-study-notice" role="status">{notice}</p> : null}
      <fieldset className="verifier-study-mode"><legend>评测执行来源（默认免费）</legend>
        <label><input type="radio" name="verifier-study-mode" value="loopback-engineering" checked={mode === 'loopback-engineering'} disabled={busy === 'start'} onChange={() => { invalidatePreparation(); setMode('loopback-engineering'); }} />免费工程评测（不调用真实模型）</label>
        <label><input type="radio" name="verifier-study-mode" value="real-provider" checked={mode === 'real-provider'} disabled={busy === 'start'} onChange={() => { invalidatePreparation(); setMode('real-provider'); }} />真实模型评测（确认后可能付费）</label>
      </fieldset>
      {mode === 'loopback-engineering' ? <p className="verifier-study-free">不读取生产模型 Key。LLM 使用本机 loopback 假供应商；Jev 为 18 次内存 fixture dispatch，不是 18 个 HTTP 请求。Token 与选择是合成数据，不证明模型效果。</p>
        : <div className="verifier-study-real"><label htmlFor="verifier-study-agent">本次 Verifier Agent<select id="verifier-study-agent" value={selectedId} disabled={busy === 'start'} onChange={event => { invalidatePreparation(); setVerifierId(event.target.value); }}>
          {!eligible.length ? <option value="">请在研发团队配置 Verifier</option> : null}{eligible.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.modelId}</option>)}
        </select></label><p>只使用本工作区页面设置的 Verifier 与 Jev；不迁移其他分支 Key。准备仅冻结配置，不调用模型。供应商实际账单始终不能由 Token 估算代替。</p></div>}
      {blocked ? <p className="verifier-study-notice">已有任务或评测正在执行，当前不能准备或启动另一批；仍可查看记录并取消选中的活动评测。</p> : null}
      <button className="prod-button" type="button" disabled={blocked || !!busy || mode === 'real-provider' && !selectedAgent} onClick={() => void prepare()}>{busy === 'prepare' ? '正在冻结配置…' : mode === 'real-provider' ? '准备真实评测（尚不调用）' : '准备免费工程评测'}</button>
      {preparation ? <div className="verifier-study-freeze" aria-labelledby="verifier-study-freeze-title">
        <h3 id="verifier-study-freeze-title">本次冻结配置与执行边界</h3><p><strong>{modeName(preparation.executionSource)}</strong> · 到期 {new Date(preparation.expiresAt).toLocaleString('zh-CN')}</p>
        <dl><dt>冻结 SHA-256</dt><dd className="verifier-study-hash">{preparation.frozenStudySha256}</dd>
          <dt>LLM</dt><dd>{preparation.plan.configuration.verifier.name} · {preparation.plan.configuration.verifier.provider} / {preparation.plan.configuration.verifier.modelId}<br />{preparation.plan.configuration.verifier.baseUrl}</dd>
          <dt>Jev</dt><dd>{preparation.plan.configuration.jev.modelId} · 每维 ≥ {preparation.plan.configuration.jev.minScore}/4 · 集中度 ≥ {preparation.plan.configuration.jev.minConfidence}</dd>
          <dt>固定计划</dt><dd>{preparation.plan.poolIds.length} 池 / {preparation.plan.strategies.join(' → ')}；最多 {preparation.plan.limits.maxCalls} 调用意图；独立重作答，绕过答案缓存</dd>
          <dt>时间 / 估算预算</dt><dd>{number(preparation.plan.limits.maxDurationMs / 60000)} 分钟触发停止；预算 {money(preparation.plan.limits.maxEstimatedCostUsd)}；最大调用费率估算 {money(estimate)}</dd>
          <dt>输入 / 输出预留</dt><dd>LLM {number(preparation.plan.reservations.llm.inputTokens)} / {number(preparation.plan.reservations.llm.outputTokens)}；Jev {number(preparation.plan.reservations.jev.inputTokens)} / {number(preparation.plan.reservations.jev.outputTokens)}（仅观测后停止）</dd>
          <dt>声明单价（每百万 Token）</dt><dd>LLM 输入 {money(preparation.plan.configuration.verifier.pricing.inputPerMillion)} / 输出 {money(preparation.plan.configuration.verifier.pricing.outputPerMillion)}；Jev 输入 {money(preparation.plan.configuration.jev.inputPerMillion)} / 输出 {money(preparation.plan.configuration.jev.outputPerMillion)}</dd>
        </dl><p>候选顺序未随机化；模型参数、费率、请求与 Gate 按冻结版本保存。30 分钟为停止门限，取消后仍等待清理；未知 usage/HTTP 停止，不记成零。</p>
        {mode === 'real-provider' ? <fieldset className="verifier-study-consent"><legend>仅授权这一个冻结版本，不自动续跑</legend>
          <label><input type="checkbox" checked={billingAck} disabled={consumed || expired || !!busy} onChange={event => setBillingAck(event.target.checked)} />我理解 1 USD 是估算预算，不是供应商计费硬上限；已发生的超额或未知费用保留并停止后续调用。</label>
          <label><input type="checkbox" checked={jevAck} disabled={consumed || expired || !!busy} onChange={event => setJevAck(event.target.checked)} />我理解 Jev 输出 4,096 Token 仅为响应后观测停止门限，不能保证供应商事前限制输出。</label>
        </fieldset> : null}
        {expired ? <p role="status">冻结准备已过期，请重新准备；不会自动启动。</p> : consumed ? <p role="status">本次启动已提交或结果未确认。不能重复使用准备，请核对记录后再准备新批次。</p> : null}
        <button type="button" className={`prod-button${mode === 'real-provider' ? ' verifier-study-paid-start' : ''}`} disabled={!canStart} onClick={() => void start()}>{busy === 'start' ? '正在提交启动…' : mode === 'real-provider' ? '确认并启动本次真实付费评测' : '启动免费工程评测'}</button>
      </div> : null}
      <div className="verifier-study-records"><div className="verifier-study-heading"><h3>运行记录与最新进度</h3><button type="button" className="prod-button" disabled={loading} onClick={() => void refresh()}>{loading ? '正在读取…' : '刷新评测记录'}</button></div>
        {runs.length ? <div className="verifier-study-history" aria-label="评测运行记录">{runs.slice(0, 12).map(item => <button type="button" key={item.id} aria-pressed={run?.id === item.id} onClick={() => void selectRun(item.id)}>{item.id.slice(0, 8)} · {modeName(item.executionSource)} · {STATUS[item.status]}</button>)}</div> : loading ? <p role="status">正在读取评测记录…</p> : <p>尚无本工作区评测记录。不会自动启动、恢复或重放付费调用。</p>}
        {run ? <div className="verifier-study-run" aria-labelledby="verifier-study-run-title"><h4 id="verifier-study-run-title">{STATUS[run.status]}</h4><p>{modeName(run.executionSource)} · {run.id}</p><p className="verifier-study-hash">冻结 {run.frozenStudySha256}</p>
          <dl><dt>已完成决策</dt><dd>{number(run.progress.decisions)} / 54</dd><dt>调用意图</dt><dd>{number(run.progress.calls)} / 最多 54</dd><dt>已返回 Oracle</dt><dd>{number(run.progress.oracles)} / 36</dd><dt>已落盘事件</dt><dd>{number(run.progress.ledgerEvents)}</dd>
            <dt>外部供应商 dispatch</dt><dd>{number(summary?.actualProviderHttpAttempts)}（不是到账或计费证明）</dd><dt>本地 fixture dispatch</dt><dd>{number(summary?.localFixtureHttpAttempts)}（含 loopback HTTP 与内存 Jev，不等于 HTTP 总数）</dd>
            <dt>{run.executionSource === 'real-provider' ? '真实模型 Token' : '合成 Token（非真实模型）'}</dt><dd>{run.executionSource === 'real-provider' ? summary?.actualModelUsage ? `${number(summary.actualModelUsage.inputTokens)} 输入 / ${number(summary.actualModelUsage.outputTokens)} 输出` : 'unknown' : summary ? `${number(summary.usage.knownInputTokens)} 输入 / ${number(summary.usage.knownOutputTokens)} 输出${summary.usage.complete ? '' : ' + unknown'}` : 'unknown'}</dd>
            <dt>{run.executionSource === 'real-provider' ? '总声明费率估算' : '合成声明费率估算（非账单）'}</dt><dd>{summary?.usage.complete ? money(summary.usage.knownEstimatedCost) : `unknown${summary ? `（已知 ${money(summary.usage.knownEstimatedCost)}；${number(summary.usage.unknownCalls)} 次 usage 未观测）` : ''}`}</dd>
            <dt>供应商实际账单</dt><dd>{run.executionSource === 'real-provider' ? 'unknown（费率估算不能替代账单）' : '不产生真实模型费用（仅免费工程模式）'}</dd>
          </dl>{run.error || summary?.reason ? <p className="verifier-study-error" role="alert">{run.error ?? summary?.reason}</p> : null}
          {summary ? <div className="verifier-study-results">{summary.byStrategy.map(row => <p key={row.strategy}><strong>{row.strategy}</strong>：选择后行为通过 {row.selectedOraclePass}，行为失败 {row.selectedOracleFail}，未知 {row.selectedOracleUnknown}；未开始 {row.notStarted}。{run.executionSource === 'loopback-engineering' ? '固定合成选择，不是模型效果。' : '此固定候选实验不证明通用自主交付。'}</p>)}</div> : null}
          {running(run) ? <button type="button" className="prod-button" disabled={!!busy} onClick={() => void cancel()}>{busy === 'cancel' ? '等待取消与清理结果…' : '取消当前评测'}</button> : null}
          {run.status === 'interrupted' ? <p>历史中断运行仅供追溯。继续实验需重新准备并明确启动，页面不会恢复付费调用。</p> : null}
        </div> : null}
      </div>
    </div> : null}
  </section>;
}
