import { useEffect, useRef, useState } from 'react';
import type { ResearchProjectInput, ResidentAgentPublic } from '../server/research/residents';
import { fingerprint, surveyRunSummary, type SurveyRun, type SurveyRunSummary } from '../shared/survey-engine';
import { executeSurvey } from '../shared/survey-runner';
import { browserPresets, getBrowserModel, pagesPack, pagesPopulation } from './pages-api';
import { callBrowserModel } from './browser-model';
import { listSurveyRuns, parseSurveyEvidence, saveSurveyRun } from './run-history';
import { SurveyResults } from './SurveyResults';
import { researchApi } from './research-client';
import { runLocalSurvey } from './local-survey';
import type { AgentPublic } from '../server/types';
import { nextSurveyAudience } from './survey-audience';

const pagesMode = import.meta.env.MODE === 'pages';

export function PagesSurveyPanel({ readDraft, busy, onBusyChange, draftVersion }: { readDraft: () => ResearchProjectInput; busy: boolean; onBusyChange: (value: boolean) => void; draftVersion: number }) {
  const [mode, setMode] = useState<'fixture' | 'live'>('fixture');
  const [count, setCount] = useState(12); const fixtureCount = useRef(12); const [seed, setSeed] = useState(42);
  const [assumptions, setAssumptions] = useState(false); const [progress, setProgress] = useState('');
  const [error, setError] = useState(''); const [run, setRun] = useState<SurveyRun | null>(null); const [history, setHistory] = useState<SurveyRunSummary[]>([]);
  const packs = useRef(new Map<string, SurveyRun>()); const pinned = useRef(false); const historyToken = useRef(0);
  const [inputPrice, setInputPrice] = useState(''); const [outputPrice, setOutputPrice] = useState('');
  const [feeConsent, setFeeConsent] = useState<string | null>(null);
  const feeContext = fingerprint({ mode, count, seed, inputPrice, outputPrice, draftVersion });
  const feesAccepted = mode !== 'live' || feeConsent === feeContext;
  const [running, setRunning] = useState(false); const controller = useRef<AbortController | null>(null);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  async function loadPublished() {
    try { setError(''); const response = await fetch(`${import.meta.env.BASE_URL}submission/live-run.json`); if (!response.ok) throw new Error('已发布实测证据暂不可用。'); await keep(parseSurveyEvidence(await response.json())); setProgress('已载入公开的真实模型运行快照；本次只读，没有API请求。'); } catch (error) { setError((error as Error).message); }
  }
  async function deliver() {
    if (!run) return;
    if (!window.confirm('四角色交付会另外启动产品、研究员、研发、测试模型调用及可能的返修，产生独立费用，不在刚才的居民费用确认内。是否继续？')) return;
    setError(''); setDeliveryBusy(true);
    try {
      const response = await fetch('/api/agents'); if (!response.ok) throw new Error('无法读取本机研发团队。'); const agents = await response.json() as AgentPublic[];
      const ids = ['product', 'researcher', 'developer', 'tester'].map(role => { const agent = agents.find(value => value.role === role && value.enabled && value.hasApiKey); if (!agent) throw new Error(`请配置并启用${role}角色。`); return agent.id; });
      const created = await fetch('/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: `根据冻结问卷「${run.task.title}」生成离线研究展示页。展示有效分母、逐题结果、街道分组与限制，可切换分组。明确合成而非真人，不预测真实市场，不重新生成答卷。`, mode: 'live', agentIds: ids, researchSurveyId: run.id }) });
      const value = await created.json(); if (!created.ok) throw new Error(value.error || '交付任务创建失败。');
      setProgress(`四角色交付已启动 ${value.id}；请到任务工作台查看执行、页面和浏览器验收。不会再次请求居民作答。`);
    } catch (error) { setError((error as Error).message); } finally { setDeliveryBusy(false); }
  }
  useEffect(() => { let stopped = false; void (async () => {
    try {
      if (pagesMode) {
        const values = await listSurveyRuns(); if (stopped) return;
        for (const value of values) packs.current.set(value.id, value);
        setHistory(values.map(surveyRunSummary)); if (!pinned.current) setRun(values[0] ?? null);
      } else {
        const values = await researchApi<SurveyRunSummary[]>('/surveys'); if (stopped) return;
        setHistory(values); if (!values[0] || pinned.current) return;
        const token = ++historyToken.current;
        const detail = await researchApi<SurveyRun>(`/surveys/${values[0].id}`); if (stopped || pinned.current || historyToken.current !== token) return;
        packs.current.set(detail.id, detail); setRun(detail);
      }
    } catch (error) { if (!stopped) setError((error as Error).message); }
  })(); return () => { stopped = true; controller.current?.abort(); }; }, []);
  let matchesDraft = false; try { matchesDraft = !run || fingerprint(readDraft().task) === run.taskHash; } catch { /* Incomplete draft differs from immutable history. */ }
  const keep = async (value: SurveyRun) => { pinned.current = true; packs.current.set(value.id, value); setRun(value); if (pagesMode) await saveSurveyRun(value); setHistory(previous => [surveyRunSummary(value), ...previous.filter(old => old.id !== value.id)]); };
  async function showHistory(id: string) {
    const token = ++historyToken.current;
    if (!id) { setRun(null); return; }
    const cached = packs.current.get(id); if (cached) { setRun(cached); return; }
    try { const detail = await researchApi<SurveyRun>(`/surveys/${id}`); if (historyToken.current !== token) return; packs.current.set(detail.id, detail); setRun(detail); }
    catch (error) { if (historyToken.current === token) setError((error as Error).message); }
  }
  async function start() {
    setError(''); setRunning(true); onBusyChange(true); controller.current = new AbortController();
    try {
      if (!assumptions) throw new Error('请确认本次按显式画像假设开展合成实验。');
      if (!feesAccepted) throw new Error('请确认本次真实调用费用；修改问卷、样本或价格后须重新确认。');
      if (mode === 'live') setFeeConsent(null);
      const input = readDraft(); const allPresets = pagesMode ? browserPresets() : await researchApi<ResidentAgentPublic[]>('/resident-agents');
      const presets = input.residentAgentIds.map(id => { const preset = allPresets.find(agent => agent.id === id); if (!preset) throw new Error('请先选择人群预设。'); return preset; });
      const configurations = pagesMode && mode === 'live' ? new Map(presets.map(agent => [agent.id, getBrowserModel(agent.id)])) : new Map();
      const knownSecrets = pagesMode ? presets.filter(agent => agent.enabled && agent.hasApiKey).map(agent => getBrowserModel(agent.id).apiKey) : [];
      const priceIn = inputPrice.trim() ? Number(inputPrice) : null; const priceOut = outputPrice.trim() ? Number(outputPrice) : null;
      if ([priceIn, priceOut].some(price => price !== null && (!Number.isFinite(price) || price < 0))) throw new Error('单价须为非负数；未知请留空。');
      if (mode === 'live' && count > 12) throw new Error('真实模型首批最多12位受访者。');
      const pricing = { currency: 'CNY' as const, inputPerMillion: priceIn, outputPerMillion: priceOut, source: '页面用户填写，未经账单认证', suppliedAt: new Date().toISOString() };
      const result = pagesMode ? await executeSurvey({ task: input.task, population: pagesPopulation, pack: pagesPack, presets, count, seed, mode, signal: controller.current.signal,
        knownSecrets, pricing, progress: setProgress, checkpoint: keep, call: (profile, system, user, signal) => callBrowserModel(configurations.get(profile.presetId)!, system, user, signal) })
        : await runLocalSurvey({ ...input, mode, count, seed, pricing, assumptionsAccepted: true }, controller.current.signal, value => { void keep(value); setProgress(`已完成 ${value.responses.length}/${value.metrics.planned} · Harness问卷`); });
      await keep(result); setProgress(`运行已自动保存到${pagesMode ? '本机浏览器证据库' : '本机SQLite'}；导航或刷新后可从历史运行恢复。请同时导出备份。`);
    } catch (error) { setError((error as Error).message); }
    finally { setRunning(false); onBusyChange(false); }
  }
  return <section className="panel research-panel pages-simulation" aria-label="问卷仿真与结果">
    <div className="panel-heading"><h2>04 · 问卷仿真与结果</h2><span className="small-muted">RUN & EVIDENCE v2</span></div>
    <p className="research-note">逐人独立作答；格式校验与已登记画像硬约束分开报告。演示无需Key；{pagesMode ? '真实模式使用当前会话Key，接口须支持跨域。运行自动保存于本机浏览器，不上传GitHub；清理浏览器数据前请导出。' : '真实模式使用本机加密Key，通过DeepSeek Harness执行，运行保存在SQLite。'}</p>
    <fieldset disabled={busy}><div className="form-two"><label>运行方式<select value={mode} onChange={event => { const next = nextSurveyAudience({ mode, count: mode === 'fixture' ? fixtureCount.current : count, fixtureCount: fixtureCount.current }, event.target.value as typeof mode); fixtureCount.current = next.fixtureCount; setMode(next.mode); setCount(next.count); setFeeConsent(null); }}><option value="fixture">工程演示 · 不调用模型</option><option value="live">真实模型 · {pagesMode ? '浏览器直接调用' : 'DeepSeek Harness'}</option></select></label><label>计划受访者<input type="number" min={1} max={mode === 'live' ? 12 : 30} value={count} onChange={event => { const value = Number(event.target.value); setCount(value); if (mode === 'fixture') fixtureCount.current = value; setFeeConsent(null); }} /></label></div>
    <label>画像随机种子<input type="number" min={0} max={2147483647} value={seed} onChange={event => { setSeed(Number(event.target.value)); setFeeConsent(null); }} /></label>
    {mode === 'live' && <><p className="research-note">每人最多1次请求，不自动重试；输出上限3000 Token，超时90秒。单价会冻结进证据包；未知保持未知。</p><div className="form-two"><label>输入单价（元／百万 Token）<input type="number" step="any" min={0} value={inputPrice} onChange={event => { setInputPrice(event.target.value); setFeeConsent(null); }} placeholder="未知留空" /></label><label>输出单价（元／百万 Token）<input type="number" step="any" min={0} value={outputPrice} onChange={event => { setOutputPrice(event.target.value); setFeeConsent(null); }} placeholder="未知留空" /></label></div><p className="research-note warning">本页不是受控实验CLI：没有供应商钱包金额硬限额，结构无效不会自动停止后续居民。请先选1人，核对供应商价格和原文，再自行决定下一次运行；随时可取消。不得把未知用量当免费。</p><label className="checkbox-label"><input type="checkbox" checked={feesAccepted} onChange={event => setFeeConsent(event.target.checked ? feeContext : null)} />确认使用自己的 Key 支付本次最多 {count} 次模型请求；金额由供应商计费，本页不承诺费用硬上限。</label></>}
    <label className="checkbox-label"><input type="checkbox" checked={assumptions} onChange={event => setAssumptions(event.target.checked)} />确认本次按显式画像假设开展合成实验，结果不直接外推真人总体。</label></fieldset>
    <div className="research-save-bar"><button className="primary" disabled={busy || !assumptions || !feesAccepted} onClick={() => void start()}>{running ? '作答中…' : mode === 'fixture' ? '运行问卷演示' : '开始真实模型调查'}</button>{running && <button className="secondary" onClick={() => controller.current?.abort()}>取消</button>}{pagesMode && <button className="secondary" disabled={busy} onClick={() => void loadPublished()}>查看已发布实测 · 无需Key</button>}{!pagesMode && run?.state === 'completed' && run.metrics.valid > 0 && <button className="secondary" disabled={busy || deliveryBusy} onClick={() => void deliver()}>{deliveryBusy ? '创建交付…' : '交给四角色生成交付页'}</button>}</div>
    {error && <div className="alert error" role="alert">{error}</div>}<p className="research-note" role="status">{progress}</p>
    <div className="research-toolbar"><label>历史运行<select disabled={busy} value={run?.id ?? ''} onChange={event => { void showHistory(event.target.value); }}><option value="">选择运行证据</option>{history.map(value => <option key={value.id} value={value.id}>{value.startedAt} · {value.title} · {value.mode} · {value.metrics.valid}/{value.metrics.planned}</option>)}</select></label>{pagesMode && <label className="secondary intake-upload">导入v2运行证据<input disabled={busy} type="file" accept=".json,application/json" aria-label="导入运行证据" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { if (file.size > 6 * 1024 * 1024) throw new Error('证据包不能超过6MB。'); await keep(parseSurveyEvidence(JSON.parse(await file.text()))); setProgress('证据包已校验指纹并保存；导入不调用模型。'); } catch (error) { setError((error as Error).message); } }} /></label>}</div>
    {run && !matchesDraft && <p className="research-note warning">当前草稿与所选历史问卷不同；下方仍展示冻结的历史结果，不会被草稿修改覆盖。草稿修订 {draftVersion}。</p>}
    {run && <SurveyResults run={run} />}
  </section>;
}
