import { productionEnvironment } from '../config/production-environment.js';
const { apiPort } = productionEnvironment();
const root = `http://127.0.0.1:${apiPort}/api/production`;
const started = await fetch(`${root}/jev/benchmarks`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ budgetAuthorized: true }), signal: AbortSignal.timeout(10000) });
if (started.status !== 202) throw new Error(`Benchmark start returned ${started.status}; no retry`);
const { id } = await started.json() as { id: string };
console.log(JSON.stringify({ started: id, limits: '3 requests / 1 USD estimated / no retry', evidence: 'synthetic candidate pool + real Jev decision, not real generation' }));
const deadline = Date.now() + 180000;
while (Date.now() < deadline) {
  const response = await fetch(`${root}/jev/benchmarks`, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Observation failed ${response.status}; does not restart the task`);
  const run = (await response.json() as Array<{ id: string; status: string; durationMs: number | null; usage: unknown; metrics: unknown; error?: string }>).find(value => value.id === id);
  if (run && !['queued', 'running'].includes(run.status)) { console.log(JSON.stringify({ id, status: run.status, durationMs: run.durationMs, usage: run.usage, metrics: run.metrics, error: run.error ?? null })); process.exit(0); }
  await new Promise(resolve => setTimeout(resolve, 500));
}
await fetch(`${root}/jev/benchmarks/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
throw new Error('Observation deadline exceeded; cancellation requested, no automatic retry');
