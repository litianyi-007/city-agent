import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { researchTaskSchema, type ResearchTask } from '../shared/research-schema';
import { residentInput, type ResidentAgentInput, type ResidentAgentPublic, type ResearchProject, type ResearchProjectInput } from '../server/research/residents';
import { QuestionEditor, newQuestion, questionTypes, type Question } from './QuestionEditor';
import { researchApi, downloadJson, type ProjectCheck } from './research-client';
import { createBlankResearchTask, readResearchDraft } from './research-draft';
import './research.css';
import './research-next.css';

const objectives: Record<ResearchTask['objective'], string> = {
  'demand-validation': '需求验证', 'feature-priority': '功能优先级', 'price-benefits': '价格与权益',
  'concept-copy': '概念与文案', 'purchase-concerns': '购买顾虑', 'questionnaire-quality': '问卷质量',
};
const outputs: Record<ResearchTask['requestedOutputs'][number], string> = {
  'questionnaire-review': '问卷检查', 'synthetic-analysis': '合成回答分析', 'group-comparison': '人群比较',
  'price-comparison': '价格比较', 'hypothesis-report': '假设报告', 'site-recommendation': '真实选址（暂不支持）',
  'market-forecast': '市场预测（暂不支持）', deploy: '部署（暂不支持）', 'backend-service': '后端服务（暂不支持）',
};
const checkLabels: Record<string, string> = { ready: '配置与人口框检查通过', 'needs-data': '人群资格或证据待补充', unsupported: '请求的输出超出当前范围' };
const json = (value: unknown) => JSON.stringify(value, null, 2);
const pagesMode = import.meta.env.MODE === 'pages';
const publicReviewBase = 'https://litianyi-007.github.io/city-agent/submission-next/';
const publicTrialBase = 'https://litianyi-007.github.io/city-agent/submission-contract11/';
const PagesSurveyPanel = lazy(() => import('./PagesSurveyPanel').then(module => ({ default: module.PagesSurveyPanel })));
const ResidentAgentEditor = lazy(() => import('./ResidentAgentEditor').then(module => ({ default: module.ResidentAgentEditor })));
const BusinessEvidencePanel = lazy(() => import('./BusinessEvidencePanel').then(module => ({ default: module.BusinessEvidencePanel })));
const ResearchPlanningPanel = lazy(() => import('./ResearchPlanningPanel').then(module => ({ default: module.ResearchPlanningPanel })));
const BusinessDemoPanel = lazy(() => import('./BusinessDemoPanel').then(module => ({ default: module.BusinessDemoPanel })));

export function ResearchWorkspace({ section, onSectionChange, onDirtyChange, onBusyChange }: {
  section: 'projects' | 'residents'; onSectionChange: (section: 'projects' | 'residents') => void; onDirtyChange: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [templates, setTemplates] = useState<ResearchTask[]>([]);
  const [residentTemplates, setResidentTemplates] = useState<ResidentAgentInput[]>([]);
  const [residents, setResidents] = useState<ResidentAgentPublic[]>([]);
  const [projects, setProjects] = useState<ResearchProject[]>([]);
  const [task, setTask] = useState<ResearchTask | null>(null);
  const [projectId, setProjectId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [filters, setFilters] = useState('[]');
  const [declarations, setDeclarations] = useState('[]');
  const [dirty, setDirty] = useState(false);
  const [residentDirty, setResidentDirty] = useState(false);
  const [check, setCheck] = useState<ProjectCheck | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<ResidentAgentPublic | 'new' | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showPlanning, setShowPlanning] = useState(false);
  const [showBusinessDemos, setShowBusinessDemos] = useState(false);
  const revision = useRef(0);

  useEffect(() => {
    let stopped = false; setLoading(true); setError('');
    Promise.all([
      researchApi<{ templates: ResearchTask[] }>('/templates'), researchApi<ResidentAgentInput[]>('/resident-templates'),
      researchApi<ResidentAgentPublic[]>('/resident-agents'), researchApi<ResearchProject[]>('/projects'),
    ]).then(([catalog, residentCatalog, agents, saved]) => {
      if (stopped) return;
      setTemplates(catalog.templates); setResidentTemplates(residentCatalog); setResidents(agents); setProjects(saved);
      const previous = saved[0]; const initial = previous?.task ?? catalog.templates[0];
      setTask(initial); setProjectId(previous?.id ?? ''); setSelectedIds(previous?.residentAgentIds ?? []);
      setFilters(json(initial.population.filters)); setDeclarations(json(initial.declarations));
    }).catch(error => !stopped && setError(error.message)).finally(() => !stopped && setLoading(false));
    return () => { stopped = true; };
  }, [reload]);
  useEffect(() => { onDirtyChange(dirty || residentDirty); }, [dirty, residentDirty, onDirtyChange]);
  useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!dirty && !residentDirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, residentDirty, busy]);

  function invalidate(markDirty = true) {
    revision.current++; setCheck(null); setStale(true); setNotice('');
    if (markDirty) setDirty(true);
  }
  function change(next: ResearchTask) { invalidate(); setTask(next); }
  function readDraft(): ResearchProjectInput {
    return readResearchDraft(task, filters, declarations, selectedIds);
  }
  function replace(next: ResearchTask, id = '', ids: string[] = []) {
    if (dirty && !window.confirm('当前问卷有未保存修改，是否放弃并切换？')) return;
    revision.current++; setTask(structuredClone(next)); setProjectId(id); setSelectedIds(ids);
    setFilters(json(next.population.filters)); setDeclarations(json(next.declarations));
    setCheck(null); setStale(false); setDirty(!id); setError(''); setNotice('');
  }
  async function validate() {
    setError(''); setBusy(true); setCheck(null);
    const version = revision.current;
    try {
      const result = await researchApi<ProjectCheck>('/projects/validate', 'POST', readDraft());
      if (version === revision.current) { setCheck(result); setStale(false); }
    } catch (error) { if (version === revision.current) setError((error as Error).message); }
    finally { setBusy(false); }
  }
  async function save() {
    setError(''); setNotice(''); setBusy(true);
    try {
      const project = await researchApi<ResearchProject>(projectId ? `/projects/${projectId}` : '/projects', projectId ? 'PUT' : 'POST', readDraft());
      setProjectId(project.id); setDirty(false);
      setProjects(previous => [project, ...previous.filter(item => item.id !== project.id)]);
      setNotice('调查草稿已保存到本机；尚未开始居民作答。');
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <div className="research-workspace">
    <nav className="research-tabs" aria-label="调查页面导航"><button type="button" className={section === 'projects' ? 'active' : ''} aria-current={section === 'projects' ? 'page' : undefined} onClick={() => onSectionChange('projects')}>调查项目</button><button type="button" className={section === 'residents' ? 'active' : ''} aria-current={section === 'residents' ? 'page' : undefined} onClick={() => onSectionChange('residents')}>人群 Agent 预设 <span>{residents.length}</span></button><span className="research-phase">{pagesMode ? '问卷仿真 · 浏览器执行' : '问卷仿真 · Harness执行'}</span></nav>
    {error && <div className="alert error" role="alert"><span>{error}</span><button type="button" aria-label="关闭调查错误" onClick={() => setError('')}>×</button></div>}
    {notice && <div className="alert success" role="status">{notice}</div>}
    {loading ? <p className="research-note">正在加载问卷与人群预设…</p> : !task ? <div className="panel research-panel"><p>调查配置暂不可用，已有资料不会被覆盖。</p><button className="secondary" onClick={() => setReload(value => value + 1)}>重新加载</button></div> : <>
      <div className="research-stage-note"><strong>{pagesMode ? '公开体验 · 问卷与仿真' : '本机问卷与自主交付'}</strong><span>{pagesMode ? '草稿保存在本机浏览器；Key仅存本次会话。下方可运行演示或连接真实模型。' : '可通过Harness独立作答、保存分析，再交给四角色生成并验收离线页面；不使用旧版价格公式替代答卷。'}</span></div>
      <div hidden={section !== 'projects'}>
        <div className="research-toolbar research-next-tools">
          <button type="button" className="secondary" disabled={busy} aria-expanded={showBusinessDemos} onClick={() => setShowBusinessDemos(value => !value)}>完整业务示例 · 零费用体验</button>
          <button type="button" className="secondary" disabled={busy} aria-expanded={showPlanning} onClick={() => setShowPlanning(value => !value)}>从自然语言规划调查</button>
          <button type="button" className="secondary" disabled={busy} aria-expanded={showEvidence} onClick={() => setShowEvidence(value => !value)}>检查业务证据包</button>
          <a className="text-button" href={`${import.meta.env.BASE_URL}review-guide.html`} target="_blank" rel="noreferrer">评委本机复现说明 ↗</a>
          <a className="text-button" href={`${publicTrialBase}index.html`} target="_blank" rel="noreferrer">最新真实测试补充 ↗</a>
          <a className="text-button" href={`${publicTrialBase}report.md`} target="_blank" rel="noreferrer">本轮真实 API 调查报告 ↗</a>
          <a className="text-button" href={`${publicTrialBase}report.json`} target="_blank" rel="noreferrer">本轮真实 API 证据 JSON ↗</a>
          <a className="text-button" href={`${publicReviewBase}index.html`} target="_blank" rel="noreferrer">RC1完整申报材料 · 历史保留 ↗</a>
          {!pagesMode && <a className="text-button" href={`${import.meta.env.BASE_URL}submission-next/index.html`} target="_blank" rel="noreferrer">本机公开审查材料副本 ↗</a>}
        </div>
        <p className="research-note">本轮契约1.1真实调查：小学联合0/10、宠物3/10，15未启动；5请求，保守估算¥0.042032。两个十人门限仍失败，规划/CORS未启动，账本closed，不自动重试或扩容。合成居民不是真人，不能推断实际开店结论；下方完整业务示例仍是0模型调用夹具。原文、RC1失败与本轮分别留档。</p>
        {section === 'projects' && showBusinessDemos && <Suspense fallback={<p>加载完整业务问卷与五层情景…</p>}><BusinessDemoPanel busy={busy} onBusyChange={setBusy} onApplyDemo={async (next, presets) => {
          if (dirty && !window.confirm('当前问卷有未保存修改。是否放弃修改，应用完整业务问卷并新增四份无 Key 情景预设？不会删除既有预设。')) return false;
          setBusy(true); setError('');
          const created: ResidentAgentPublic[] = [];
          try {
            for (const preset of presets) created.push(await researchApi<ResidentAgentPublic>('/resident-agents', 'POST', { ...residentInput(preset), apiKey: null }));
            setResidents(previous => [...previous, ...created]);
            revision.current++; setTask(structuredClone(next)); setProjectId(''); setSelectedIds(created.map(preset => preset.id));
            setFilters(json(next.population.filters)); setDeclarations(json(next.declarations)); setCheck(null); setStale(false); setDirty(true);
            return true;
          } catch (cause) {
            if (created.length) setResidents(previous => [...previous, ...created]);
            throw new Error(`${(cause as Error).message}${created.length ? ` 已新增${created.length}份无 Key 预设，其余未应用；请在预设页检查。未覆盖原问卷。` : ''}`);
          } finally { setBusy(false); }
        }} /></Suspense>}
        {section === 'projects' && showPlanning && <Suspense fallback={<p>加载候选研究规划…</p>}><ResearchPlanningPanel population={task.population} draftVersion={revision.current} disabled={busy} onBusyChange={setBusy} onApply={next => replace(next)} /></Suspense>}
        {section === 'projects' && showEvidence && <Suspense fallback={<p>加载业务证据预检…</p>}><BusinessEvidencePanel /></Suspense>}
        <div className="research-toolbar"><label>已保存的调查<select disabled={busy} value={projectId} onChange={event => {
          const project = projects.find(item => item.id === event.target.value);
          if (project) replace(project.task, project.id, project.residentAgentIds);
          else replace(templates[0]);
        }}><option value="">未保存的新调查</option>{projects.map(project => <option key={project.id} value={project.id}>{project.task.title}</option>)}</select></label><span className="research-save-state">{dirty ? '有未保存修改' : projectId ? '已保存 · 草稿' : '模板预览'}</span><button className="secondary" disabled={busy} onClick={() => replace(createBlankResearchTask(task.population, crypto.randomUUID()))}>＋ 新建调查</button></div>
        <div className="research-template-row"><span>从问卷开始</span>{templates.map(template => <button type="button" className="secondary" disabled={busy} key={template.id} onClick={() => replace(template)}>{template.title.replace('问卷预检', '')}</button>)}<label className="secondary intake-upload">导入问卷 JSON<input disabled={busy} type="file" accept=".json,application/json" aria-label="导入问卷 JSON" onChange={async event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
          const version = revision.current;
          setBusy(true); setError('');
          try {
            if (file.size > 1024 * 1024) throw new Error('问卷文件不能超过1MB。');
            const imported = researchTaskSchema.safeParse(JSON.parse(await file.text()));
            if (!imported.success) throw new Error(`问卷格式无效：${imported.error.issues.map(issue => issue.path.join('.')).join('、')}`);
            if (version === revision.current) replace(imported.data);
          } catch (error) { setError(error instanceof SyntaxError ? '文件不是有效 JSON。' : (error as Error).message); }
          finally { setBusy(false); }
        }} /></label></div>
        <div className="research-compose">
          <form className="research-main" onSubmit={event => { event.preventDefault(); void save(); }}>
            <fieldset disabled={busy}>
              <section className="panel research-panel"><div className="panel-heading"><h2>01 · 研究设定</h2><span className="small-muted">BRIEF</span></div>
                <div className="form-two"><label>调查标题<input required maxLength={200} value={task.title} onChange={event => change({ ...task, title: event.target.value })} /></label><label>研究目标<select value={task.objective} onChange={event => change({ ...task, objective: event.target.value as ResearchTask['objective'] })}>{Object.entries(objectives).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
                <label>商品或服务设定<textarea rows={3} required maxLength={1000} value={task.decisionContext.offering} onChange={event => change({ ...task, decisionContext: { ...task.decisionContext, offering: event.target.value } })} /></label>
                <div className="form-two">{(['buyer', 'endUser'] as const).map(key => <label key={key}>{key === 'buyer' ? '购买者／决策者' : '使用者'}<textarea rows={3} required maxLength={1000} value={task.decisionContext[key]} onChange={event => change({ ...task, decisionContext: { ...task.decisionContext, [key]: event.target.value } })} /></label>)}</div>
                <label>渠道与使用情景<textarea rows={2} required maxLength={1000} value={task.decisionContext.channel} onChange={event => change({ ...task, decisionContext: { ...task.decisionContext, channel: event.target.value } })} /></label>
              </section>
              <section className="panel research-panel"><div className="panel-heading"><h2>02 · 人口框与输出</h2><a className="text-button" href="#city">查看人口证据 ↗</a></div>
                <div className="form-two"><label>区域 ID<input required maxLength={80} value={task.population.regionCode} onChange={event => change({ ...task, population: { ...task.population, regionCode: event.target.value } })} /></label><label>统计时点<input required maxLength={80} value={task.population.period} onChange={event => change({ ...task, population: { ...task.population, period: event.target.value } })} /></label></div>
                <label>统计单位<select value={task.population.unit} onChange={event => change({ ...task, population: { ...task.population, unit: event.target.value as 'person' | 'household' } })}><option value="person">个人</option><option value="household">家庭（需要独立证据）</option></select></label>
                <label>人口与资格筛选（JSON，AND 交集）<textarea className="json-input" rows={6} value={filters} onChange={event => { invalidate(); setFilters(event.target.value); }} /></label>
                <p className="research-note">支持 street、ageBand、age、sex 的登记条件。caregiver、petOwner 等资格可以声明，但会检查证据缺口。每位已选预设的条件还会与这里的条件取交集。</p>
                <div className="research-output-options" role="group" aria-label="期望输出">{Object.entries(outputs).map(([value, label]) => <label className="checkbox-label" key={value}><input type="checkbox" checked={task.requestedOutputs.includes(value as ResearchTask['requestedOutputs'][number])} onChange={event => change({ ...task, requestedOutputs: event.target.checked ? [...task.requestedOutputs, value as ResearchTask['requestedOutputs'][number]] : task.requestedOutputs.filter(item => item !== value) })} />{label}</label>)}</div>
                <details><summary>证据与假设声明（高级）</summary><label>声明 JSON<textarea className="json-input" rows={7} value={declarations} onChange={event => { invalidate(); setDeclarations(event.target.value); }} /></label><p className="research-note">自填 fact 和来源 ID 不构成事实认证，预检仍会指出核验要求。</p></details>
              </section>
              <section className="panel research-panel"><div className="panel-heading"><h2>03 · 问卷 · {task.questionnaire.questions.length} 题</h2><span className="small-muted">QUESTIONNAIRE</span></div>
                <label>问卷版本<input required maxLength={80} value={task.questionnaire.version} onChange={event => change({ ...task, questionnaire: { ...task.questionnaire, version: event.target.value } })} /></label>
                <p className="research-note">题目与选项 ID 保持稳定；重排后请核对“第几题”引用。画像硬规则与配对分析通过问卷 JSON 登记；不自动理解所有跨题逻辑。</p>
                <details><summary>已登记画像硬规则与配对题</summary><pre>{json({ validationRules: task.validationRules ?? [], comparisons: task.comparisons ?? [] })}</pre><p className="research-note">新增或修改规则请导入问卷JSON；删除题目会同步解除引用，不保留失效规则。</p></details>
                {task.questionnaire.questions.map((question, index) => <QuestionEditor key={question.id} question={question} index={index} count={task.questionnaire.questions.length}
                  onChange={next => change({ ...task, questionnaire: { ...task.questionnaire, questions: task.questionnaire.questions.map(item => item.id === question.id ? next : item) } })}
                  onRemove={() => change({ ...task, questionnaire: { ...task.questionnaire, questions: task.questionnaire.questions.filter(item => item.id !== question.id) }, validationRules: task.validationRules?.filter(rule => rule.questionId !== question.id), comparisons: task.comparisons?.filter(pair => pair.baselineQuestionId !== question.id && pair.changedQuestionId !== question.id) })}
                  onMove={direction => { const questions = [...task.questionnaire.questions]; [questions[index], questions[index + direction]] = [questions[index + direction], questions[index]]; change({ ...task, questionnaire: { ...task.questionnaire, questions } }); }} />)}
                <div className="question-add"><span>添加题目</span>{Object.entries(questionTypes).map(([type, label]) => <button type="button" className="secondary compact" key={type} disabled={task.questionnaire.questions.length >= 50} onClick={() => change({ ...task, questionnaire: { ...task.questionnaire, questions: [...task.questionnaire.questions, newQuestion(type as Question['type'], `question-${crypto.randomUUID().slice(0, 8)}`)] } })}>＋ {label}</button>)}</div>
              </section>
            </fieldset>
            <div className="research-save-bar"><button className="primary" disabled={busy}>{busy ? '处理中…' : '保存调查草稿'}</button><button type="button" className="secondary" disabled={busy} onClick={() => { try { downloadJson(readDraft().task, 'research-questionnaire.json'); } catch (error) { setError((error as Error).message); } }}>导出问卷 JSON</button><span>导出不含人群模型配置或 Key</span></div>
          </form>
          <aside className="research-side">
            <section className="panel research-panel"><div className="panel-heading"><h2>本次人群 Agent</h2><button className="text-button" onClick={() => onSectionChange('residents')}>管理预设 ↗</button></div><p className="research-note">可选择多个预设进行独立资格检查。预设数量不等于样本量，不能据此计算真实人群比例。</p>
              {residents.map(agent => <label className="resident-choice" key={agent.id}><input type="checkbox" disabled={busy || (!agent.enabled && !selectedIds.includes(agent.id))} checked={selectedIds.includes(agent.id)} onChange={event => { invalidate(); setSelectedIds(previous => event.target.checked ? [...previous, agent.id] : previous.filter(id => id !== agent.id)); }} /><span><strong>{agent.name}</strong><small>{agent.modelId} · {agent.hasApiKey ? 'Key 已保存，未验证连通性' : '未配置 Key'}{!agent.enabled && ' · 已停用'}</small></span></label>)}
              {!residents.length && <p className="research-note">暂无人群预设，请前往管理页面创建。</p>}
              {selectedIds.filter(id => !residents.some(agent => agent.id === id)).map(id => <button className="secondary" key={id} onClick={() => { invalidate(); setSelectedIds(previous => previous.filter(value => value !== id)); }}>移除失效预设 {id.slice(0, 8)}</button>)}
            </section>
            <section className="panel research-panel research-check"><h2>配置预检</h2><p className="research-note">仅检查结构、登记人口框与资格缺口；不调用模型，不自动核验题意。</p><button className="primary" disabled={busy} onClick={() => void validate()}>{busy ? '处理中…' : '检查问卷与人群'}</button>
              {!check ? <p className="research-note" role="status">{stale ? '配置已变更，需重新检查。' : '尚未检查当前配置。'}</p> : <div className="check-results" aria-live="polite"><h3>{checkLabels[check.taskCheck.status]}</h3><IssueList items={check.taskCheck.missingEvidence} />
                {check.residents.map(agent => <details key={agent.id} open={agent.status !== 'ready'}><summary>{agent.name} · {checkLabels[agent.status]}</summary><IssueList items={agent.missingEvidence} /></details>)}
                <details><summary>检查范围与限制</summary><IssueList items={check.taskCheck.warnings} /></details><code className="hash-line">任务指纹：{check.taskCheck.taskHash}</code><code className="hash-line">人口指纹：{check.taskCheck.populationHash}</code><IssueList items={check.executionBlockers} /></div>}
              {!pagesMode && <p className="research-note">下方执行区独立启动Harness问卷；本次预检不调用模型，不构成仿真完成。</p>}
            </section>
          </aside>
        </div>
      </div>
      {section === 'projects' && PagesSurveyPanel && <Suspense fallback={<p>加载问卷执行区…</p>}><PagesSurveyPanel readDraft={readDraft} busy={busy} onBusyChange={setBusy} draftVersion={revision.current} /></Suspense>}
      <section hidden={section !== 'residents'} aria-label="人群 Agent 预设管理">
        <div className="research-toolbar"><div><h2>模拟受访者，不是研发角色</h2><p className="research-note">画像、资格与模型独立配置。预设可以重叠，不预设待测商品偏好。</p></div><button className="primary" disabled={busy} onClick={() => setEditing('new')}>＋ 新建人群 Agent</button></div>
        <div className="info-banner">{pagesMode ? 'Key在页面填写，仅保留于本次会话；刷新需重新填写，复制可继承本次会话的Key。模型设置和草稿保存在本机浏览器，不上传GitHub。' : 'API Key 加密保存于本机，复制会继承连接信息和 Key。启用只表示预设可选，不会启动居民或赋予长期记忆。'}</div>
        <div className="agent-grid resident-grid">{residents.map(agent => <article className="panel agent-card" key={agent.id}><div className="agent-card-top"><span className="role-icon resident">人</span><span className={`status-pill ${agent.enabled ? 'completed' : 'pending'}`}>{agent.enabled ? '预设已启用' : '预设已停用'}</span></div><h2>{agent.name}</h2><p className="resident-description">{agent.description}</p><span className="resident-assumption">情景预设 · 资格待核验</span><dl><div><dt>区域 / 时点</dt><dd>{agent.population.regionCode} / {agent.population.period}</dd></div><div><dt>PROVIDER / MODEL</dt><dd>{agent.provider} / {agent.modelId}</dd></div><div><dt>BASE URL</dt><dd title={agent.baseUrl}>{agent.baseUrl}</dd></div><div><dt>API KEY</dt><dd>{agent.hasApiKey ? (pagesMode ? '本次会话已填写 · 连通性未验证' : '已加密保存 · 连通性未验证') : '未配置'}</dd></div></dl><details><summary>查看筛选与假设</summary><pre className="resident-filter-preview">{json(agent.population.filters)}</pre><IssueList items={agent.assumptions} />{agent.behaviorNotes && <p className="research-note">行为假设：{agent.behaviorNotes}</p>}</details><div className="agent-actions"><button className="secondary" disabled={busy} onClick={() => setEditing(agent)}>编辑配置</button><button className="text-button" disabled={busy} aria-label={`复制人群 ${agent.name}`} onClick={async () => { setBusy(true); setError(''); try { const copy = await researchApi<ResidentAgentPublic>(`/resident-agents/${agent.id}/clone`, 'POST', {}); setResidents(previous => [...previous, copy]); invalidate(false); setNotice(`已复制 ${agent.name}，配置与 Key 独立保存。`); } catch (error) { setError((error as Error).message); } finally { setBusy(false); } }}>复制</button><button className="text-button danger" disabled={busy} aria-label={`删除人群 ${agent.name}`} onClick={async () => {
                  if (!window.confirm(`删除人群预设“${agent.name}”？已保存调查引用的预设须先解除引用。`)) return;
                  setBusy(true); setError(''); try { await researchApi(`/resident-agents/${agent.id}`, 'DELETE'); setResidents(previous => previous.filter(item => item.id !== agent.id)); invalidate(selectedIds.includes(agent.id)); setSelectedIds(previous => previous.filter(id => id !== agent.id)); setNotice('人群预设已删除。'); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
                }}>删除</button></div></article>)}</div>
      </section>
    </>}
    {editing && <Suspense fallback={<p role="status">加载人群配置…</p>}><ResidentAgentEditor key={editing === 'new' ? 'new' : editing.id} agent={editing === 'new' ? null : editing} templates={residentTemplates} onClose={() => setEditing(null)} onDirtyChange={setResidentDirty} onSave={async input => {
      const saved = await researchApi<ResidentAgentPublic>(editing === 'new' ? '/resident-agents' : `/resident-agents/${editing.id}`, editing === 'new' ? 'POST' : 'PATCH', input);
      setResidents(previous => previous.some(item => item.id === saved.id) ? previous.map(item => item.id === saved.id ? saved : item) : [...previous, saved]);
      invalidate(false); setEditing(null); setNotice('人群预设已保存；尚未启动调查。');
    }} /></Suspense>}
  </div>;
}

function IssueList({ items }: { items: string[] }) {
  return items.length ? <ul className="research-issues">{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : null;
}
