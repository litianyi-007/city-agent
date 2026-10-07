import { useEffect, useRef, useState } from 'react';
import type { ResidentAgentInput, ResidentAgentPublic } from '../server/research/residents';
import { researchTaskSchema } from '../shared/research-schema';
import { residentPersonaSchema, createDefaultPersona } from '../shared/resident-persona';
import { ResidentPersonaBuilder } from './ResidentPersonaBuilder';

interface Props {
  agent: ResidentAgentPublic | null;
  templates: ResidentAgentInput[];
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onSave: (input: ResidentAgentInput) => Promise<void>;
}

export function ResidentAgentEditor({ agent, templates, onClose, onSave, onDirtyChange }: Props) {
  const pagesMode = import.meta.env.MODE === 'pages';
  const [form, setForm] = useState<ResidentAgentInput>(() => ({
    ...templates[0], provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', enabled: true, behaviorNotes: '',
    persona: createDefaultPersona(),
    ...(agent ? { name: agent.name, templateId: agent.templateId, description: agent.description, population: agent.population,
      assumptions: agent.assumptions, behaviorNotes: agent.behaviorNotes, provider: agent.provider,
      baseUrl: agent.baseUrl, modelId: agent.modelId, enabled: agent.enabled, persona: agent.persona ?? createDefaultPersona() } : {}),
  }));
  const [filters, setFilters] = useState(JSON.stringify(form.population.filters, null, 2));
  const [assumptions, setAssumptions] = useState((form.assumptions ?? []).join('\n'));
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  function close() {
    if (!busy && (!dirty || window.confirm('人群预设有未保存修改，是否放弃？'))) onClose();
  }
  const set = <K extends keyof ResidentAgentInput>(key: K, value: ResidentAgentInput[K]) => setForm(previous => ({ ...previous, [key]: value }));
  const endpointChanged = agent && (form.provider !== agent.provider || form.baseUrl?.replace(/\/+$/, '') !== agent.baseUrl);

  return <dialog ref={dialog} className="agent-dialog resident-dialog" aria-labelledby="resident-editor-title" onCancel={event => { event.preventDefault(); close(); }}>
    <form onChangeCapture={() => setDirty(true)} onSubmit={async event => {
      event.preventDefault(); setError(''); setBusy(true);
      try {
        const population = researchTaskSchema.shape.population.parse({ ...form.population, filters: JSON.parse(filters) });
        const checked = residentPersonaSchema.safeParse(form.persona);
        if (!checked.success) throw new Error(`五层设定无效：${checked.error.issues.map(issue => `${issue.path.join('.')}：${issue.message}`).join('；')}`);
        await onSave({ ...form, persona: checked.data, population, assumptions: assumptions.split('\n').map(line => line.trim()).filter(Boolean),
          ...(apiKey ? { apiKey } : clearKey ? { apiKey: null } : {}) });
      } catch (error) { setError(error instanceof SyntaxError ? '筛选条件不是有效 JSON，请检查括号与引号。' : (error as Error).message); }
      finally { setBusy(false); }
    }}>
      <div className="dialog-heading"><div><div className="eyebrow">RESIDENT AGENT PRESET</div><h2 id="resident-editor-title">{agent ? '编辑人群 Agent' : '新建人群 Agent'}</h2></div><button type="button" className="close-button" aria-label="关闭人群配置" disabled={busy} onClick={close}>×</button></div>
      {error && <div className="alert error" role="alert">{error}</div>}
      <p className="research-note">这是模拟受访者的配置预设，不是真实居民记录，也不是已验证的代表样本。</p>
      <fieldset disabled={busy}>
        <div className="form-two">
          <label>预设名称<input autoFocus required maxLength={100} value={form.name} onChange={event => set('name', event.target.value)} /></label>
          <label>人群模板<select value={form.templateId} onChange={event => {
            const template = templates.find(item => item.templateId === event.target.value);
            if (template) {
              setForm(previous => ({ ...previous, ...template, persona: template.persona ?? createDefaultPersona(), behaviorNotes: '' }));
              setFilters(JSON.stringify(template.population.filters, null, 2)); setAssumptions((template.assumptions ?? []).join('\n'));
            } else set('templateId', 'custom');
          }}>{templates.map(template => <option key={template.templateId} value={template.templateId}>{template.name}</option>)}<option value="custom">自定义人群</option></select></label>
        </div>
        <label>画像说明<textarea rows={3} maxLength={2000} required value={form.description} onChange={event => set('description', event.target.value)} /></label>
        <div className="form-two"><label>区域 ID<input required maxLength={80} value={form.population.regionCode} onChange={event => set('population', { ...form.population, regionCode: event.target.value })} /></label><label>统计时点<input required maxLength={80} value={form.population.period} onChange={event => set('population', { ...form.population, period: event.target.value })} /></label></div>
        <label>统计单位<select value={form.population.unit} onChange={event => set('population', { ...form.population, unit: event.target.value as 'person' | 'household' })}><option value="person">个人</option><option value="household">家庭（当前无家庭统计框）</option></select></label>
        <label>人口与资格筛选（JSON，所有条件取交集）<textarea className="json-input" rows={6} value={filters} onChange={event => setFilters(event.target.value)} /></label>
        <label>情景假设（每行一项）<textarea rows={3} maxLength={20000} value={assumptions} onChange={event => setAssumptions(event.target.value)} /></label>
        <label>行为设定（可留空，均按情景假设处理）<textarea rows={2} maxLength={2000} value={form.behaviorNotes || ''} onChange={event => set('behaviorNotes', event.target.value)} placeholder="不预填待研究的商品偏好、可接受价格或购买答案" /></label>
        <ResidentPersonaBuilder value={form.persona ?? createDefaultPersona()} onChange={persona => { set('persona', persona); setDirty(true); }} />
        <h3 className="resident-model-heading">独立模型配置</h3>
        <label>Provider<select value={form.provider} onChange={event => setForm(previous => ({ ...previous, provider: event.target.value as ResidentAgentInput['provider'] }))}><option value="deepseek">DeepSeek</option><option value="openai-compatible">OpenAI Compatible（含自定义服务）</option><option value="anthropic">Anthropic</option></select></label>
        <label>Base URL<input required type="url" maxLength={2048} value={form.baseUrl} onChange={event => set('baseUrl', event.target.value)} /></label>
        <label>Model ID<input required maxLength={200} value={form.modelId} onChange={event => set('modelId', event.target.value)} /></label>
        <label>API Key<input type="password" autoComplete="new-password" value={apiKey} maxLength={8192} onChange={event => { setApiKey(event.target.value); setClearKey(false); }} placeholder={agent?.hasApiKey ? '留空保持本次Key；更换服务地址后须重新填写' : pagesMode ? '仅保留在当前页面会话' : '仅加密保存于本机后端'} /></label>
        {agent?.hasApiKey && <label className="checkbox-label"><input type="checkbox" checked={clearKey} onChange={event => { setClearKey(event.target.checked); setApiKey(''); }} />清除已保存的 Key</label>}
        {endpointChanged && <p className="research-note warning">已更换提供方或地址；如未填写新 Key，保存时会清除原 Key。</p>}
        <label className="checkbox-label"><input type="checkbox" checked={form.enabled} onChange={event => set('enabled', event.target.checked)} />启用此预设（不代表启动居民）</label>
      </fieldset>
      <div className="dialog-note">本阶段只保存配置，不调用模型。长期记忆、dream 和外部工具尚未启用。</div>
      <div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={close}>取消</button><button className="primary" disabled={busy}>{busy ? '保存中…' : '保存人群预设'}</button></div>
    </form>
  </dialog>;
}
