import { useState } from 'react';
import { createBusinessEvidenceTemplate, validateBusinessEvidence, type BusinessEvidenceAudit } from '../shared/business-evidence';
import { downloadJson } from './research-client';

const labels: Record<string, string> = {
  'ready-for-review': '结构就绪 · 仍需人工来源审核', 'needs-data': '业务证据仍有缺口',
  conflict: '证据口径或版本冲突', invalid: '文件契约无效',
};
const format = (value: unknown) => JSON.stringify(value, null, 2);

/** Pure, shared preflight: no model request, filesystem access or publication. */
export function BusinessEvidencePanel() {
  const [packText, setPackText] = useState(() => format(createBusinessEvidenceTemplate()));
  const [requirementsText, setRequirementsText] = useState('');
  const [audit, setAudit] = useState<BusinessEvidenceAudit | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function clearResult() { setAudit(null); setError(''); }
  function check() {
    clearResult();
    try {
      setAudit(validateBusinessEvidence(JSON.parse(packText), requirementsText.trim() ? JSON.parse(requirementsText) : undefined));
    } catch (cause) { setError(cause instanceof SyntaxError ? '文件不是有效 JSON，请修正后重新检查。' : (cause as Error).message); }
  }
  return <section className="panel research-panel" aria-label="业务证据包预检">
    <div className="panel-heading"><h2>业务证据包 · 先检查，再使用</h2><span className="small-muted">EVIDENCE INTAKE</span></div>
    <p className="research-note">人口背景不能替代学校、候选地址、订单、商品规格或成交价。这里仅检查已录入的来源和观测契约，不访问文件中的网址，不调用模型，不自动激活人口包或给出选址建议。</p>
    <div className="research-toolbar">
      <label className="secondary intake-upload">导入业务证据 JSON<input type="file" accept=".json,application/json" aria-label="导入业务证据 JSON" disabled={busy} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
        setBusy(true); clearResult();
        try {
          if (file.size > 1024 * 1024) throw new Error('业务证据文件不能超过1MB。');
          const text = await file.text(); JSON.parse(text); setPackText(text);
        } catch (cause) { setError(cause instanceof SyntaxError ? '文件不是有效 JSON。' : (cause as Error).message); }
        finally { setBusy(false); }
      }} /></label>
      <button type="button" className="secondary" disabled={busy} onClick={() => downloadJson(createBusinessEvidenceTemplate(), 'business-evidence-template.json')}>下载空证据模板</button>
    </div>
    <label>来源与观测包 JSON<textarea className="json-input" rows={10} value={packText} disabled={busy} onChange={event => { setPackText(event.target.value); clearResult(); }} /></label>
    <label>本次研究的数据要求 JSON（可选）<textarea className="json-input" rows={5} value={requirementsText} disabled={busy} placeholder="留空仅检查证据包，不判断是否足以支持具体研究。" onChange={event => { setRequirementsText(event.target.value); clearResult(); }} /></label>
    <p className="research-note">研究要求须显式指定地域、边界版本、时期，以及每项指标的单位、覆盖总体、空间粒度和分母要求。缺失保持 null，不能填成零。自填 verified 或哈希不构成权威来源认证；仅上传合法、去标识的资料。</p>
    {error && <p className="alert error" role="alert">{error}</p>}
    <button type="button" className="primary" disabled={busy} onClick={check}>检查业务证据包 · 不调用模型</button>
    {audit && <div className="check-results" aria-live="polite">
      <h3>{labels[audit.status]}</h3>
      <p className="research-note warning">来源仍需人工核验；本次结果不是现实桥绑定、人口发布或商业推荐。</p>
      <pre className="evidence-audit-json">{format(audit)}</pre>
      <button type="button" className="secondary" onClick={() => downloadJson(audit, 'business-evidence-preflight.json')}>导出证据预检报告</button>
    </div>}
  </section>;
}
