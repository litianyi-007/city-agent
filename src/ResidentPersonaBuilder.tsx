import { PERSONA_CATALOG, createDefaultPersona, type ResidentPersona } from '../shared/resident-persona';
import { PERSONA_SCENARIOS, createPersonaScenario } from '../shared/persona-scenarios';
import './persona.css';

type Option<T extends string = string> = { id: T; label: string };
type Custom = { label: string; description: string };
function Choice<T extends string>({ label, options, value, onChange }: { label: string; options: readonly Option<T>[]; value: T; onChange: (value: T) => void }) {
  return <label>{label}<select value={value} onChange={event => { const selected = options.find(option => option.id === event.target.value); if (selected) onChange(selected.id); }}>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>;
}
function Checks<T extends string>({ label, options, value, onChange }: { label: string; options: readonly Option<T>[]; value: T[]; onChange: (value: T[]) => void }) {
  return <div className="persona-checks" role="group" aria-label={label}><p>{label}（可多选，留空为未知/未设定）</p>{options.map(option => <label className="checkbox-label" key={option.id}><input type="checkbox" checked={value.includes(option.id)} onChange={event => onChange(event.target.checked ? [...value, option.id] : value.filter(item => item !== option.id))} />{option.label}</label>)}</div>;
}
function Customs({ label, value, onChange }: { label: string; value: Custom[]; onChange: (value: Custom[]) => void }) {
  return <div className="persona-customs"><h4>{label}</h4>{value.map((item, index) => <div className="persona-custom" key={index}>
    <label>{label}名称 {index + 1}<input required maxLength={80} value={item.label} onChange={event => onChange(value.map((entry, position) => position === index ? { ...entry, label: event.target.value } : entry))} /></label>
    <label>{label}说明 {index + 1}<textarea rows={2} required maxLength={500} value={item.description} onChange={event => onChange(value.map((entry, position) => position === index ? { ...entry, description: event.target.value } : entry))} /></label>
    <button className="text-button danger" type="button" aria-label={`移除${label} ${index + 1}`} onClick={() => onChange(value.filter((_entry, position) => position !== index))}>移除</button>
  </div>)}<button className="secondary compact" type="button" disabled={value.length >= 8} onClick={() => onChange([...value, { label: '', description: '' }])}>＋ 添加{label}</button></div>;
}

export function ResidentPersonaBuilder({ value, onChange }: { value: ResidentPersona; onChange: (value: ResidentPersona) => void }) {
  const update = <K extends keyof ResidentPersona>(key: K, next: ResidentPersona[K]) => onChange({ ...value, [key]: next });
  return <section className="persona-builder" aria-label="五层人群情景构建">
    <h3>五层人群构建 · 可选情景设定</h3>
    <p className="research-note warning">所有值都是用户的情景假设，不是DNA推断、真人心理测量或滨江人群占比。未设置保持未知；不会从年龄、性别、街道推算人格、收入或购买答案。</p>
    <label>叠加探索情景组合<select defaultValue="" onChange={event => { if (event.target.value) onChange(createPersonaScenario(event.target.value)); event.target.value = ''; }}><option value="">选择组合（会替换当前五层设定）</option>{PERSONA_SCENARIOS.map(scenario => <option key={scenario.id} value={scenario.id}>{scenario.label}</option>)}</select></label>
    <p className="research-note">组合只覆盖不同生活情景，没有人口权重；不会改变资格筛选。照护/在读/养宠资格须单独登记，当前工作身份不能推断成长经历。</p>
    <details className="persona-layer" open><summary>第一层 · 基础人格倾向（Big Five，非遗传标签）</summary>
      <p className="research-note">参考大五维度，不复制授权量表。0–100是仿真参数刻度，不是测量分数或百分位；50不等于“滨江平均”。<a href="https://www.ocf.berkeley.edu/~johnlab/bfi.html" target="_blank" rel="noreferrer">研究依据 ↗</a></p>
      <div className="persona-traits">{PERSONA_CATALOG.bigFive.map(trait => <div key={trait.id}>
        <label>{trait.label}情景档位<select aria-label={`${trait.label}情景档位`} value={value.personality[trait.id] === null ? 'unknown' : [25, 50, 75].includes(value.personality[trait.id]!) ? String(value.personality[trait.id]) : 'custom'} onChange={event => { const selected = event.target.value; if (selected !== 'custom') update('personality', { ...value.personality, [trait.id]: selected === 'unknown' ? null : Number(selected) }); }}><option value="unknown">未知 / 不设定</option><option value="25">较低（示意25）</option><option value="50">中等（示意50，非人口平均）</option><option value="75">较高（示意75）</option><option value="custom" disabled>自定义值请在下方填写</option></select></label>
        <label>{trait.label}<input type="number" min={0} max={100} step={1} placeholder="未知" value={value.personality[trait.id] ?? ''} onChange={event => update('personality', { ...value.personality, [trait.id]: event.target.value === '' ? null : Number(event.target.value) })} /><small>{trait.description}</small></label>
      </div>)}</div>
      <Customs label="自定义人格倾向" value={value.personality.customTraits} onChange={customTraits => update('personality', { ...value.personality, customTraits })} />
    </details>
    <details className="persona-layer"><summary>第二层 · 成长环境（主要照护＋多选经历）</summary>
      <Choice label="成长期间主要照护结构" options={PERSONA_CATALOG.primaryCaregiving} value={value.upbringing.primaryCaregiving} onChange={primaryCaregiving => update('upbringing', { ...value.upbringing, primaryCaregiving })} />
      <Checks label="成长环境与迁居经历" options={PERSONA_CATALOG.experiences} value={value.upbringing.experiences} onChange={experiences => update('upbringing', { ...value.upbringing, experiences })} />
      <p className="research-note">单亲、双亲和祖辈照护可在不同成长阶段共存，经历可多选、时间段可用自定义说明；主要照护单选不覆盖整段人生。不从任何背景推断人格；“迁居”不等于户籍或现住地证明。</p>
      <Customs label="自定义成长经历" value={value.upbringing.customExperiences} onChange={customExperiences => update('upbringing', { ...value.upbringing, customExperiences })} />
    </details>
    <details className="persona-layer"><summary>第三层 · 教育程度</summary>
      <Choice label="已完成的最高教育程度" options={PERSONA_CATALOG.education} value={value.education.level} onChange={level => update('education', { ...value.education, level })} />
      <label>教育补充说明（可选）<input maxLength={500} value={value.education.customDetail} onChange={event => update('education', { ...value.education, customDetail: event.target.value })} /></label>
      <p className="research-note">学历不代替收入、智力或消费能力；在读阶段与已完成学历分开。</p>
    </details>
    <details className="persona-layer"><summary>第四层 · 当前关系与家庭职责</summary>
      <Choice label="当前关系状态" options={PERSONA_CATALOG.relationship} value={value.household.relationship} onChange={relationship => update('household', { ...value.household, relationship })} />
      <Checks label="居住组成与照护职责" options={PERSONA_CATALOG.livingRoles} value={value.household.livingRoles} onChange={livingRoles => update('household', { ...value.household, livingRoles })} />
      <p className="research-note">单身不等于独居，结婚不等于育儿；宠物与家庭成员购买角色仍由独立资格筛选指定。</p>
      <Customs label="自定义家庭职责" value={value.household.customRoles} onChange={customRoles => update('household', { ...value.household, customRoles })} />
    </details>
    <details className="persona-layer"><summary>第五层 · 社会分工与收入口径</summary>
      <Choice label="当前主要就业/学习状态" options={PERSONA_CATALOG.employment} value={value.work.employment} onChange={employment => update('work', { ...value.work, employment })} />
      <label>职业或分工说明（可选）<input maxLength={200} value={value.work.occupation} onChange={event => update('work', { ...value.work, occupation: event.target.value })} placeholder="不按职业预设商品偏好" /></label>
      <Checks label="社会角色" options={PERSONA_CATALOG.socialRoles} value={value.work.socialRoles} onChange={socialRoles => update('work', { ...value.work, socialRoles })} />
      <Choice label="月收入口径（人民币，不是零食预算）" options={PERSONA_CATALOG.incomeBasis} value={value.work.income.basis} onChange={basis => update('work', { ...value.work, income: { ...value.work.income, basis: basis as ResidentPersona['work']['income']['basis'] } })} />
      <div className="form-two">{(['lower', 'upper'] as const).map(key => <label key={key}>月收入{key === 'lower' ? '下界' : '上界'}（元，留空未知）<input type="number" min={0} step="any" value={value.work.income[key] ?? ''} onChange={event => update('work', { ...value.work, income: { ...value.work.income, [key]: event.target.value === '' ? null : Number(event.target.value) } })} /></label>)}</div>
      <p className="research-note">个人税前收入与家庭可支配收入不混用；区平均可支配收入不能赋给每个居民。缺少口径/完整区间时不补均值。</p>
      <Customs label="自定义社会角色" value={value.work.customRoles} onChange={customRoles => update('work', { ...value.work, customRoles })} />
    </details>
    <button className="secondary" type="button" onClick={() => onChange(createDefaultPersona())}>清空五层设定 · 全部恢复未知</button>
  </section>;
}
