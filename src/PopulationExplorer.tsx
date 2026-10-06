import { useEffect, useState } from 'react';
import type { CompiledPopulation, RegionPack } from '../server/population/model';

type Source = Omit<RegionPack['sources'][number], 'landingUrl'> & { source_type?: string; landingUrl: string | null };
type RecentObservation = { id: string; metric: string; value: number; unit: string; period: string; populationBasis: string; sourceId: string; locator: string; precisionNotes: string };
interface PopulationData {
  status: 'ready' | 'blocked';
  model: CompiledPopulation;
  sourceFiles: { sourceId: string; passed: boolean; detail: string }[];
  recent: { sources: Source[]; observations: RecentObservation[]; gaps: { id: string; detail: string }[]; conflicts: { id: string; detail: string; resolution: string }[] } | null;
}
const fmt = (n: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1 }).format(n);
const steps = ['锁定区域、时点与人口口径', '寻找官方原表与统计脚注', '存原件、哈希与表格定位', '录入边际并校验行列汇总', '显式推断缺失的联合分布', '检查任务适用性与补采缺口', '版本冻结、复现和持续更新'];

export function PopulationExplorer() {
  const [data, setData] = useState<PopulationData | null>(null);
  const [error, setError] = useState('');
  const [cellId, setCellId] = useState('');
  const [validation, setValidation] = useState<unknown>(null);
  const [validating, setValidating] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/population', { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('人口证据加载失败');
      const next = await r.json() as PopulationData;
      setData(next); setCellId(next.model.cells[0]?.id || '');
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, []);
  async function validate(file?: File) {
    if (!file) return;
    setValidation(null); setError('');
    if (file.size > 900_000) { setError('数据包不能超过 900 KB；原始证据文件通过本地目录管理。'); return; }
    setValidating(true);
    try {
      const body = JSON.parse(await file.text());
      const response = await fetch('/api/population/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      setValidation(result);
      if (!response.ok && result.error) setError(result.error);
    } catch (e) { setError((e as Error).message); }
    finally { setValidating(false); }
  }
  if (!data) return <div role="status" className="loading-state">{error || '正在核验人口证据…'}</div>;
  if (data.status !== 'ready' || data.sourceFiles.some(source => !source.passed)) return <section className="panel population-section"><div role="alert" className="research-warning"><b>证据完整性检查未通过</b><p>已阻止人口数字与模型展示。请恢复登记原件或重新核验并发布数据版本，不要直接跳过检查。</p></div><ul className="population-checks">{data.sourceFiles.filter(source => !source.passed).map(source => <li key={source.sourceId}>{source.sourceId}：{source.detail}</li>)}</ul></section>;
  const { model, recent } = data;
  const cell = model.cells.find(c => c.id === cellId) || model.cells[0];
  const evidence = cell.evidenceIds.map(id => model.observations.find(o => o.id === id)!);
  const sources: Source[] = [...model.sources, ...(recent?.sources || [])];
  const annuals = (recent?.observations || []).filter(o => o.metric === 'population.total' && o.populationBasis === 'usual-resident');
  const latest = [...annuals].sort((a, b) => b.period.localeCompare(a.period))[0];
  const latestSource = sources.find(s => s.id === latest?.sourceId);
  const checksPassed = model.audit.checks.filter(c => c.passed).length;
  const populationLabel = (id: string) => model.areas.find(a => a.code === id)?.name || model.region.name;
  return <div className="population-workbench">
    <div className="population-toolbar"><span className="status-pill completed">结构审计 {checksPassed}/{model.audit.checks.length}</span><span className="muted">审计通过 ≠ 人口或市场预测无误差</span><a className="secondary compact" href="/api/population/pack" download>下载数据包</a><a className="secondary compact" href="/api/population/model" download>下载逻辑人口模型</a></div>
    <div className="city-overview">
      <section className="panel city-intro"><span className="eyebrow">CENSUS / STRUCTURAL BASELINE</span><h2>杭州 · 滨江</h2><p>可追溯的历史结构，<br />不是实时人口地图。</p><div className="city-number">{fmt(model.population)}<span>人 / 七普常住人口</span></div><small>{model.period} · 全年龄 · 三街道</small></section>
      <section className="panel street-panel"><div className="panel-heading"><h2>三街道人口分布</h2><span className="provenance fact">2020 公开事实</span></div>{model.areas.map((area, i) => <div className="street" key={area.code}><div><b>{area.name}</b><span>{fmt(area.population)} 人</span></div><div className="bar-track"><div style={{ width: `${100 * area.population / model.population}%`, background: ['#0f8f83', '#3e77bf', '#775dba'][i] }} /></div><small>{(100 * area.population / model.population).toFixed(1)}%</small></div>)}</section>
    </div>
    <section className="panel population-section latest-panel"><div><span className="eyebrow">LATEST DISTRICT ESTIMATE</span><h2>更新总量，不偷换结构</h2><p>年末常住人口与七普时点分开记录。未将 2020 街道比例外推到 2025 年。</p></div><div className="annual-series">{annuals.slice().sort((a, b) => a.period.localeCompare(b.period)).map(o => <div key={o.id}><small>{o.period.slice(0, 4)} 年末</small><strong>{o.value}<span>{o.unit}</span></strong></div>)}</div>{latest && <p className="evidence-note">{latest.precisionNotes} <a href={latestSource?.landingUrl || latestSource?.url} target="_blank" rel="noreferrer">查看 {latest.period.slice(0, 4)} 官方公报 ↗</a></p>}</section>
    <div className="provenance-grid">{[['fact', '原表事实 / 确定性派生', '原表数与减法派生分开注明；每条有表、页、行、列。'], ['infer', '联合人口 / 有条件推断', '年龄与性别独立是建模假设，不是人口普查个体记录。'], ['generated', '模拟行为 / 尚未校准', '兴趣、预算、养宠和品类偏好不能由人口总量推出。']].map(([kind, title, text]) => <div className="panel provenance-card" key={kind}><span className={`provenance ${kind}`}>{title}</span><p>{text}</p></div>)}</div>
    <section className="panel population-section"><div className="panel-heading"><h2>人口结构原表</h2><span className="small-muted">街道 × 年龄 / 单位：人</span></div><div className="population-table-wrap"><table><caption className="sr-only">2020年三街道互斥年龄组人口</caption><thead><tr><th>街道</th>{model.ageBands.map(a => <th key={a.id}>{a.label}</th>)}<th>合计</th></tr></thead><tbody>{model.areas.map(a => <tr key={a.code}><th>{a.name}</th>{a.ageGroups.map(g => <td key={g.id}>{fmt(g.population)}</td>)}<td>{fmt(a.population)}</td></tr>)}</tbody></table></div><p className="evidence-note">5–14 岁不等于在校小学生；15–59 岁包含未成年人。没有社区、学校或楼栋人口数据，不制造精细地图。</p></section>
    <section className="panel population-section trace-panel"><div className="panel-heading"><h2>从一个模型数字，回到原始证据</h2><span className="provenance infer">可追溯，不等于已识别</span></div><label className="trace-select">选择联合人口单元<select value={cellId} onChange={e => setCellId(e.target.value)}>{model.cells.map(c => <option key={c.id} value={c.id}>{populationLabel(c.areaCode)} / {model.ageBands.find(a => a.id === c.ageBand)?.label} / {model.sexCategories.find(s => s.id === c.sex)?.label}</option>)}</select></label><div className="trace-calculation"><div><small>逻辑人口 / {cell.provenance}</small><strong>{fmt(cell.population)} <span>人</span></strong></div><p>{cell.method}<br /><span>固定边际可行界：{fmt(cell.feasibleRange.min)} – {fmt(cell.feasibleRange.max)} 人。不是置信区间，不能将各单元边界同时任意组合。</span></p></div><div className="trace-dependencies">{evidence.map(o => <div className="trace-evidence" key={o.id}><span className="provenance fact">{o.derivation ? '算术派生' : '原表事实'}</span><strong>{fmt(o.value)} 人</strong><p>{o.locator.row} / {o.locator.column}</p><small>{o.locator.table} · 印刷 {o.locator.page} 页 / PDF 第 {o.locator.pdfPage} 页</small><code>{o.id}</code>{o.derivation && <p>减法输入：{o.derivation.inputObservationIds.map(id => `${id} (${fmt(model.observations.find(row => row.id === id)!.value)})`).join(' − ')}</p>}<a href={`/api/population/sources/${encodeURIComponent(o.sourceId)}`} download>下载原始证据 ↗</a></div>)}</div><details><summary>查看结构校验明细与模型版本</summary><ul className="population-checks">{model.audit.checks.map(c => <li key={c.id}><b>{c.passed ? '✓' : '×'} {c.name}</b><p>{c.detail}</p></li>)}</ul><p className="evidence-note">数据包 {model.packId} / {model.version}</p><code className="hash-line">SHA-256 {model.datasetHash}</code></details></section>
    <section className="panel population-section"><div className="panel-heading"><h2>证据档案</h2><span className="small-muted">原件 · 发布页 · 下载指纹</span></div><p className="evidence-note">哈希用于检验文件有没有变化，不认证发布者身份，也不证明统计调查没有误差。相同原件的多张表与官方转载不是独立调查。</p>{sources.map(s => <details className="source-record" key={s.id}><summary>{s.title}<span>{s.source_type === 'official-reprint' ? '官方转载' : '官方原件 / 表索引'}</span></summary><p>{s.publisher} · 发布：{s.publishedAt || '未核实'} · 采集：{s.retrievedAt}</p><p>{data.sourceFiles.find(c => c.sourceId === s.id)?.detail || '来源元数据已存档；下载时重新校验原件指纹。'}</p><code className="hash-line">{s.sha256}</code><div className="source-links"><a href={s.landingUrl || s.url} target="_blank" rel="noreferrer">{s.landingUrl ? '发布页' : '官方附件（发布页未核实）'} ↗</a><a href={`/api/population/sources/${encodeURIComponent(s.id)}`} download>本地原件 ↧</a><a href={s.url} target="_blank" rel="noreferrer">原始链接 ↗</a></div></details>)}</section>
    <section className="panel population-section"><h2>换一个区域，沿用同一条证据链</h2><ol className="method-steps">{steps.map((step, i) => <li key={step}><span>{String(i + 1).padStart(2, '0')}</span>{step}</li>)}</ol><div className="intake-row"><a className="secondary" href="/api/population/template" download>下载新区域录入模板</a><label className="secondary intake-upload">{validating ? '校验中…' : '选择 JSON 预检'}<input aria-label="上传人口数据包预检" type="file" accept=".json,application/json" disabled={validating} onChange={e => void validate(e.target.files?.[0])} /></label></div><p className="evidence-note">只校验，不替换当前城市。模板缺少事实时应被阻止；原件先放入本地 data/population/sources，再填写哈希和表格定位。当前编译器支持单一时点的子区域全龄年龄、性别边际或完整联合表。</p><code className="cli-line">npm run population -- validate data/population/regions/binjiang-2020.json</code>{error && <p role="alert" className="research-warning">{error}</p>}{validation !== null && <pre className="validation-output" aria-label="数据包预检结果">{JSON.stringify(validation, null, 2)}</pre>}</section>
    <section className="panel population-section"><h2>已知缺口与不可混用项</h2><ul className="population-checks">{(recent?.conflicts || []).map(c => <li key={c.id}><p>{c.detail}</p><b>{c.resolution}</b></li>)}{model.audit.limitations.map((note, i) => <li key={`lim-${i}`}>{note}</li>)}</ul></section>
  </div>;
}
