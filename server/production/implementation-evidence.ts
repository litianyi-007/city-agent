import { ImplementationEvidenceError, assertImplementationEvidenceScores, validateImplementationEvidence, type ImplementationEvidenceContract, type ImplementationEvidenceInput } from '../../shared/production-implementation-evidence.js';
import { implementationEvidenceVerifierSchema, parseJson, parseVerifiedDecision } from './contracts.js';
import { parseVerifierDecisionText, VerifierDecisionError } from './verifier-diagnostics.js';

/** Reuse the unchanged legacy scanner as the bounded syntax/duplicate-key
 * gate. Its expected extra-field Zod refusal is the ONLY error ignored here;
 * the new exact schema then checks the complete original object. No text
 * rewriting, JSON repair, provider error/cause or extra evaluator invocation. */
export async function parseImplementationEvidenceDecisionText(raw: unknown, contract: ImplementationEvidenceContract, source: ImplementationEvidenceInput) {
  const ids = source.candidates.map(candidate => candidate.id);
  try { parseVerifierDecisionText(raw, ids); }
  catch (error) {
    if (!(error instanceof VerifierDecisionError) || error.diagnostic.category !== 'zod-structure') throw error;
  }
  const parsed = implementationEvidenceVerifierSchema.safeParse(parseJson(raw as string));
  if (!parsed.success) throw new ImplementationEvidenceError('evidence-response-structure');
  const { implementationEvidence, ...base } = parsed.data;
  const decision = parseVerifiedDecision(base, ids);
  const evidence = await validateImplementationEvidence(implementationEvidence, contract, source);
  assertImplementationEvidenceScores(evidence, decision.scores);
  return { ...decision, implementationEvidence: evidence };
}
