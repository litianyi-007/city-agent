import { useEffect, useState } from 'react';
import type { Run } from '../server/types';
import type { ResearchCaseReport } from '../server/research-cases';

export function ResearchCaseView({ run }: { run: Run }) {
  const [report, setReport] = useState<ResearchCaseReport | null>(null);
  const [error, setError] = useState('');
  const artifact = run.artifacts.find(a => a.name === 'case-report.json');
  useEffect(() => {
    setReport(null); setError('');
    if (!artifact) return;
    const controller = new AbortController();
    fetch(`/api/runs/${run.id}/artifacts/case-report.json`, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('研究适用性报告加载失败');
      setReport(await r.json());
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [run.id, artifact?.name]);
  if (!report) return <div className="research-warning" role="status">{error || '正在检查研究人群与数据适用性。通用 15+ 规则样本不能作为学生或养宠家庭的调查结果。'}</div>;
  return <div className="case-readiness">
    <div className="research-warning"><b>交付完成 ≠ 商业决策证据充足</b><p>{report.title} · {report.decisionStatus === 'needs-data' ? '需要补充数据' : '仅限模拟'}</p></div>
    <h3>调研框适用性</h3><p>{report.frameFit.reason}</p>
    <div className="population-table-wrap"><table><caption>当前可用事实及使用边界</caption><thead><tr><th>事实</th><th>不可据此推断</th></tr></thead><tbody>{report.facts.map(f => <tr key={f.id}><td>{f.claim}{f.value !== undefined && <>：{new Intl.NumberFormat('zh-CN').format(f.value)}{f.unit}</>}<small>{f.period} · {f.sourceIds.join(' / ')}</small></td><td>{f.useLimit}</td></tr>)}</tbody></table></div>
    <h3>最小补采清单</h3><div className="case-gap-grid">{report.dataGaps.map(g => <article key={g.id}><h4>{g.title}</h4><p>{g.requiredFor}</p><small>建议来源：{g.suggestedSources.join('；')}</small><p className="muted">字段：{g.expectedFields.join('、')}</p></article>)}</div>
    <h3>可检验假设，不是选址或采购建议</h3>{report.hypotheses.map(h => <details key={h.id}><summary>{h.title}</summary><p>{h.locationApproach}</p><p>{h.assortment}</p><p>{h.pricingApproach}</p><p>推翻条件：{h.falsifiedBy}</p></details>)}
    <h3>下一步怎么做</h3><ol>{report.conditionalNextSteps.map(s => <li key={s}>{s}</li>)}</ol><p className="evidence-note">到「交付产物」打开交互页面，比较假设并整理补采计划。勾选补采项不代表数据已取得。</p>
  </div>;
}
