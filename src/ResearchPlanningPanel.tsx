import { useEffect, useRef, useState } from 'react';
import type { ResearchTask } from '../shared/research-schema';
import type { ResearchPlanningResult } from '../shared/research-planning';
import type { AgentPublic } from '../server/types';
import { downloadJson } from './research-client';

const pagesMode = import.meta.env.MODE === 'pages';
export function ResearchPlanningPanel({ population, draftVersion, disabled, onBusyChange, onApply }: {
  population: ResearchTask['population']; draftVersion: number; disabled: boolean;
  onBusyChange: (busy: boolean) => void; onApply: (task: ResearchTask) => void;
}) {
  const [agents, setAgents] = useState<AgentPublic[]>([]);
  const [agentId, setAgentId] = useState('');
  const [request, setRequest] = useState('');
  const [context, setContext] = useState('');
  const [maxQuestions, setMaxQuestions] = useState(12);
  const [acknowledgeCost, setAcknowledgeCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ResearchPlanningResult | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const [resultRevision, setResultRevision] = useState(-1);
  const controller = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  useEffect(() => {
    if (pagesMode) return;
    const abort = new AbortController();
    fetch('/api/research/planning/agents', { signal: abort.signal }).then(async response => {
      if (!response.ok) throw new Error('无法读取规划模型，请检查本机服务。');
      return response.json() as Promise<AgentPublic[]>;
    }).then(items => {
      if (!abort.signal.aborted) { setAgents(items); setAgentId(items.find(item => item.hasApiKey)?.id ?? items[0]?.id ?? ''); }
    }).catch(cause => { if (!abort.signal.aborted) setError((cause as Error).message); });
    return () => { abort.abort(); controller.current?.abort(); };
  }, []);
  function invalidate() { requestVersion.current++; setResult(null); setFailure(null); setError(''); }
  async function plan() {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    const version = requestVersion.current; const revision = draftVersion;
    setBusy(true); onBusyChange(true); setError(''); setResult(null); setFailure(null);
    try {
      const response = await fetch('/api/research/planning', {
        method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, acknowledgeCost, request, context, maxQuestions,
          population: { regionCode: population.regionCode, period: population.period, unit: population.unit } }),
      });
      const payload = await response.json();
      if (abort.signal.aborted || version !== requestVersion.current) return;
      if (!response.ok) { setFailure(payload); throw new Error(payload.error || `规划失败（${response.status}）`); }
      setResult(payload); setResultRevision(revision);
    } catch (cause) {
      if (abort.signal.aborted) setError('规划已取消。不会自动重试；已发请求仍可能计费，服务会关闭该Harness进程。');
      else if (version === requestVersion.current) setError((cause as Error).message);
    } finally { controller.current = null; setBusy(false); onBusyChange(false); }
  }
  if (pagesMode) return <section className="panel research-panel" aria-label="自然语言研究规划"><h2>自然语言研究规划 · 本机Harness能力</h2><p className="research-note">当前GitHub Pages不运行Harness规划服务。可在本机版显式调用产品/研究员模型生成候选问卷，或在这里继续手动编辑/导入问卷。没有新增调用，不会自动套用学校/宠物关键词模板。</p><a href={`${import.meta.env.BASE_URL}review-guide.html`} className="text-button" target="_blank" rel="noreferrer">查看本机复现方式 ↗</a></section>;
  const selected = agents.find(agent => agent.id === agentId);
  return <section className="panel research-panel" aria-label="自然语言研究规划">
    <div className="panel-heading"><h2>自然语言 → 候选任务与问卷</h2><span className="small-muted">RESEARCH PLANNER</span></div>
    <p className="research-note">这是一次独立的产品/研究员Harness规划调用，不是居民答卷。单次最长90秒、最多6000输出Token，无自动重试；调用数不是供应商收费次数认证。模型只提出可编辑候选、澄清和补采项，不认证事实、不启动调查，也不自动给出真实选址或销量。</p>
    <label>规划模型<select disabled={busy || disabled} value={agentId} onChange={event => { setAgentId(event.target.value); invalidate(); }}><option value="">选择产品或研究员 Agent</option>{agents.map(agent => <option key={agent.id} value={agent.id}>{agent.name} · {agent.modelId} · {agent.hasApiKey ? '已填Key' : '未填Key'}</option>)}</select></label>
    <p className="research-note">在“智能体团队”中配置产品/研究员后重新打开此面板。居民预设的Key不会转移。人口背景：{population.regionCode} / {population.period} / {population.unit}；历史时点不自动替换为现在。</p>
    <label>用自然语言描述研究需求<textarea rows={4} maxLength={8000} value={request} disabled={busy || disabled} onChange={event => { setRequest(event.target.value); invalidate(); }} /></label>
    <label>补充背景与限制（可选，不填写密钥或个人明细）<textarea rows={3} maxLength={4000} value={context} disabled={busy || disabled} onChange={event => { setContext(event.target.value); invalidate(); }} /></label>
    <label>最多题数<input type="number" min={1} max={20} value={maxQuestions} disabled={busy || disabled} onChange={event => { setMaxQuestions(Number(event.target.value)); invalidate(); }} /></label>
    <label className="checkbox-label"><input type="checkbox" checked={acknowledgeCost} disabled={busy || disabled} onChange={event => setAcknowledgeCost(event.target.checked)} />我确认启动最多一次模型请求，可能产生费用；无自动重试，费用未知不记零。</label>
    <div className="research-save-bar"><button type="button" className="primary" disabled={busy || disabled || !request.trim() || !selected?.hasApiKey || !acknowledgeCost || !Number.isInteger(maxQuestions) || maxQuestions < 1 || maxQuestions > 20} onClick={() => void plan()}>{busy ? '正在规划候选…' : '生成候选问卷 · 调用模型'}</button>{busy && <button type="button" className="secondary" onClick={() => controller.current?.abort()}>取消规划</button>}</div>
    {error && <p className="alert error" role="alert">{error}</p>}
    {failure !== null && <button type="button" className="secondary" onClick={() => downloadJson(failure, 'research-planning-failure.json')}>导出脱敏失败证据</button>}
    {result && <div className="check-results" aria-live="polite">
      <h3>候选研究 · {result.task.title}</h3>
      <p className="research-note warning">候选尚未作答，来源/资格/现实效度未验证。应用只替换草稿，仍须保存、预检和显式启动。</p>
      {draftVersion !== resultRevision && <p className="research-note warning">草稿已改变，不能将旧候选覆盖到新背景，请重新规划。</p>}
      <details open><summary>澄清、假设、证据缺口与限制</summary><pre className="evidence-audit-json">{JSON.stringify({ assumptions: result.assumptions, clarifications: result.clarifications, dataGaps: result.dataGaps, limitations: result.limitations }, null, 2)}</pre></details>
      <details><summary>候选问卷与规划证据</summary><pre className="evidence-audit-json">{JSON.stringify(result, null, 2)}</pre></details>
      <div className="research-save-bar"><button type="button" className="primary" disabled={disabled || draftVersion !== resultRevision} onClick={() => onApply(result.task)}>应用候选至草稿 · 不启动调查</button><button type="button" className="secondary" onClick={() => downloadJson(result, 'research-planning-candidate.json')}>导出候选与规划证据</button></div>
    </div>}
  </section>;
}
