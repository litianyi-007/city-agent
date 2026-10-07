import { useEffect, useRef, useState } from 'react';
import { getBusinessDemos, createBusinessDemoRun } from '../shared/research-demo';
import type { ResearchTask } from '../shared/research-schema';
import type { SurveyRun } from '../shared/survey-engine';
import type { ResidentAgentPublic } from '../server/research/residents';
import { pagesPack, pagesPopulation } from './pages-api';
import { downloadJson } from './research-client';
import { parseSurveyEvidence, saveSurveyRun } from './run-history';
import { readBusinessProofHistory, saveBusinessProofSnapshot, type BusinessProofSnapshot } from './business-proof-history';
import { SurveyResults } from './SurveyResults';

const demos = getBusinessDemos();

export function BusinessDemoPanel({ busy, onBusyChange, onApplyDemo }: {
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onApplyDemo: (task: ResearchTask, presets: ResidentAgentPublic[]) => Promise<boolean>;
}) {
  const [demoId, setDemoId] = useState(demos[0].id);
  const [run, setRun] = useState<SurveyRun | null>(null);
  const [logicAudit, setLogicAudit] = useState<unknown>(null);
  const [history, setHistory] = useState<BusinessProofSnapshot[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const selected = demos.find(demo => demo.id === demoId)!;

  useEffect(() => {
    let active = true;
    void readBusinessProofHistory().then(({ proofs, rejected }) => {
      if (active) { setHistory(proofs); if (rejected) setNotice(`隔离${rejected}条旧版或不一致记录；原件仍保留于本机业务证据库，未删除、修补或当作通过。有效历史可正常恢复。`); }
    }).catch(() => { if (active) setNotice('历史暂不可用；运行后请导出备份。'); });
    return () => { active = false; controller.current?.abort(); };
  }, []);

  async function demonstrate() {
    if (controller.current || busy) return;
    const abort = new AbortController(); controller.current = abort;
    setError(''); setNotice(''); setLogicAudit(null); onBusyChange(true);
    try {
      const result = await createBusinessDemoRun({ demoId, population: pagesPopulation, pack: pagesPack, seed: 20261007, signal: abort.signal });
      const verified = parseSurveyEvidence(result.run);
      setRun(verified); setLogicAudit(result.logicAudit);
      const snapshot: BusinessProofSnapshot = { schemaVersion: '1.0', kind: 'business-demo-proof', execution: 'fixture-only', realModelCalls: 0, run: verified, logicAudit: result.logicAudit };
      await saveBusinessProofSnapshot(snapshot);
      setHistory(previous => [snapshot, ...previous.filter(item => item.run.id !== verified.id)]);
      await saveSurveyRun(verified);
      setNotice('完整问卷、四份情景预设、12个画像与原始答卷已冻结，保存于本机浏览器证据库。未读取 Key、未调用模型，也未写入后端 SQLite。');
    } catch (cause) { setError((cause as Error).message); }
    finally { controller.current = null; onBusyChange(false); }
  }

  return <section className="panel research-panel business-demo-panel" aria-label="完整业务工程自证">
    <div className="panel-heading"><h2>完整业务示例 · 一键零费用自证</h2><span className="small-muted">FIXTURE · NO MODEL</span></div>
    <p className="research-note">此处运行冻结示例，不使用当前草稿、已配置模型或 Key。规则只检查工程与已登记跨题约束；不是真人偏好，不证明五层人格有效，也不输出可信铺位、主营比例或盈利预测。</p>
    <label>完整业务问卷<select value={demoId} disabled={busy} onChange={event => { const next = demos.find(demo => demo.id === event.target.value); if (next) setDemoId(next.id); setError(''); setNotice(''); }}>{demos.map(demo => <option key={demo.id} value={demo.id}>{demo.task.title}</option>)}</select></label>
    <p className="research-note">{selected.task.questionnaire.questions.length}题 · 四份五层情景预设 · 12个不同合成实例 · seed 20261007。目标资格为假设，无真实总体权重。</p>
    <p className="research-note warning">“应用问卷与五层预设”只复制草稿输入，不附带本面板专用夹具策略或另册跨题审计。下方普通“运行问卷演示”使用通用规则答案，不能沿用本面板的完整业务自证结论。</p>
    <details><summary>问卷、五层预设与显式逻辑规则</summary><pre className="evidence-audit-json">{JSON.stringify({ task: selected.task, presets: selected.presets, logicRules: selected.logicRules, limitations: selected.limitations }, null, 2)}</pre></details>
    <div className="research-save-bar">
      <button type="button" className="primary" disabled={busy} onClick={() => void demonstrate()}>运行完整业务自证 · 0 API费用</button>
      <button type="button" className="secondary" disabled={busy} onClick={async () => {
        setError(''); setNotice('');
        try {
          if (await onApplyDemo(selected.task, selected.presets)) setNotice('已将完整问卷与四份无 Key 预设应用到草稿；尚未保存或启动调查。编辑后的问卷需重新检查，不能沿用冻结示例的自证结论。');
        } catch (cause) { setError((cause as Error).message); }
      }}>应用问卷与五层预设 · 不启动调查</button>
      <button type="button" className="secondary" disabled={busy} onClick={() => downloadJson({ schemaVersion: '1.0', kind: 'business-demo-inputs', execution: 'fixture-only', ...selected }, `${demoId}-questionnaire-and-presets.json`)}>导出完整示例输入</button>
    </div>
    {error && <p className="alert error" role="alert">{error} 若已有结果显示，请立即导出备份。</p>}
    {notice && <p className="research-note" role="status">{notice}</p>}
    <label>业务自证历史<select disabled={busy} value={run?.id ?? ''} onChange={event => { const snapshot = history.find(item => item.run.id === event.target.value); setRun(snapshot?.run ?? null); setLogicAudit(snapshot?.logicAudit ?? null); setNotice('历史使用当时冻结的原文与跨题规则复核，未套用当前示例规则；刷新后仍可导出完整自证。'); }}><option value="">选择本机浏览器运行</option>{history.map(({ run: item }) => <option key={item.id} value={item.id}>{item.startedAt} · {item.task.title} · {item.metrics.valid}/{item.metrics.planned}</option>)}</select></label>
    {run && <>
      <p className="research-note warning">以下是独立冻结的业务示例结果，不会随当前草稿或示例选择改变。规则合法不等于市场或人格效度通过。</p>
      <SurveyResults run={run} />
      {logicAudit !== null && <details open><summary>显式跨题与互斥约束检查 · 非全面语义认证</summary><pre className="evidence-audit-json">{JSON.stringify(logicAudit, null, 2)}</pre></details>}
      <button type="button" className="secondary" disabled={busy || logicAudit === null} onClick={() => downloadJson({ schemaVersion: '1.0', kind: 'business-demo-proof', execution: 'fixture-only', realModelCalls: 0, run, logicAudit }, `business-proof-${run.id}.json`)}>导出运行与跨题自证</button>
    </>}
  </section>;
}
