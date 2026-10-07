import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_JEV_CONFIG, JEV_ENDPOINT, JEV_MODEL_ID, type JevPublicConfig } from '../shared/jev-schema';

export default function JevSettings({ onConfigChange }: { onConfigChange: (config: JevPublicConfig) => void }) {
  const [config, setConfig] = useState<JevPublicConfig>({ ...DEFAULT_JEV_CONFIG, hasApiKey: false });
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [benchmarkAuthorized, setBenchmarkAuthorized] = useState(false);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [benchmarkId, setBenchmarkId] = useState<string | null>(null);
  const [benchmarks, setBenchmarks] = useState<unknown>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/production/jev/config', { signal: controller.signal }).then(async response => { const value = await response.json(); if (!response.ok) throw new Error(value.error || '读取 Jev 配置失败'); return value as JevPublicConfig; }).then(value => { if (!controller.signal.aborted) { setConfig(value); onConfigChange(value); } }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '读取 Jev 配置失败'); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    fetch('/api/production/jev/benchmarks', { signal: controller.signal }).then(async response => response.ok ? response.json() : null).then(value => { if (!controller.signal.aborted) { setBenchmarks(value); const running = Array.isArray(value) ? value.find(item => ['queued', 'running'].includes(item?.status)) : null; if (running?.id) { setBenchmarkId(running.id); setBenchmarkBusy(true); } } }).catch(() => {});
    return () => { controller.abort(); };
  }, [onConfigChange]);
  useEffect(() => {
    if (!benchmarkId) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; const started = Date.now();
    const poll = async () => {
      try {
        const response = await fetch('/api/production/jev/benchmarks', { signal: controller.signal }); const value = await response.json();
        if (!response.ok) throw new Error(value.error || '读取对照状态失败');
        if (controller.signal.aborted) return;
        setBenchmarks(value);
        const current = Array.isArray(value) ? value.find(item => item?.id === benchmarkId) : null;
        if (current?.status && !['queued', 'running'].includes(current.status)) { setBenchmarkBusy(false); setBenchmarkId(null); setNotice(`候选池对照进入终态：${current.status}。请查看全部结果，它不是自主生成或泛化成功率。`); return; }
        if (Date.now() - started > 190000) { setBenchmarkBusy(false); setBenchmarkId(null); setError('对照状态观察超时，不代表服务器已取消；请刷新账本或明确取消。'); return; }
        timer = setTimeout(poll, 1200);
      } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : '更新对照状态失败'); timer = setTimeout(poll, 2500); } }
    };
    timer = setTimeout(poll, 400);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [benchmarkId]);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    const secret = apiKey.trim(); setApiKey('');
    const { hasApiKey: _, ...publicFields } = config;
    try {
      const response = await fetch('/api/production/jev/config', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...publicFields, ...(clearKey ? { apiKey: null } : secret ? { apiKey: secret } : {}) }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error || '保存 Jev 配置失败');
      setConfig(payload as JevPublicConfig); onConfigChange(payload as JevPublicConfig); setClearKey(false); setNotice('Jev 设置已保存。Key 输入已清空，页面仅保留配置状态。');
    } catch (e) { setError(e instanceof Error ? e.message : '保存 Jev 配置失败；需要重新输入新 Key。'); }
    finally { setSaving(false); }
  }
  async function runBenchmarks() {
    setBenchmarkBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/production/jev/benchmarks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ budgetAuthorized: benchmarkAuthorized }) });
      const value = await response.json(); if (!response.ok) throw new Error(value.error || '运行 Jev 对照失败');
      if (typeof value.id !== 'string') throw new Error('启动响应缺少对照 ID；未假定运行成功。');
      setBenchmarkId(value.id); setNotice('已启动候选池对照，正在观察服务器状态；可取消。不会把启动响应当作完成证据。');
    } catch (e) { setError(e instanceof Error ? e.message : '运行 Jev 对照失败'); setBenchmarkBusy(false); }
  }
  async function cancelBenchmarks() {
    try { const response = await fetch('/api/production/jev/benchmarks/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error || '取消对照失败'); setNotice('已发送取消请求，等待服务器保存最终状态与清理结果。'); }
    catch (e) { setError(e instanceof Error ? e.message : '取消对照失败'); }
  }
  return <div className="prod-jev-layout">
    <form className="prod-panel prod-jev-form" onSubmit={save}>
      <div className="prod-section-heading"><h2>TypeSafe Jev 决策模型</h2><span className={`prod-pill ${config.hasApiKey ? '' : 'prod-pill-muted'}`}>{config.hasApiKey ? 'Key 已配置' : '未配置 Key'}</span></div>
      <p className="prod-muted">Jev 负责对候选做类型化决策，不生成代码，也不替代研发模型或浏览器行为 Gate。</p>
      {error ? <p className="prod-run-error" role="alert">{error}</p> : null}
      {notice ? <p className="prod-alert" role="status">{notice}</p> : null}
      <div className="prod-fields">
        <label className="prod-full" htmlFor="prod-jev-endpoint">固定官方 Endpoint<input id="prod-jev-endpoint" value={JEV_ENDPOINT} readOnly /></label>
        <label className="prod-full" htmlFor="prod-jev-model">固定模型版本<input id="prod-jev-model" value={JEV_MODEL_ID} readOnly /></label>
        <label className="prod-full" htmlFor="prod-jev-key">Jev API Key（{config.hasApiKey ? '已配置；留空保留' : '未配置'}）<input id="prod-jev-key" name="new-jev-api-key" type="password" minLength={16} pattern={"(?!.*[\"'\\\\])[\\x21-\\x7e]{16,500}"} title="新 Key 至少 16 个可见 ASCII 字符；不含引号、反斜线或空白" autoComplete="new-password" spellCheck={false} maxLength={500} disabled={clearKey || loading || saving} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="新 Key 至少 16 位，不含引号、反斜线或空白…" /></label>
        {config.hasApiKey ? <label className="prod-checkbox prod-full"><input type="checkbox" checked={clearKey} onChange={e => { setClearKey(e.target.checked); setApiKey(''); }} />清除 Jev Key</label> : null}
        <label htmlFor="prod-jev-concentration">最低分布集中度<input id="prod-jev-concentration" type="number" required min={0} max={1} step={0.01} value={config.minConfidence} onChange={e => setConfig(previous => ({ ...previous, minConfidence: Number(e.target.value) }))} /></label>
        <label htmlFor="prod-jev-score">每维最低加权分数（0–4）<input id="prod-jev-score" type="number" required min={0} max={4} step={0.1} value={config.minScore} onChange={e => setConfig(previous => ({ ...previous, minScore: Number(e.target.value) }))} /></label>
        <label htmlFor="prod-jev-input-price">输入单价 USD / 百万 Token<input id="prod-jev-input-price" type="number" required min={0} max={10000} step="any" value={config.inputPerMillion} onChange={e => setConfig(previous => ({ ...previous, inputPerMillion: Number(e.target.value) }))} /></label>
        <label htmlFor="prod-jev-output-price">输出单价 USD / 百万 Token<input id="prod-jev-output-price" type="number" required min={0} max={10000} step="any" value={config.outputPerMillion} onChange={e => setConfig(previous => ({ ...previous, outputPerMillion: Number(e.target.value) }))} /></label>
        <label htmlFor="prod-jev-requests">每任务最多 Jev 请求<input id="prod-jev-requests" type="number" required min={1} max={24} value={config.maxRequests} onChange={e => setConfig(previous => ({ ...previous, maxRequests: Number(e.target.value) }))} /></label>
        <label htmlFor="prod-jev-timeout">每次 Jev 超时（秒）<input id="prod-jev-timeout" type="number" required min={1} max={30} step={1} value={config.timeoutMs / 1000} onChange={e => setConfig(previous => ({ ...previous, timeoutMs: Number(e.target.value) * 1000 }))} /></label>
        <label className="prod-checkbox prod-full"><input type="checkbox" checked={config.enabled} onChange={e => setConfig(previous => ({ ...previous, enabled: e.target.checked }))} />启用 Jev 候选验证</label>
      </div>
      <p className="prod-caption prod-jev-pricing">默认价格来自 2026-10-07 官方模型文档：输入 0.042 USD / 百万 Token，输出免费。费用是按用量估算，不是供应商账单；价格可能变动，需核对。此处不迁移其他研发线的 Key。</p>
      <div className="prod-dialog-actions"><button className="prod-button prod-primary" type="submit" disabled={loading || saving}>{loading ? '载入中…' : saving ? '保存中…' : '保存 Jev 设置'}</button></div>
    </form>
    <aside className="prod-panel prod-jev-explainer"><h2>决策边界与回退策略</h2><ol><li>批量拆成验收覆盖、约束一致性、范围可执行性三个 Score，独立 Noul 范围判断与含弃权选项的 Choice。</li><li>每个候选都检查，包括只有一个候选；按固定门限决定接受、不确定或拒绝。</li><li>低集中度不是失败概率：真实生产可进入独立 LLM 复核；混合 Mock 没有研发模型，不能伪造复核。</li><li>异常响应、未知用量、HTTP 错误不默认为通过，不自动付费重试。</li><li>通过 Jev 也必须通过研发之前冻结的最终浏览器行为 Gate。</li></ol><div className="prod-boundary">confidence 是分布集中程度，不等于答案正确率。默认 0.5 集中度与 3/4 分数是预先声明的工程门限，尚未经过本场景标注集校准。</div><p className="prod-caption">固定版本避免 latest 别名漂移；后续调门限或换模型必须开启新的实验版本，不改写旧结果。</p><div className="prod-jev-sources"><a href="https://docs.typesafe.ai/api" target="_blank" rel="noreferrer noopener">官方 API</a><a href="https://docs.typesafe.ai/confidence" target="_blank" rel="noreferrer noopener">集中度定义</a><a href="https://docs.typesafe.ai/models" target="_blank" rel="noreferrer noopener">模型与价格</a></div><div className="prod-jev-benchmark"><h3>3 组固定候选池质量对照</h3><p className="prod-caption">对照使用预制合成候选，不是现场研发。只检验决策是否选中满足已知契约的候选；不证明通用质量提升或自主开发成功。</p><label className="prod-checkbox"><input type="checkbox" checked={benchmarkAuthorized} onChange={e => setBenchmarkAuthorized(e.target.checked)} />授权本次有界 Jev 对照费用（3 组，不自动重试）</label><button className="prod-button" type="button" disabled={loading || saving || benchmarkBusy || !benchmarkAuthorized || !config.enabled || !config.hasApiKey} onClick={() => void runBenchmarks()}>{benchmarkBusy ? '对照运行中…' : '运行 3 组 Jev 候选对照'}</button>{benchmarkBusy ? <><p className="prod-caption" role="status">对照 {benchmarkId ?? '启动中'} 正在执行；离开页面只停止观察，不自动取消服务器任务。</p><button className="prod-button prod-danger" type="button" onClick={() => void cancelBenchmarks()}>取消 Jev 对照</button></> : null}{benchmarks ? <details className="prod-output"><summary>对照原始记录（合成候选，不是真实生成）</summary><pre>{JSON.stringify(benchmarks, null, 2)}</pre></details> : null}</div></aside>
  </div>;
}
