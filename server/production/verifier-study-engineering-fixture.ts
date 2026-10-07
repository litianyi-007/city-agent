import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { jevConfigSchema, JEV_ENDPOINT } from '../../shared/jev-schema.js';
import { VERIFIER_CHALLENGE_IDS } from '../../shared/production-verifier-challenge-corpus.js';
import { buildJevCandidateRequest } from './jev.js';
import { verifierPreparationRequests } from './verifier-corpus-preparation.js';
import { verifierStudyPublicConfiguration } from './verifier-study-preflight.js';
import { prepareVerifierWirePreflight } from './verifier-wire-preflight.js';
import { createVerifierStudyTransport, type VerifierStudyTransportOptions } from './verifier-study-transport.js';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixtureKeys = Object.freeze({ llmKey: 'synthetic-study-llm-not-a-real-credential', jevKey: 'synthetic-study-jev-not-a-real-credential' });
/** Fixed public dummy settings. This fixture never reads the configured store or
 * credentials. Its synthesized choices/usage are not model-quality evidence. */
export function verifierStudyEngineeringConfiguration() {
  return verifierStudyPublicConfiguration({
    verifier: { id: 'cc18586a-8d6b-4c19-950f-308034a0c0b1', name: 'Engineering verifier fixture', role: 'verifier', enabled: true,
      provider: 'deepseek', baseUrl: 'https://api.deepseek.com', modelId: 'deepseek-flash', hasApiKey: true,
      pricing: { inputPerMillion: 0.3, outputPerMillion: 1.2, currency: 'USD' } },
    jev: { ...jevConfigSchema.parse({ enabled: true }), hasApiKey: true },
  });
}

/** Trusted code-only seam: one ephemeral literal-loopback provider and a Jev
 * in-memory fetch callback. No caller URL, prompt, candidate, key or network
 * option is accepted. The native transport retains full SDK wire validation. */
export async function createVerifierStudyEngineeringFixture(options: { guards: NonNullable<VerifierStudyTransportOptions['guards']> }) {
  if (!options || Object.keys(options).join(',') !== 'guards') throw new Error('Invalid engineering fixture options');
  const configuration = verifierStudyEngineeringConfiguration();
  const requests = VERIFIER_CHALLENGE_IDS.map(id => verifierPreparationRequests(id));
  const expectedBodies = requests.map(request => prepareVerifierWirePreflight(request.logicalLlm, {
    provider: 'deepseek', upstreamBaseUrl: configuration.verifier.baseUrl, modelId: configuration.verifier.modelId,
    maxOutputTokens: 4096, timeoutMs: 120000 }).expectedBody);
  const llmUses = new Map<string, number>(); const jevUses = new Set<string>();
  let loopbackHttpPosts = 0; let inMemoryJevFetchDispatches = 0; let rejectedFixtureRequests = 0; let closed = false;
  const server = createServer(async (request, response) => {
    if (request.method === 'POST') loopbackHttpPosts++;
    try {
      if (closed || request.method !== 'POST' || !request.url?.endsWith('/chat/completions')
        || request.headers.authorization !== `Bearer ${fixtureKeys.llmKey}` || loopbackHttpPosts > 36) throw new Error('Unexpected fixture request');
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const part of request) { bytes += Buffer.byteLength(part); if (bytes > 65536) throw new Error('Oversized fixture request'); chunks.push(Buffer.from(part)); }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')); const identity = hash(body);
      if (!expectedBodies.some(expected => hash(expected) === identity) || (llmUses.get(identity) ?? 0) >= 2) throw new Error('Frozen fixture wire mismatch');
      llmUses.set(identity, (llmUses.get(identity) ?? 0) + 1);
      const candidates = JSON.parse(body.messages[1].content).candidates as Array<{ id: string }>;
      const text = JSON.stringify({ decision: 'accept', selectedCandidateId: candidates[0].id,
        scores: candidates.map(candidate => ({ candidateId: candidate.id, score: 3, reason: 'Synthetic first-choice fixture, not model quality' })), reason: 'Engineering fixture only' });
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] })}\n\n`);
      response.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 101, completion_tokens: 7 } })}\n\n`);
      response.end('data: [DONE]\n\n');
    } catch { rejectedFixtureRequests++; if (!response.headersSent) response.writeHead(400); response.end('{}'); }
  });
  const jevFetch: typeof fetch = async (url, init) => {
    init?.signal?.throwIfAborted(); inMemoryJevFetchDispatches++;
    if (closed || String(url) !== JEV_ENDPOINT || init?.method !== 'POST' || new Headers(init.headers).get('authorization') !== `Bearer ${fixtureKeys.jevKey}`) throw new Error('Unexpected in-memory Jev dispatch');
    const body = JSON.parse(String(init.body)); const identity = hash(body); const request = requests.find(value => hash(value.jev) === identity);
    if (!request || jevUses.has(identity) || inMemoryJevFetchDispatches > 18) throw new Error('Frozen in-memory Jev request mismatch');
    jevUses.add(identity); const envelope = buildJevCandidateRequest(configuration.jev.modelId, request.snapshot); const answers: Record<string, unknown> = {};
    request.snapshot.candidates.forEach((_candidate, index) => {
      for (const dimension of ['coverage', 'consistency', 'scope']) {
        const name = `c${index}_${dimension}`;
        answers[name] = { type: 'score', score: 4, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1 },
          legend: Object.fromEntries((envelope.questions[name].criteria as string[]).map((label, score) => [score, label])) };
      }
      answers[`c${index}_safe`] = { type: 'noul', noul: 1 };
    });
    answers.best = { type: 'choice', choice: 'abstain', confidence: 1,
      probabilities: { ...Object.fromEntries(request.snapshot.candidates.map(candidate => [candidate.id, 0])), abstain: 1 } };
    init.signal?.throwIfAborted();
    return new Response(JSON.stringify({ model: configuration.jev.modelId, answers, usage: { input_tokens: 101, output_tokens: 7 } }));
  };
  const close = async () => { closed = true; server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); };
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); }); });
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Engineering fixture unavailable');
    const transport = createVerifierStudyTransport({ configuration, secrets: fixtureKeys, guards: options.guards,
      engineering: { llmBaseUrl: `http://127.0.0.1:${address.port}`, jevFetch } });
    return { configuration, transport, close, counts: () => ({ externalProviderHttpAttempts: 0 as const,
      loopbackHttpPosts, inMemoryJevFetchDispatches, rejectedFixtureRequests, actualModelUsage: null,
      evidenceBoundary: 'Pinned SDK to loopback fake SSE provider, in-memory Jev JSON, native Chromium Oracles. Synthetic decisions/usage, not real model quality or fee evidence.' }) };
  } catch (error) { await close(); throw error; }
}
