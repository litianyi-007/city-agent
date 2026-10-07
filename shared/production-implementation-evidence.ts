import { z } from 'zod';

/** Opt-in provenance/coverage checks, NOT a semantic proof or executed Gate. */
export const IMPLEMENTATION_EVIDENCE_VERSION = 'production-implementation-evidence-v1' as const;
export const IMPLEMENTATION_EVIDENCE_VERIFIER_PROFILE = 'implementation-evidence-verifier-v1' as const;
export const IMPLEMENTATION_EVIDENCE_MAX_BYTES = 16000;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const clauseId = z.enum(['original-brief', 'original-acceptance', ...Array.from({ length: 12 }, (_, index) => `product-acceptance-${index + 1}`)] as [string, ...string[]]);
export const implementationEvidenceSchema = z.object({
  version: z.literal(IMPLEMENTATION_EVIDENCE_VERSION), contractSha256: sha,
  candidates: z.array(z.object({
    candidateId: id, candidateValueSha256: sha,
    clauses: z.array(z.object({
      clauseId, status: z.enum(['supported', 'missing', 'contradicted']),
      implementationRefs: z.array(z.object({ pointer: z.literal('/html'), exactAnchor: z.string().min(8).max(160) }).strict()).max(2),
      boundaryRefs: z.array(z.object({ checkIndex: z.number().int().min(0).max(11), stepIndex: z.number().int().min(0).max(19) }).strict()).max(3),
    }).strict()).min(3).max(14),
  }).strict()).min(1).max(2),
}).strict();
export type ImplementationEvidence = z.infer<typeof implementationEvidenceSchema>;
export interface ImplementationEvidenceDiagnostic { version: typeof IMPLEMENTATION_EVIDENCE_VERSION; code: ImplementationEvidenceErrorCode; }
const messages = {
  'evidence-input-invalid': 'Implementation evidence source input is invalid.',
  'evidence-contract-mismatch': 'Implementation evidence contract does not match the current frozen source.',
  'evidence-response-structure': 'Implementation evidence response violates its strict bounded schema.',
  'evidence-candidate-coverage': 'Implementation evidence must cover every current candidate exactly once.',
  'evidence-candidate-binding': 'Implementation evidence candidate bytes do not match their current binding.',
  'evidence-clause-coverage': 'Implementation evidence must cover every required source clause exactly once.',
  'evidence-anchor-mismatch': 'Implementation evidence source anchor is absent, ambiguous or invalid.',
  'evidence-boundary-mismatch': 'Implementation evidence boundary reference is not a frozen business assertion.',
  'evidence-required-missing': 'Supported implementation evidence requires both source and boundary references.',
  'evidence-score-conflict': 'Missing or contradicted required implementation evidence cannot qualify at score 3 or above.',
} as const;
export type ImplementationEvidenceErrorCode = keyof typeof messages;
export class ImplementationEvidenceError extends Error {
  readonly diagnostic: ImplementationEvidenceDiagnostic;
  constructor(code: ImplementationEvidenceErrorCode) {
    super(messages[code]); this.name = 'ImplementationEvidenceError';
    this.diagnostic = Object.freeze({ version: IMPLEMENTATION_EVIDENCE_VERSION, code });
  }
  toJSON() { return { name: this.name, message: this.message, diagnostic: this.diagnostic }; }
}
export const IMPLEMENTATION_EVIDENCE_PROTOCOL_LITERALS = [IMPLEMENTATION_EVIDENCE_VERSION, IMPLEMENTATION_EVIDENCE_VERIFIER_PROFILE, 'implementationEvidencePolicy', 'implementationEvidenceVersion', 'implementationEvidenceContract', 'implementationEvidenceDiagnostic', 'implementationEvidenceVerifierProfile', 'implementationEvidenceBoundary', 'implementationEvidence', 'contractSha256', 'candidateValueSha256', 'implementationRefs', 'ImplementationEvidenceError', 'original-acceptance', 'requirement.acceptance', 'product.acceptance', ...Array.from({ length: 12 }, (_, index) => `product-acceptance-${index + 1}`), ...Object.keys(messages)] as const;
function fail(code: ImplementationEvidenceErrorCode): never { throw new ImplementationEvidenceError(code); }
export function assertImplementationEvidencePolicy(input: { implementationEvidencePolicy?: string; mode: string; capability?: string; verifierEngine: string }): void {
  const policy = input.implementationEvidencePolicy ?? 'legacy';
  if (policy !== 'legacy' && (policy !== 'source-bound-v1' || input.mode !== 'live' || (input.capability ?? 'offline-single-html') !== 'offline-single-html' || input.verifierEngine !== 'llm-rubric')) fail('evidence-input-invalid');
}
export interface ImplementationEvidenceInput {
  brief: string; acceptance: string; productAcceptance: string[]; frozenHash: string;
  checks: Array<{ name: string; steps: Array<Record<string, unknown>> }>;
  candidates: Array<{ id: string; value: { html: string } }>;
}
const selector = z.string().min(1).max(200); const gateValue = z.string().max(5000);
const click = z.object({ action: z.literal('click'), selector }).strict();
const fill = z.object({ action: z.literal('fill'), selector, value: gateValue }).strict();
// Mirror only the current frozen declarative syntax, never execute it here.
// Strict bounded scalar fields also prevent cycles/deep arbitrary JSON from
// reaching hashing through a permissive unknown-valued source step.
const frozenStepSchema = z.discriminatedUnion('action', [click, fill,
  z.object({ action: z.literal('assertText'), selector, text: z.string().min(1).max(5000) }).strict(),
  z.object({ action: z.literal('assertTextExact'), selector, text: gateValue }).strict(),
  z.object({ action: z.literal('assertCount'), selector, count: z.number().int().min(0).max(500) }).strict(),
  z.object({ action: z.literal('assertVisible'), selector }).strict(),
  z.object({ action: z.literal('assertValue'), selector, value: gateValue }).strict(),
  z.object({ action: z.literal('assertChanged'), selector, after: z.discriminatedUnion('action', [fill, click.extend({ value: gateValue.optional() })]) }).strict(),
]);
const inputSchema = z.object({
  brief: z.string().min(3).max(6000), acceptance: z.string().min(1).max(3000), productAcceptance: z.array(z.string().min(1).max(1000)).min(1).max(12), frozenHash: sha,
  checks: z.array(z.object({ name: z.string().min(1).max(120), steps: z.array(frozenStepSchema).min(1).max(20) }).strict()).min(2).max(12),
  candidates: z.array(z.object({ id, value: z.object({ html: z.string().min(30).max(500000) }).strict() }).strict()).min(1).max(2),
}).strict();
export interface ImplementationEvidenceContract {
  version: typeof IMPLEMENTATION_EVIDENCE_VERSION; policy: 'source-bound-v1'; sourceSha256: string; frozenHash: string; checksSha256: string;
  clauses: Array<{ id: string; source: 'brief' | 'requirement.acceptance' | 'product.acceptance'; index: number | null; sha256: string }>;
  candidates: Array<{ candidateId: string; candidateValueSha256: string }>;
  contractSha256: string;
}
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
async function digest(value: unknown): Promise<string> {
  // Web Crypto only: no Node/filesystem import, provider, key or mutable cache.
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes(value));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
function sourceInput(value: ImplementationEvidenceInput): ImplementationEvidenceInput {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success || bytes(parsed.data).length > 6_000_000 || new Set(parsed.data.candidates.map(candidate => candidate.id)).size !== parsed.data.candidates.length) fail('evidence-input-invalid');
  return parsed.data;
}
/** Source units deliberately include BOTH original texts and product clauses.
 * They do not certify that the product's decomposition is semantically complete.
 * Full original text stays in the review; this manifest never summarizes it. */
export async function buildImplementationEvidenceContract(value: ImplementationEvidenceInput): Promise<ImplementationEvidenceContract> {
  const input = sourceInput(value);
  const clauses: ImplementationEvidenceContract['clauses'] = [
    { id: 'original-brief', source: 'brief', index: null, sha256: await digest(input.brief) },
    { id: 'original-acceptance', source: 'requirement.acceptance', index: null, sha256: await digest(input.acceptance) },
    ...await Promise.all(input.productAcceptance.map(async (text, index) => ({ id: `product-acceptance-${index + 1}`, source: 'product.acceptance' as const, index, sha256: await digest(text) }))),
  ];
  const payload = { version: IMPLEMENTATION_EVIDENCE_VERSION, policy: 'source-bound-v1' as const,
    sourceSha256: await digest({ brief: input.brief, acceptance: input.acceptance, productAcceptance: input.productAcceptance }), frozenHash: input.frozenHash,
    checksSha256: await digest(input.checks), clauses,
    candidates: await Promise.all(input.candidates.map(async candidate => ({ candidateId: candidate.id, candidateValueSha256: await digest(candidate.value) }))),
  };
  return freeze({ ...payload, contractSha256: await digest(payload) });
}
/** Mechanical assertion eligibility only. Selector identity and business
 * relevance remain independent semantic review/Gate responsibilities. */
export function isImplementationBusinessAssertion(check: ImplementationEvidenceInput['checks'][number], stepIndex: number): boolean {
  const step = check.steps[stepIndex]; if (!step || typeof step.selector !== 'string') return false;
  const filled = new Set(check.steps.slice(0, stepIndex).filter(previous => previous.action === 'fill').map(previous => previous.selector));
  if (step.action === 'assertChanged') {
    const after = step.after as Record<string, unknown> | undefined;
    return !!after && after.action === 'click' && typeof after.selector === 'string' && step.selector !== after.selector && !filled.has(step.selector);
  }
  return ['assertTextExact', 'assertCount'].includes(String(step.action)) && !filled.has(step.selector)
    && check.steps.slice(0, stepIndex).some(previous => previous.action === 'fill' || previous.action === 'click');
}
export async function validateImplementationEvidence(value: unknown, contract: ImplementationEvidenceContract, source: ImplementationEvidenceInput): Promise<ImplementationEvidence> {
  const input = sourceInput(source); const current = await buildImplementationEvidenceContract(input);
  if (JSON.stringify(current) !== JSON.stringify(contract)) fail('evidence-contract-mismatch');
  const parsed = implementationEvidenceSchema.safeParse(value);
  if (!parsed.success || bytes(parsed.data).length > IMPLEMENTATION_EVIDENCE_MAX_BYTES) fail('evidence-response-structure');
  const evidence = parsed.data;
  if (evidence.contractSha256 !== current.contractSha256) fail('evidence-contract-mismatch');
  const expectedIds = current.candidates.map(candidate => candidate.candidateId);
  if (evidence.candidates.length !== expectedIds.length || new Set(evidence.candidates.map(candidate => candidate.candidateId)).size !== expectedIds.length || evidence.candidates.some(candidate => !expectedIds.includes(candidate.candidateId))) fail('evidence-candidate-coverage');
  const clauseIds = current.clauses.map(clause => clause.id);
  for (const candidate of evidence.candidates) {
    const binding = current.candidates.find(item => item.candidateId === candidate.candidateId)!;
    if (candidate.candidateValueSha256 !== binding.candidateValueSha256) fail('evidence-candidate-binding');
    if (candidate.clauses.length !== clauseIds.length || new Set(candidate.clauses.map(clause => clause.clauseId)).size !== clauseIds.length || candidate.clauses.some(clause => !clauseIds.includes(clause.clauseId))) fail('evidence-clause-coverage');
    const html = input.candidates.find(item => item.id === candidate.candidateId)!.value.html;
    for (const clause of candidate.clauses) {
      if (clause.status === 'supported' && (!clause.implementationRefs.length || !clause.boundaryRefs.length)) fail('evidence-required-missing');
      const anchors = new Set<string>(); const boundaries = new Set<string>();
      for (const ref of clause.implementationRefs) {
        const position = html.indexOf(ref.exactAnchor);
        if (!ref.exactAnchor.trim() || position < 0 || html.indexOf(ref.exactAnchor, position + 1) >= 0 || anchors.has(ref.exactAnchor)) fail('evidence-anchor-mismatch');
        anchors.add(ref.exactAnchor);
      }
      for (const ref of clause.boundaryRefs) {
        const key = `${ref.checkIndex}:${ref.stepIndex}`; const check = input.checks[ref.checkIndex];
        if (!check || !isImplementationBusinessAssertion(check, ref.stepIndex) || boundaries.has(key)) fail('evidence-boundary-mismatch');
        boundaries.add(key);
      }
    }
  }
  return freeze(evidence);
}
export function assertImplementationEvidenceScores(evidence: ImplementationEvidence, scores: Array<{ candidateId: string; score: number }>): void {
  for (const candidate of evidence.candidates) {
    if (candidate.clauses.some(clause => clause.status !== 'supported') && (scores.find(score => score.candidateId === candidate.candidateId)?.score ?? 0) >= 3) fail('evidence-score-conflict');
  }
}
