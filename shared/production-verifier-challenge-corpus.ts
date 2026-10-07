import { VERIFIER_HTML_A_CORPUS, VERIFIER_HTML_A_EXPECTATIONS, verifierHtmlAReviewSnapshot, type VerifierHtmlAPoolId } from './production-verifier-html-corpus-a.js';
import { VERIFIER_HTML_B_CORPUS, VERIFIER_HTML_B_EXPECTATIONS, verifierHtmlBReviewSnapshot, type VerifierHtmlBPoolId } from './production-verifier-html-corpus-b.js';
import { VERIFIER_SCENE_CORPUS, VERIFIER_SCENE_EXPECTATIONS, verifierSceneReviewSnapshot, type VerifierScenePoolId } from './production-verifier-scene-corpus.js';

export const VERIFIER_CHALLENGE_CORPUS_VERSION = 'verifier-challenge-preparation-v1' as const;
export type VerifierChallengePoolId = VerifierHtmlAPoolId | VerifierHtmlBPoolId | VerifierScenePoolId;
export const VERIFIER_CHALLENGE_HTML_POOLS = Object.freeze([...VERIFIER_HTML_A_CORPUS, ...VERIFIER_HTML_B_CORPUS]);
export const VERIFIER_CHALLENGE_SCENE_POOLS = VERIFIER_SCENE_CORPUS;
export const VERIFIER_CHALLENGE_IDS = Object.freeze([...VERIFIER_CHALLENGE_HTML_POOLS, ...VERIFIER_SCENE_CORPUS].map(pool => pool.id));
/** Labels/defects are controller-only; no serialized review imports this data. */
export const VERIFIER_CHALLENGE_EXPECTATIONS = Object.freeze([...VERIFIER_HTML_A_EXPECTATIONS, ...VERIFIER_HTML_B_EXPECTATIONS, ...VERIFIER_SCENE_EXPECTATIONS]);

/** Fixed preparation source order, NOT the final study randomization/freeze. */
export function verifierChallengeReviewSnapshot(poolId: VerifierChallengePoolId, frozen: { version: string; hash: string }) {
  if (VERIFIER_HTML_A_CORPUS.some(pool => pool.id === poolId)) return verifierHtmlAReviewSnapshot(poolId as VerifierHtmlAPoolId, frozen);
  if (VERIFIER_HTML_B_CORPUS.some(pool => pool.id === poolId)) return verifierHtmlBReviewSnapshot(poolId as VerifierHtmlBPoolId, frozen);
  if (VERIFIER_SCENE_CORPUS.some(pool => pool.id === poolId)) return verifierSceneReviewSnapshot(poolId as VerifierScenePoolId, frozen);
  throw new Error('Unknown challenge preparation pool');
}
