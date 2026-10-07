// Trusted engineering fault fixture. Never a generated application, model request or service.
import { writeFileSync } from 'node:fs';
import { VerifierStudyLedger } from '../../server/production/verifier-study-ledger.ts';

const [directory, point, invocationCounter] = process.argv.slice(2);
const runId = 'crash-study'; const decisionId = 'crash-decision'; const callId = 'crash-call';
const ledger = VerifierStudyLedger.create(directory, { runId, status: 'running', executionSource: 'injected-test', cachePolicy: 'bypass' });
writeFileSync(invocationCounter, '0', { flag: 'wx', mode: 0o600 });
if (point !== 'after-start') {
  ledger.append('decision-start', { runId, decisionId, poolId: 'H01', strategy: 'B', status: 'running' });
  ledger.append('call-intent', { runId, decisionId, callId, kind: 'llm', status: 'pending', requestSnapshot: { messages: ['new independent request'] }, usage: null });
}
if (point === 'after-call-result') {
  // Local injected callback only. Its independently persisted count proves recovery never replays it.
  writeFileSync(invocationCounter, '1', { mode: 0o600 });
  ledger.append('call-result', { runId, decisionId, callId, status: 'completed', usage: { inputTokens: 7, outputTokens: 2, estimatedCost: 0.1, currency: 'USD' }, providerRequests: 1, responseSnapshot: { decision: 'abstain' } });
}
process.send?.({ ready: true, point });
setInterval(() => {}, 1000); // Parent hard-kills only this dedicated child after the persisted point.
