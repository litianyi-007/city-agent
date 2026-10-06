import type { ResearchTask } from '../shared/research-schema';

export type Question = ResearchTask['questionnaire']['questions'][number];
export const questionTypes = { single: '单选', multiple: '多选', scale: '量表', number: '数值', text: '开放回答' } as const;
export function newQuestion(type: Question['type'], id: string, prompt = ''): Question {
  const base = { id, prompt, required: true };
  switch (type) {
    case 'single': return { ...base, type, options: [{ id: 'option-1', label: '选项一' }, { id: 'option-2', label: '选项二' }] };
    case 'multiple': return { ...base, type, options: [{ id: 'option-1', label: '选项一' }, { id: 'option-2', label: '选项二' }], minSelections: 1, maxSelections: 2 };
    case 'scale': return { ...base, type, min: 1, max: 5, minLabel: '最低', maxLabel: '最高' };
    case 'number': return { ...base, type, min: 0, max: 1000, unit: '元' };
    case 'text': return { ...base, type, maxLength: 1000 };
  }
}

export function QuestionEditor({ question, index, onChange, onRemove, onMove, count }: {
  question: Question; index: number; count: number; onChange: (question: Question) => void; onRemove: () => void; onMove: (direction: number) => void;
}) {
  return <article className="question-card">
    <div className="question-top"><strong>问题 {index + 1}</strong><code>{question.id}</code><div className="question-actions"><button type="button" className="text-button" disabled={index === 0} aria-label={`上移问题 ${index + 1}`} onClick={() => onMove(-1)}>上移</button><button type="button" className="text-button" disabled={index === count - 1} aria-label={`下移问题 ${index + 1}`} onClick={() => onMove(1)}>下移</button><button type="button" className="text-button danger" disabled={count === 1} aria-label={`删除问题 ${index + 1}`} onClick={onRemove}>删除</button></div></div>
    <label>题目内容<textarea required rows={2} maxLength={2000} value={question.prompt} onChange={event => onChange({ ...question, prompt: event.target.value })} /></label>
    <div className="question-controls"><label>题型<select value={question.type} onChange={event => onChange({ ...newQuestion(event.target.value as Question['type'], question.id, question.prompt), required: question.required })}>{Object.entries(questionTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="checkbox-label"><input type="checkbox" checked={question.required} onChange={event => onChange({ ...question, required: event.target.checked })} />必答</label><span>更换题型会重置本题选项与范围</span></div>
    {'options' in question && <div className="question-options">{question.options.map((option, optionIndex) => <div className="question-option" key={option.id}><code>{option.id}</code><label><span className="sr-only">问题 {index + 1} 选项 {optionIndex + 1}</span><input required maxLength={300} value={option.label} onChange={event => onChange({ ...question, options: question.options.map(item => item.id === option.id ? { ...item, label: event.target.value } : item) })} /></label><button type="button" className="text-button" disabled={question.options.length <= (question.type === 'single' ? 2 : 1)} aria-label={`删除问题 ${index + 1} 选项 ${optionIndex + 1}`} onClick={() => onChange({ ...question, options: question.options.filter(item => item.id !== option.id) })}>移除</button></div>)}<button type="button" className="secondary compact" disabled={question.options.length >= 30} onClick={() => onChange({ ...question, options: [...question.options, { id: `option-${crypto.randomUUID().slice(0, 8)}`, label: '' }] })}>＋ 添加选项</button></div>}
    {question.type === 'multiple' && <div className="form-two"><label>最少选择<input type="number" min={0} max={30} value={question.minSelections} onChange={event => onChange({ ...question, minSelections: Number(event.target.value) })} /></label><label>最多选择<input type="number" min={1} max={30} value={question.maxSelections} onChange={event => onChange({ ...question, maxSelections: Number(event.target.value) })} /></label></div>}
    {(question.type === 'scale' || question.type === 'number') && <div className="form-two"><label>下界<input type="number" step={question.type === 'number' ? 'any' : 1} value={question.min} onChange={event => onChange({ ...question, min: Number(event.target.value) })} /></label><label>上界<input type="number" step={question.type === 'number' ? 'any' : 1} value={question.max} onChange={event => onChange({ ...question, max: Number(event.target.value) })} /></label></div>}
    {question.type === 'scale' && <div className="form-two"><label>最低分含义<input required maxLength={200} value={question.minLabel} onChange={event => onChange({ ...question, minLabel: event.target.value })} /></label><label>最高分含义<input required maxLength={200} value={question.maxLabel} onChange={event => onChange({ ...question, maxLabel: event.target.value })} /></label></div>}
    {question.type === 'number' && <label>单位<input required maxLength={80} value={question.unit} onChange={event => onChange({ ...question, unit: event.target.value })} /></label>}
    {question.type === 'text' && <label>回答字数上限<input type="number" min={1} max={2000} value={question.maxLength} onChange={event => onChange({ ...question, maxLength: Number(event.target.value) })} /></label>}
  </article>;
}
