import { createHash } from 'node:crypto';
import { VERIFIER_CHALLENGE_CORPUS_VERSION, VERIFIER_CHALLENGE_HTML_POOLS, VERIFIER_CHALLENGE_SCENE_POOLS, VERIFIER_CHALLENGE_IDS, verifierChallengeReviewSnapshot, type VerifierChallengePoolId } from '../../shared/production-verifier-challenge-corpus.js';
import { productionPhaseRubric, phaseVerifierSystemPrompt, VERIFIER_COMPACT_OUTPUT_POLICY } from '../../shared/production-verifier-rubric.js';
import { PRODUCTION_PLANNING_LOOP_VERSION, PRODUCTION_REPAIR_POLICY_VERSION } from '../../shared/production-schema.js';
import { HTML_EXECUTION_PROFILE_VERSION } from '../../shared/production-execution-profile.js';
import { CAMERA_TEST_SEMANTICS_VERSION } from '../../shared/camera-test-semantics.js';
import { HARNESS_JSON_OUTPUT_VERSION, HARNESS_PROMPT_TRANSPORT_VERSION } from '../harness.js';
import { buildJevCandidateRequest, JEV_REQUEST_LAYOUT_VERSION } from './jev.js';
import { ACCEPTANCE_SEMANTICS_VERSION } from './acceptance-preflight.js';
import { REVIEW_CONTEXT_PROJECTION_VERSION } from './review-context.js';
import { OUTPUT_DIAGNOSTICS_VERSION } from './output-diagnostics.js';
import { VERIFIER_DECISION_DIAGNOSTICS_VERSION } from './verifier-diagnostics.js';
import { contractProfile, CRITERIA_VERSION, outputContractSnapshot, verifierSchema } from './contracts.js';
import { cameraRuntimeMetadata } from './camera-gate.js';

const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const bytes = (value: unknown) => Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');

/** Pure request assembly apart from reading the tracked trusted Gate source hash.
 * No keys/store/network/provider selection. This is not the funded study runner.
 */
export function verifierPreparationRequests(poolId: VerifierChallengePoolId) {
  const pool = [...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_CHALLENGE_SCENE_POOLS].find(item => item.id === poolId);
  if (!pool) throw new Error('Unknown preparation pool');
  const camera = 'required' in pool; const capability = camera ? 'camera-scene-v1' : 'offline-single-html';
  const frozenPayload = { version: VERIFIER_CHALLENGE_CORPUS_VERSION, goal: pool.goal, acceptance: pool.acceptance, checks: pool.checks, ...(camera ? { requirements: pool.required } : {}) };
  const frozenHash = hash(frozenPayload);
  const snapshot = verifierChallengeReviewSnapshot(poolId, { version: contractProfile(capability).acceptanceVersion, hash: frozenHash });
  const rubric = productionPhaseRubric('implement', capability)!;
  const runtime = camera ? cameraRuntimeMetadata() : undefined;
  const validationContract = { planningLoopVersion: PRODUCTION_PLANNING_LOOP_VERSION, reviewContextVersion: REVIEW_CONTEXT_PROJECTION_VERSION, verifierDiagnosticsVersion: VERIFIER_DECISION_DIAGNOSTICS_VERSION, ...(!camera ? { htmlExecutionProfileVersion: HTML_EXECUTION_PROFILE_VERSION, outputDiagnosticsVersion: OUTPUT_DIAGNOSTICS_VERSION } : {}), harnessPromptTransportVersion: HARNESS_PROMPT_TRANSPORT_VERSION, harnessJsonOutputVersion: HARNESS_JSON_OUTPUT_VERSION, responseFormatPolicy: 'deepseek-json-object-other-prompt-only', semanticsVersion: ACCEPTANCE_SEMANTICS_VERSION, jevRequestLayoutVersion: JEV_REQUEST_LAYOUT_VERSION, ...(camera ? { cameraTestSemanticsVersion: CAMERA_TEST_SEMANTICS_VERSION } : {}), coverage: snapshot.reviewContext.coverageContract };
  const criteria = { version: CRITERIA_VERSION, validationContract, compactOutputPolicy: VERIFIER_COMPACT_OUTPUT_POLICY, repairPolicyVersion: PRODUCTION_REPAIR_POLICY_VERSION, phase: 'implement', phaseReview: rubric, acceptance: snapshot.acceptance, goal: snapshot.goal, frozenHash, dimensions: rubric.dimensions, minimumOrdinalScore: 3, scale: '0..5 ordinal, not calibrated probability', candidateIds: snapshot.candidates.map(candidate => candidate.id), ...(camera ? { capability, cameraRuntime: runtime, evidenceBoundary: 'Synthetic scene behavior only; physical camera and actual vision remain unverified. Retain full user requirement without claiming complete hardware delivery.' } : {}) };
  const systemPrompt = phaseVerifierSystemPrompt(rubric);
  const userPrompt = JSON.stringify({ criteria, state: { reviewContext: snapshot.reviewContext }, candidates: snapshot.candidates, outputContract: outputContractSnapshot(verifierSchema) });
  const jev = buildJevCandidateRequest('jev-1.13.0', snapshot);
  const jevStateBytes = bytes(jev.state); const questionBytes = Math.max(...Object.values(jev.questions).map(question => bytes(question)));
  return { snapshot, logicalLlm: { systemPrompt, userPrompt }, jev, metadata: {
    poolId, capability, frozenHash, checksSha256: hash(pool.checks), requirementsSha256: camera ? hash(pool.required) : null,
    candidates: pool.candidates.map(candidate => ({ id: candidate.id, candidateValueJsonSha256: hash(candidate.value), candidateValueJsonBytes: bytes(candidate.value), sourceSerialization: 'JSON.stringify(value)', ...('html' in candidate.value ? { htmlUtf8Sha256: hash(candidate.value.html), htmlUtf8Bytes: bytes(candidate.value.html) } : { sceneJsonSha256: hash(candidate.value.scene), sceneJsonBytes: bytes(candidate.value.scene) }) })),
    promptVersion: contractProfile(capability).promptVersion, acceptanceVersion: contractProfile(capability).acceptanceVersion,
    validationContract, validationContractSha256: hash(validationContract), rubricVersion: rubric.version,
    logicalLlmPromptBytes: bytes(`${systemPrompt}\n${userPrompt}`), logicalLlmPromptSha256: hash({ systemPrompt, userPrompt }),
    jevStateBytes, jevMaxQuestionBytes: questionBytes, jevPerQuestionBytes: jevStateBytes + questionBytes, jevTotalBytes: bytes(jev), jevRequestSha256: hash(jev),
    requestEvidence: 'offline-serialized-never-dispatched' as const,
    llmTransportBoundary: 'logical system/user only; final provider/model parameters and full wire request are not frozen or measured' as const,
  } };
}

export function verifierPreparationManifest() {
  const pools = VERIFIER_CHALLENGE_IDS.map(id => verifierPreparationRequests(id).metadata);
  const valid = pools.every(pool => pool.jevPerQuestionBytes <= 32000 && pool.jevTotalBytes <= 64000 && pool.logicalLlmPromptBytes <= 60000);
  return {
    version: VERIFIER_CHALLENGE_CORPUS_VERSION, evidenceKind: 'outer-authored-challenge-preparation' as const,
    status: 'corpus-only-not-a-funded-frozen-model-study' as const,
    ordering: 'preparation-source-order-not-final-randomization' as const,
    poolCount: pools.length, candidateCount: pools.reduce((sum, pool) => sum + pool.candidates.length, 0),
    modelRequests: 0, actualModelEffect: null, actualModelUsage: null, actualModelCost: null,
    bytePreflight: { valid, limits: { jevPerQuestion: 32000, jevTotal: 64000, logicalLlm: 60000 }, maxJevPerQuestion: Math.max(...pools.map(pool => pool.jevPerQuestionBytes)), maxJevTotal: Math.max(...pools.map(pool => pool.jevTotalBytes)), maxLogicalLlm: Math.max(...pools.map(pool => pool.logicalLlmPromptBytes)) },
    pools,
  };
}

export interface VerifierPreparationIntent { poolId: string; candidateId: string; status: 'started' | 'completed' | 'failed' | 'cancelled'; }
/** Started-but-failed/cancelled candidates remain attempted, never not-started. */
export function verifierPreparationProgress(scheduled: { poolId: string; candidateId: string }[], intents: VerifierPreparationIntent[]) {
  const key = (item: { poolId: string; candidateId: string }) => JSON.stringify([item.poolId, item.candidateId]);
  const scheduledKeys = new Set(scheduled.map(key)); const intentKeys = new Set(intents.map(key));
  if (scheduledKeys.size !== scheduled.length || intentKeys.size !== intents.length || intents.some(intent => !scheduledKeys.has(key(intent)))) throw new Error('Invalid preparation intent identity');
  return { scheduled: scheduled.length, attempted: intents.length, completed: intents.filter(intent => intent.status === 'completed').length,
    failed: intents.filter(intent => intent.status === 'failed').length, cancelled: intents.filter(intent => intent.status === 'cancelled').length, inProgress: intents.filter(intent => intent.status === 'started').length,
    notStarted: scheduled.filter(item => !intentKeys.has(key(item))) };
}
