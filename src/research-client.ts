import type { preflightResearchTask } from '../server/research/contract';

export async function researchApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (import.meta.env.MODE === 'pages') return (await import('./pages-api')).pagesApi<T>(path, method, body);
  const response = await fetch(`/api/research${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(`${payload?.error || `请求失败 (${response.status})`}${payload?.fields?.length ? `：${payload.fields.join('、')}` : ''}`);
  return payload as T;
}

export interface ProjectCheck {
  taskCheck: ReturnType<typeof preflightResearchTask>;
  residents: { id: string; name: string; status: string; missingEvidence: string[]; warnings: string[]; enabled: boolean; modelConfigured: boolean; updatedAt: string }[];
  executorAvailable: false; modelCalls: 0; marketResearchValidated: false; executionBlockers: string[];
}

export function downloadJson(value: unknown, name: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
