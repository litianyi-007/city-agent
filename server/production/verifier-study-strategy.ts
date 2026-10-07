import { createHash } from 'node:crypto';
import { cameraSceneCodeSchema } from '../../shared/camera-scene-schema.js';
import { JEV_POLICY_VERSION, type JevCandidateContext, type JevEvaluation } from '../../shared/jev-schema.js';
import { phaseVerifierSystemPrompt, productionPhaseRubric } from '../../shared/production-verifier-rubric.js';
import { codeSchema, CRITERIA_VERSION, outputContractSnapshot, parseJson, parseVerifiedDecision, verifierSchema } from './contracts.js';
import { buildJevCandidateRequest } from './jev.js';
import type { verifierPreparationRequests } from './verifier-corpus-preparation.js';

export const VERIFIER_STUDY_STRATEGY_VERSION = 'verifier-study-strategy-v1' as const;
export type VerifierStudyStrategy = 'baseline' | 'llm' | 'jev-cascade';
export type VerifierStudyRequests = ReturnType<typeof verifierPreparationRequests>;
export interface VerifierStudyPorts {
  /** The controller must persist an intent and enforce accounting/budgets before dispatch.
   * It supplies a fresh independent call, not a result cache or an Oracle answer. */
  llm: (logical: { systemPrompt: string; userPrompt: string }, signal: AbortSignal) => Promise<string>;
  /** Trusted protocol adapter only: provider text cannot assign errorKind.
   * Production callers must use evaluateJevCandidates or an equivalently verified adapter. */
  jev: (context: JevCandidateContext, signal: AbortSignal) => Promise<JevEvaluation>;
}
type LlmDecision = ReturnType<typeof parseVerifiedDecision>;
type FailureCode = 'preflight' | 'integrity' | 'protocol' | 'unknown-usage' | 'transport' | 'cancelled' | 'timeout';
export interface VerifierStudySelection {
  version: typeof VERIFIER_STUDY_STRATEGY_VERSION;
  decision: 'accept' | 'abstain' | 'error';
  selectedCandidateId: string | null;
  engine: 'baseline' | 'llm' | 'jev' | 'jev-llm-fallback' | 'jev-llm-protocol-fallback';
  reason: string;
  failureCode?: FailureCode;
  fallbackKind: null | 'uncertain' | 'arithmetic-drift';
  /** Callback intents, NOT observed HTTP attempts or proof of provider usage. */
  callbackCounts: { llm: number; jev: number };
  requestBinding?: {
    inputSha256: string; logicalLlmSha256: string; jevRequestSha256: string;
    candidates: Array<{ id: string; candidateValueJsonSha256: string }>;
  };
  llmDecision?: LlmDecision;
  jevSummary?: Pick<JevEvaluation, 'status' | 'selectedCandidateId' | 'errorKind' | 'diagnostics' | 'usage'>;
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
function sameKeys(value: unknown, keys: string[]): boolean {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key));
}
class StudyFailure extends Error {
  constructor(readonly code: FailureCode, message: string) { super(message); }
}
const refuse = (code: FailureCode, message: string): never => { throw new StudyFailure(code, message); };

/** Pure decision policy with injected transports. No Key, filesystem write, provider
 * default, result cache, candidate generation/repair, Oracle execution or success metric.
 * Candidate/request hashes are checked before and after every callback. Schema failure
 * rejects the entire main-study pool; it does not silently remove a scheduled candidate. */
export async function selectVerifierStudy(strategy: VerifierStudyStrategy, requests: VerifierStudyRequests, ports: VerifierStudyPorts, signal: AbortSignal): Promise<VerifierStudySelection> {
  const result: VerifierStudySelection = { version: VERIFIER_STUDY_STRATEGY_VERSION, decision: 'error', selectedCandidateId: null,
    engine: strategy === 'baseline' ? 'baseline' : strategy === 'llm' ? 'llm' : 'jev', reason: '', callbackCounts: { llm: 0, jev: 0 }, fallbackKind: null };
  let originalHash: string; let prepared: VerifierStudyRequests;
  const assertLive = () => {
    if (signal.aborted) refuse(signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled', 'Study decision cancelled or timed out; no subsequent callback is allowed');
  };
  const assertIntegrity = () => {
    let current: string; try { current = hash(requests); } catch { refuse('integrity', 'Study input changed or became unserializable during a callback'); }
    if (current! !== originalHash || hash(prepared) !== originalHash) refuse('integrity', 'Study input changed during a callback; no decision or further call is allowed');
  };
  const invoke = async <T>(call: () => Promise<T>): Promise<T> => {
    assertLive(); assertIntegrity();
    // Abort rejects even an uncooperative injected port. This does NOT prove that
    // such a port released its transport; the controller must separately test cleanup.
    let listener!: () => void;
    const cancelled = new Promise<never>((_resolve, reject) => {
      listener = () => reject(new StudyFailure(signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled', 'Study decision cancelled or timed out; no subsequent callback is allowed'));
      signal.addEventListener('abort', listener, { once: true });
    });
    try { const value = await Promise.race([Promise.resolve().then(() => { assertLive(); return call(); }), cancelled]); assertLive(); assertIntegrity(); return value; }
    finally { signal.removeEventListener('abort', listener); }
  };
  try {
    assertLive();
    if (!['baseline', 'llm', 'jev-cascade'].includes(strategy)) refuse('preflight', 'Unknown study strategy');
    try { originalHash = hash(requests); prepared = freeze(structuredClone(requests)); }
    catch { refuse('preflight', 'Study requests must be bounded cloneable JSON data'); }
    if (bytes(prepared!) > 250000) refuse('preflight', 'Study request snapshot exceeds the bounded 250KB limit');
    const { snapshot, logicalLlm, jev, metadata } = prepared!;
    if (!sameKeys(snapshot, ['phase', 'capability', 'goal', 'acceptance', 'frozenHash', 'candidates', 'reviewContext'])
      || snapshot.phase !== 'implement' || !['offline-single-html', 'camera-scene-v1'].includes(snapshot.capability)
      || metadata.capability !== snapshot.capability || metadata.frozenHash !== snapshot.frozenHash
      || !/^[a-f0-9]{64}$/.test(snapshot.frozenHash ?? '')
      || snapshot.candidates.length < 1 || snapshot.candidates.length > 2
      || new Set(snapshot.candidates.map(candidate => candidate.id)).size !== snapshot.candidates.length
      || snapshot.candidates.some(candidate => !sameKeys(candidate, ['id', 'value']) || !/^[a-zA-Z0-9_-]{1,100}$/.test(candidate.id) || candidate.id === 'abstain')) refuse('preflight', 'Study pool identity, capability or frozen contract is invalid');
    const schema = snapshot.capability === 'camera-scene-v1' ? cameraSceneCodeSchema : codeSchema;
    if (snapshot.candidates.some(candidate => !schema.safeParse(candidate.value).success)) refuse('preflight', 'Every scheduled study candidate must pass the same strict artifact schema before selection');
    const candidateBindings = snapshot.candidates.map(candidate => ({ id: candidate.id, candidateValueJsonSha256: hash(candidate.value) }));
    if (metadata.candidates.length !== candidateBindings.length || candidateBindings.some((candidate, index) => candidate.id !== metadata.candidates[index]?.id || candidate.candidateValueJsonSha256 !== metadata.candidates[index]?.candidateValueJsonSha256)) refuse('integrity', 'Candidate bytes do not match their preparation hashes');
    if (!sameKeys(logicalLlm, ['systemPrompt', 'userPrompt']) || hash(logicalLlm) !== metadata.logicalLlmPromptSha256 || hash(jev) !== metadata.jevRequestSha256) refuse('integrity', 'Review request bytes do not match their preparation hashes');
    const rubric = productionPhaseRubric('implement', snapshot.capability)!;
    let payload: Record<string, any>;
    try { payload = parseJson(logicalLlm.userPrompt) as Record<string, any>; } catch { refuse('preflight', 'The logical review request is not valid JSON'); }
    const criteriaKeys = ['version', 'validationContract', 'compactOutputPolicy', 'repairPolicyVersion', 'phase', 'phaseReview', 'acceptance', 'goal', 'frozenHash', 'dimensions', 'minimumOrdinalScore', 'scale', 'candidateIds', ...(snapshot.capability === 'camera-scene-v1' ? ['capability', 'cameraRuntime', 'evidenceBoundary'] : [])];
    if (logicalLlm.systemPrompt !== phaseVerifierSystemPrompt(rubric)
      || !sameKeys(payload!, ['criteria', 'state', 'candidates', 'outputContract'])
      || !sameKeys(payload!.state, ['reviewContext'])
      || !sameKeys(payload!.criteria, criteriaKeys)
      || !sameKeys(snapshot.reviewContext, ['contextSource', 'product', 'research', 'plan', 'frozenContract', 'knownPlatform', 'coverageContract', 'feedback', 'cycle'])
      || hash(payload!.candidates) !== hash(snapshot.candidates) || hash(payload!.state.reviewContext) !== hash(snapshot.reviewContext)
      || hash(payload!.outputContract) !== hash(outputContractSnapshot(verifierSchema))
      || payload!.criteria?.version !== CRITERIA_VERSION || hash(payload!.criteria?.validationContract) !== hash(metadata.validationContract)
      || payload!.criteria?.phase !== snapshot.phase || payload!.criteria?.goal !== snapshot.goal
      || hash(payload!.criteria?.acceptance) !== hash(snapshot.acceptance) || payload!.criteria?.frozenHash !== snapshot.frozenHash
      || payload!.criteria?.minimumOrdinalScore !== 3 || hash(payload!.criteria?.phaseReview) !== hash(rubric)
      || hash(payload!.criteria?.candidateIds) !== hash(snapshot.candidates.map(candidate => candidate.id))) refuse('integrity', 'Independent LLM context, schema or candidates are not bound to the same study snapshot');
    const { requestLayoutVersion: _layout, trustBoundary: _boundary, phaseReview: _rubric, ...jevContext } = jev.state;
    if (hash(jevContext) !== hash(snapshot) || hash(buildJevCandidateRequest(jev.model, snapshot)) !== metadata.jevRequestSha256) refuse('integrity', 'Jev context or questions are not bound to the same blind study snapshot');
    const stateBytes = bytes(jev.state); const maxQuestionBytes = Math.max(...Object.values(jev.questions).map(question => bytes(question)));
    if (Buffer.byteLength(`${logicalLlm.systemPrompt}\n${logicalLlm.userPrompt}`, 'utf8') > 60000 || bytes(jev) > 64000 || stateBytes + maxQuestionBytes > 32000) refuse('preflight', 'Study review request exceeds unchanged context limits; no evidence was truncated');
    result.requestBinding = { inputSha256: originalHash!, logicalLlmSha256: metadata.logicalLlmPromptSha256, jevRequestSha256: metadata.jevRequestSha256, candidates: candidateBindings };
    if (strategy === 'baseline') { assertIntegrity(); result.decision = 'accept'; result.selectedCandidateId = snapshot.candidates[0].id; result.reason = 'First predeclared structurally legal candidate; independent behavior Oracle remains required'; return freeze(result); }
    const llm = async () => {
      const raw = await invoke(() => { result.callbackCounts.llm++; return ports.llm(freeze(structuredClone(logicalLlm)), signal); });
      if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > 32000) refuse('protocol', 'Independent LLM response exceeds the bounded 32KB parser input');
      let decision: LlmDecision; try { decision = parseVerifiedDecision(parseJson(raw), snapshot.candidates.map(candidate => candidate.id)); }
      catch { refuse('protocol', 'Independent LLM returned an invalid complete-candidate, minimum-score or highest-score decision; no second review is allowed'); }
      result.llmDecision = freeze(structuredClone(decision!)); result.decision = decision!.decision; result.selectedCandidateId = decision!.selectedCandidateId; result.reason = decision!.reason;
    };
    if (strategy === 'llm') { await llm(); return freeze(result); }
    const evaluation = await invoke(() => { result.callbackCounts.jev++; return ports.jev(freeze(structuredClone(snapshot)), signal); });
    let jevResult: JevEvaluation;
    try { jevResult = freeze(structuredClone(evaluation)); } catch { refuse('protocol', 'Trusted Jev adapter returned an uncloneable evaluation'); }
    const usage = jevResult!.usage;
    if (jevResult!.policyVersion !== JEV_POLICY_VERSION || !['accepted', 'rejected', 'uncertain', 'error'].includes(jevResult!.status)
      || typeof jevResult!.reason !== 'string' || jevResult!.reason.length > 1500
      || jevResult!.status !== 'error' && (jevResult!.errorKind !== undefined || jevResult!.error !== undefined)) refuse('protocol', 'Trusted Jev evaluation has an invalid policy, status or bounded summary');
    result.jevSummary = { status: jevResult!.status, selectedCandidateId: jevResult!.selectedCandidateId, ...(jevResult!.errorKind ? { errorKind: jevResult!.errorKind } : {}), ...(jevResult!.diagnostics ? { diagnostics: structuredClone(jevResult!.diagnostics) } : {}), usage: structuredClone(usage) };
    if (!usage?.complete || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens! < 0 || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens! < 0 || !Number.isFinite(usage.estimatedCost) || usage.estimatedCost! < 0 || usage.currency !== 'USD') refuse('unknown-usage', 'Jev usage or cost is unknown/invalid; no fallback, retry or zero-cost inference');
    if (jevResult!.status === 'error' && jevResult!.errorKind !== 'arithmetic-drift') refuse('protocol', 'Fatal Jev protocol/transport failure cannot trigger independent review');
    if (jevResult!.requestSnapshot === null || hash(jevResult!.requestSnapshot) !== metadata.jevRequestSha256) refuse('integrity', 'Trusted Jev evaluated a different study request');
    if (jevResult!.status === 'accepted') {
      if (!snapshot.candidates.some(candidate => candidate.id === jevResult!.selectedCandidateId)) refuse('protocol', 'Accepted Jev candidate ID is outside the current study pool');
      result.decision = 'accept'; result.selectedCandidateId = jevResult!.selectedCandidateId; result.reason = jevResult!.reason; return freeze(result);
    }
    if (jevResult!.selectedCandidateId !== null) refuse('protocol', 'Non-accepted Jev decisions cannot select a candidate');
    if (jevResult!.status === 'rejected') { result.decision = 'abstain'; result.reason = jevResult!.reason; return freeze(result); }
    if (jevResult!.status === 'error' && (!jevResult!.diagnostics?.length || jevResult!.scores.length || jevResult!.choice !== null)) refuse('protocol', 'Arithmetic fallback requires complete trusted diagnostics and no partial choice');
    result.fallbackKind = jevResult!.status === 'uncertain' ? 'uncertain' : 'arithmetic-drift';
    result.engine = result.fallbackKind === 'uncertain' ? 'jev-llm-fallback' : 'jev-llm-protocol-fallback';
    // Exactly the same B prompt, no Jev raw text, scores, opinion, diagnostics,
    // other strategy answers or Oracle labels/results appended to the review.
    await llm(); return freeze(result);
  } catch (error) {
    result.decision = 'error'; result.selectedCandidateId = null;
    result.failureCode = error instanceof StudyFailure ? error.code : signal.aborted ? signal.reason instanceof Error && signal.reason.name === 'TimeoutError' ? 'timeout' : 'cancelled' : error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'transport';
    result.reason = error instanceof StudyFailure ? error.message : 'Injected study callback or request processing failed; no implicit retry or fallback';
    return freeze(result);
  }
}
