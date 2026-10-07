import { z } from 'zod';
import { auditBusinessDemoRun, BUSINESS_FIXTURE_POLICY_ID, type BusinessDemoExecution } from '../shared/research-demo';
import { fingerprint } from '../shared/evidence';
import { validateQuestionnaireLogicRules } from '../shared/questionnaire-logic';
import { parseSurveyEvidence } from './run-history';

export type BusinessProofSnapshot = {
  schemaVersion: '1.0'; kind: 'business-demo-proof'; execution: 'fixture-only'; realModelCalls: 0;
  run: BusinessDemoExecution['run']; logicAudit: BusinessDemoExecution['logicAudit'];
};
const envelope = z.object({ schemaVersion: z.literal('1.0'), kind: z.literal('business-demo-proof'),
  execution: z.literal('fixture-only'), realModelCalls: z.literal(0), run: z.unknown(), logicAudit: z.unknown() }).strict();

/** Recompute using the snapshot's own rules, never the current demo blueprint; hashes are not external attestation. */
export function parseBusinessProofSnapshot(input: unknown): BusinessProofSnapshot {
  const value = envelope.parse(input); const run = parseSurveyEvidence(value.run);
  if (run.mode !== 'fixture' || run.parameters?.fixturePolicyId !== BUSINESS_FIXTURE_POLICY_ID || run.metrics.modelCalls !== 0) throw new Error('仅接受登记的零模型业务工程自证。');
  if (!value.logicAudit || typeof value.logicAudit !== 'object' || !('rules' in value.logicAudit)) throw new Error('业务证据缺少冻结逻辑规则。');
  if (!('verifierVersion' in value.logicAudit) || value.logicAudit.verifierVersion !== 'explicit-questionnaire-logic-1.1') throw new Error('旧业务审计版本仅保留原始附件，不能静默升级为当前通过结论。');
  const rules = validateQuestionnaireLogicRules(run.task, value.logicAudit.rules);
  const recomputed = auditBusinessDemoRun(run, rules);
  if (fingerprint(recomputed) !== fingerprint(value.logicAudit)) throw new Error('跨题审计与原文/冻结规则不一致；拒绝静默升级或修补旧结果。');
  return { ...value, run, logicAudit: value.logicAudit as BusinessDemoExecution['logicAudit'] };
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('city-agent-business-proof-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('proofs', { keyPath: 'run.id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('业务自证库不可用，请立即导出完整自证包。'));
  });
}
export async function saveBusinessProofSnapshot(input: BusinessProofSnapshot): Promise<void> {
  const snapshot = parseBusinessProofSnapshot(input); const db = await open();
  try { await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('proofs', 'readwrite'); transaction.objectStore('proofs').add(snapshot);
    transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(new Error('完整业务自证保存失败（空间不足或ID已存在）；未覆盖原证据，当前结果仍可导出。'));
  }); } finally { db.close(); }
}
export async function readBusinessProofHistory(): Promise<{ proofs: BusinessProofSnapshot[]; rejected: number }> {
  const db = await open();
  try { return await new Promise((resolve, reject) => {
    const request = db.transaction('proofs').objectStore('proofs').getAll();
    request.onsuccess = () => {
      const proofs: BusinessProofSnapshot[] = []; let rejected = 0;
      for (const value of request.result) { try { proofs.push(parseBusinessProofSnapshot(value)); } catch { rejected++; } }
      resolve({ proofs: proofs.sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt)), rejected });
    };
    request.onerror = () => reject(new Error('无法读取完整业务自证历史，原记录未清除。'));
  }); } finally { db.close(); }
}
export async function listBusinessProofSnapshots(): Promise<BusinessProofSnapshot[]> { return (await readBusinessProofHistory()).proofs; }
