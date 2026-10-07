import { getResearchTemplates } from '../server/research/templates';
import { assertPublicMetadataSafe, getResidentTemplates, residentCreateSchema, residentPatchSchema, residentPublicSchema, residentPublic, residentInput, researchProjectInputSchema, type ResidentAgentPublic, type ResidentAgentInput, type ResearchProject } from '../server/research/residents';
import { preflightResearchTask } from '../server/research/contract';
import { compilePopulation, regionPackSchema } from '../server/population/model';
import populationData from '../data/population/regions/binjiang-2020.json';

export const pagesPack = regionPackSchema.parse(populationData);
export const pagesPopulation = compilePopulation(pagesPack);
const PREFIX = 'city-agent-pages-v1:';
const keys = new Map<string, string>();
function load<T>(name: string, fallback: T): T {
  let value: string | null;
  try { value = localStorage.getItem(PREFIX + name); }
  catch { throw new Error('本机浏览器存储不可读；请检查隐私模式或存储权限，已有资料未被覆盖。'); }
  if (value === null) return fallback;
  try { return JSON.parse(value) as T; } catch { throw new Error('本机浏览器保存的数据无法读取；请导出可用资料后清理本站存储。'); }
}
function sessionSecrets(extra: readonly string[] = []) { return [...keys.values(), ...extra].filter(Boolean); }
function persist(name: string, value: unknown, extra: readonly string[] = []) {
  assertPublicMetadataSafe(value, sessionSecrets(extra), name === 'projects' ? '调查草稿' : '人群公开配置');
  try { localStorage.setItem(PREFIX + name, JSON.stringify(value)); }
  catch { throw new Error('本机浏览器存储不可写或空间不足；未保存，请先导出可用资料。'); }
}
function residents(): ResidentAgentPublic[] {
  const saved = load<ResidentAgentPublic[] | null>('residents', null);
  if (saved) return saved.map(value => {
    assertPublicMetadataSafe(value, sessionSecrets(), '人群公开配置');
    const parsed = residentPublicSchema.safeParse(value);
    if (!parsed.success) throw new Error('本机人群存档格式不受支持；公开存档不能包含API Key等私有字段，请勿直接导入私有配置。');
    return { ...parsed.data, hasApiKey: keys.has(parsed.data.id) };
  });
  const seeded = getResidentTemplates().map(input => residentPublic(residentCreateSchema.parse(input), crypto.randomUUID(), new Date().toISOString(), false));
  persist('residents', seeded); return seeded;
}
function saveResidents(agents: ResidentAgentPublic[], extra: readonly string[] = []) {
  persist('residents', agents.map(agent => ({ ...agent, hasApiKey: false })), extra);
}
export function getBrowserModel(id: string) {
  const agent = residents().find(agent => agent.id === id);
  if (!agent?.enabled || !keys.has(id)) throw new Error('请在“人群 Agent 预设”中启用预设并填入本次会话的 API Key。');
  return { provider: agent.provider, baseUrl: agent.baseUrl, modelId: agent.modelId, apiKey: keys.get(id)! };
}
export async function pagesApi<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
  let result: unknown;
  const agents = residents();
  if (route === '/templates' && method === 'GET') result = { templates: getResearchTemplates(), executorAvailable: false };
  else if (route === '/resident-templates' && method === 'GET') result = getResidentTemplates();
  else if (route === '/resident-agents' && method === 'GET') result = agents;
  else if (route === '/resident-agents' && method === 'POST') {
    const input = residentCreateSchema.parse(body); const id = crypto.randomUUID();
    result = residentPublic(input, id, new Date().toISOString(), Boolean(input.apiKey));
    saveResidents([...agents, result as ResidentAgentPublic], input.apiKey ? [input.apiKey] : []);
    if (input.apiKey) keys.set(id, input.apiKey);
  } else if (route.startsWith('/resident-agents/')) {
    const [id, action] = route.slice('/resident-agents/'.length).split('/');
    const existing = agents.find(agent => agent.id === id);
    if (!existing) throw new Error('人群预设不存在。');
    if (method === 'PATCH' && !action) {
      const patch = residentPatchSchema.parse(body);
      const merged = residentCreateSchema.parse({ ...residentInput(existing), ...patch });
      const endpointChanged = merged.provider !== existing.provider || merged.baseUrl.replace(/\/+$/, '') !== existing.baseUrl;
      const nextKey = patch.apiKey !== undefined ? patch.apiKey || undefined : endpointChanged ? undefined : keys.get(id);
      result = residentPublic(merged, id, existing.createdAt, Boolean(nextKey));
      saveResidents(agents.map(agent => agent.id === id ? result as ResidentAgentPublic : agent), nextKey ? [nextKey] : []);
      if (nextKey) keys.set(id, nextKey); else keys.delete(id);
    } else if (method === 'POST' && action === 'clone') {
      if (body && Object.keys(body).length) throw new Error('复制请求不接受额外字段。');
      const cloneId = crypto.randomUUID(); const cloneKey = keys.get(id);
      result = residentPublic(residentCreateSchema.parse({ ...residentInput(existing), name: `${existing.name.slice(0, 94)} 副本` }), cloneId, new Date().toISOString(), Boolean(cloneKey));
      saveResidents([...agents, result as ResidentAgentPublic]);
      if (cloneKey) keys.set(cloneId, cloneKey);
    } else if (method === 'DELETE' && !action) {
      if (load<ResearchProject[]>('projects', []).some(project => project.residentAgentIds.includes(id))) throw new Error('此预设仍被草稿引用，请先取消选择并保存草稿。');
      saveResidents(agents.filter(agent => agent.id !== id)); keys.delete(id); result = null;
    } else throw new Error('不支持此预设操作。');
  } else if (route === '/projects/validate' && method === 'POST') {
    const input = researchProjectInputSchema.parse(body);
    const selected = input.residentAgentIds.map(id => { const agent = agents.find(agent => agent.id === id); if (!agent) throw new Error('预设引用失效。'); return agent; });
    result = { taskCheck: preflightResearchTask(input.task, pagesPack), residents: selected.map(agent => {
      const filters = [...new Map([...input.task.population.filters, ...agent.population.filters].map(filter => [JSON.stringify(filter), filter])).values()];
      if (filters.length > 24) throw new Error('合并筛选超过24项。');
      const check = preflightResearchTask({ ...input.task, population: { ...input.task.population, filters } }, pagesPack);
      const incompatible = ['regionCode', 'period', 'unit'].some(key => agent.population[key as keyof typeof agent.population] !== input.task.population[key as keyof typeof input.task.population]);
      const missingEvidence = [...check.missingEvidence, ...(incompatible ? ['预设与问卷的区域、时点或单位不一致。'] : [])];
      return { id: agent.id, name: agent.name, enabled: agent.enabled, modelConfigured: agent.hasApiKey, updatedAt: agent.updatedAt, status: check.status === 'unsupported' ? check.status : missingEvidence.length ? 'needs-data' : check.status, missingEvidence, warnings: check.warnings };
    }), executorAvailable: false, modelCalls: 0, marketResearchValidated: false,
      executionBlockers: ['预检只检查人口框；请在下方仿真区选择演示或真实模型。', ...(!selected.length ? ['尚未选择人群预设。'] : [])] };
  } else if (route === '/projects' && method === 'GET') {
    result = load<ResearchProject[]>('projects', []);
    assertPublicMetadataSafe(result, sessionSecrets(), '调查草稿');
  }
  else if ((route === '/projects' && method === 'POST') || (route.startsWith('/projects/') && method === 'PUT')) {
    const input = researchProjectInputSchema.parse(body); const saved = load<ResearchProject[]>('projects', []);
    if (input.residentAgentIds.some(id => !agents.some(agent => agent.id === id))) throw new Error('人群引用失效。');
    const existing = method === 'PUT' ? saved.find(project => project.id === route.slice('/projects/'.length)) : undefined;
    if (method === 'PUT' && !existing) throw new Error('调查草稿不存在。');
    result = { ...input, id: existing?.id ?? crypto.randomUUID(), stage: 'draft', createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
    persist('projects', [result, ...saved.filter(project => project.id !== (result as ResearchProject).id)]);
  } else throw new Error('GitHub 版暂不支持此操作。');
  return structuredClone(result) as T;
}
export function browserPresets() { return residents(); }
