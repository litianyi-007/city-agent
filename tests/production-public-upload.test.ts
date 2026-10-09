import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { publicationApiRequest, publicationBlobTimeoutMs, publicationGitBlobSha, uploadPublicationBlobs, type PublicationBlobUpload } from '../scripts/publish-production.js';
import type { GitTreeEntry } from '../scripts/production-public-safety.js';

test('Git blob identity matches readonly git for empty, Unicode and binary raw bytes', () => {
  for (const content of [Buffer.alloc(0), Buffer.from('滨江区\n🎄\0'), Buffer.from([0, 255, 1, 128, 13, 10])]) {
    const actual = execFileSync('git', ['hash-object', '--stdin'], { cwd: new URL('..', import.meta.url), input: content, encoding: 'utf8' }).trim();
    assert.equal(publicationGitBlobSha(content), actual);
  }
  assert.equal(publicationGitBlobSha(Buffer.alloc(0)), 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
});

test('blob upload deadlines depend on bounded bytes and never exceed 180 seconds', () => {
  for (const [bytes, timeout] of [[0, 60000], [1_000_000, 60000], [1_000_001, 120000], [10_000_000, 120000], [10_000_001, 180000], [20_310_895, 180000], [30_000_000, 180000]]) assert.equal(publicationBlobTimeoutMs(bytes), timeout);
  for (const bytes of [-1, 1.5, NaN, Infinity, 30_000_001, Number.MAX_SAFE_INTEGER]) assert.throws(() => publicationBlobTimeoutMs(bytes), /invalid/);
  assert.throws(() => publicationGitBlobSha(Buffer.alloc(30_000_001)), /byte bound/);
  assert.throws(() => publicationGitBlobSha('not raw bytes' as unknown as Buffer), /byte bound/);
});

test('only prior-tree blob identities are reused; duplicated reviewed content is uploaded once', async () => {
  const inherited = Buffer.from('unchanged inherited public video'), fresh = Buffer.from('new reviewed HTML source');
  const inheritedSha = publicationGitBlobSha(inherited), freshSha = publicationGitBlobSha(fresh);
  const prior: GitTreeEntry[] = [{ path: 'reviews/old/video.mp4', type: 'blob', mode: '100644', sha: inheritedSha }, { path: 'not-a-blob', type: 'tree', mode: '040000', sha: freshSha }];
  const requests: PublicationBlobUpload[] = [];
  const files = new Map([['new/video.mp4', inherited], ['new/index.html', fresh], ['entry.html', Buffer.from(fresh)], ['duplicate/video.mp4', Buffer.from(inherited)]]);
  const result = await uploadPublicationBlobs(files, prior, async request => { requests.push(request); return { sha: request.expectedSha }; });
  assert.equal(requests.length, 1); assert.deepEqual(requests[0].content, fresh); assert.equal(requests[0].expectedSha, freshSha); assert.equal(requests[0].timeoutMs, 60000);
  assert.deepEqual(result.shas, new Map([['new/video.mp4', inheritedSha], ['duplicate/video.mp4', inheritedSha], ['new/index.html', freshSha], ['entry.html', freshSha]]));
  assert.equal(result.uploadedBlobs, 1); assert.equal(result.reusedBlobs, 1); assert.equal(result.reusedFiles, 2); assert.equal(result.distinctBlobs, 2); assert.equal(result.deduplicatedFiles, 2);
  const noPost = await uploadPublicationBlobs(new Map([['new/video', inherited]]), prior, async () => { throw new Error('reused blob must not POST'); });
  assert.equal(noPost.uploadedBlobs, 0); assert.equal(noPost.reusedFiles, 1);
});

test('all inventory and SHA/size checks run before uploads, without relaxing count or total-byte bounds', async () => {
  let calls = 0; const upload = async (item: PublicationBlobUpload) => { calls++; return { sha: item.expectedSha }; };
  await assert.rejects(uploadPublicationBlobs(new Map([['a', Buffer.from('a')]]), [{ path: 'old', type: 'blob', mode: '100644', sha: 'invalid' }], upload), /Prior production blob SHA/);
  await assert.rejects(uploadPublicationBlobs(new Map(Array.from({ length: 132 }, (_, i) => [String(i), Buffer.alloc(0)])), [], upload), /inventory/);
  await assert.rejects(uploadPublicationBlobs(new Map([['a', Buffer.alloc(30_000_001)]]), [], upload), /byte bound/);
  const large = Buffer.alloc(25_000_001);
  await assert.rejects(uploadPublicationBlobs(new Map([['a', large], ['b', large], ['c', large], ['d', large]]), [], upload), /total bound/);
  await assert.rejects(uploadPublicationBlobs(new Map(), Array.from({ length: 5001 }, () => ({ path: 'tree', type: 'tree', mode: '040000', sha: 'a'.repeat(40) })), upload), /inventory/);
  assert.equal(calls, 0);
});

test('new content must receive its exact Git SHA and a rejected upload is never retried', async () => {
  let requests = 0;
  await assert.rejects(uploadPublicationBlobs(new Map([['a', Buffer.from('a')]]), [], async () => { requests++; return { sha: '0'.repeat(40) }; }), /SHA differs/);
  assert.equal(requests, 1);
  requests = 0;
  await assert.rejects(uploadPublicationBlobs(new Map([['a', Buffer.from('a')]]), [], async () => { requests++; throw new Error('test-owned upload refusal'); }), /test-owned upload refusal/);
  assert.equal(requests, 1);
});

test('upload workers never exceed three concurrent unique blobs', async () => {
  let active = 0, maximum = 0, count = 0;
  const files = new Map(Array.from({ length: 8 }, (_, i) => ['file-' + i, Buffer.from('unique-' + i)]));
  const result = await uploadPublicationBlobs(files, [], async ({ expectedSha }) => {
    active++; maximum = Math.max(maximum, active); count++;
    await new Promise(resolve => setTimeout(resolve, 5)); active--; return { sha: expectedSha };
  });
  assert.equal(maximum, 3); assert.equal(active, 0); assert.equal(count, 8); assert.equal(result.shas.size, 8);
});

test('first failure stops new dispatch, waits for the other bounded requests, and returns no partial success', async () => {
  const files = new Map(Array.from({ length: 8 }, (_, i) => ['file-' + i, Buffer.from('unique-' + i)]));
  const pending: Array<{ item: PublicationBlobUpload; resolve: (value: { sha: string }) => void; reject: (reason: Error) => void }> = [];
  let settled = false;
  const running = uploadPublicationBlobs(files, [], item => new Promise((resolve, reject) => pending.push({ item, resolve, reject })));
  const outcome = running.then(() => { settled = true; return 'unexpected success'; }, error => { settled = true; return error; });
  assert.equal(pending.length, 3);
  pending[0].reject(new Error('first bounded upload failed'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 3); assert.equal(settled, false);
  pending[1].resolve({ sha: pending[1].item.expectedSha }); pending[2].resolve({ sha: pending[2].item.expectedSha });
  const error = await outcome; assert.ok(error instanceof Error); assert.match(error.message, /first bounded upload failed/);
  assert.equal(pending.length, 3); assert.equal(settled, true);
});

test('publisher retains complete source proof, guarded targets and non-forced ref ordering around uploads', () => {
  const source = readFileSync(new URL('../scripts/publish-production.ts', import.meta.url), 'utf8');
  const proof = source.indexOf('assertReviewedPublicationSnapshot(manifest, bytes, commit, selectedHtml.files);');
  const upload = source.indexOf('const uploads = await uploadPublicationBlobs(bytes, priorProductionTree.tree,');
  const tree = source.indexOf("const tree = await gh<{ sha: string }>('git/trees', 'POST'");
  const preservation = source.indexOf('assertProductionHistoryPreserved(priorProductionTree.tree, nextProductionTree.tree);');
  const ref = source.indexOf("await gh('git/refs/heads/gh-pages', 'PATCH', { sha: deployment.sha, force: false });");
  assert.ok(proof >= 0 && proof < upload && upload < tree && tree < preservation && preservation < ref);
  assert.ok(source.includes("method = 'GET', body?: unknown, timeoutMs = 60000"));
  assert.ok(source.includes('if (!execute) return'));
  assert.ok(source.includes('if (total > 100_000_000)'));
  assert.ok(source.includes("publishPath(name, commit)"));
  assert.ok(source.includes('pack.files.length > 120'));
});

test('stdin errors stop only the owned API child and reject only after its close callback', async t => {
  const stdin = new EventEmitter() as EventEmitter & { end: (body?: string) => void };
  let close: (error: Error | null, stdout: string, stderr: string) => void = () => { throw new Error('missing callback'); };
  let killed = 0, body: string | undefined, settled = false;
  stdin.end = value => { body = value; };
  t.mock.method(childProcess, 'execFile', ((command: string, args: string[], options: Record<string, unknown>, callback: typeof close) => {
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', 'repos/litianyi-007/city-agent/git/blobs', '--method', 'POST', '--input', '-']);
    assert.equal(options.timeout, 180000); assert.equal(options.cwd, '/test-owned-root');
    close = callback; return { stdin, kill: () => { killed++; return true; } };
  }) as unknown as typeof childProcess.execFile);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const pending = publicationApiRequest('/test-owned-root', 'git/blobs', 'POST', { content: 'synthetic-public-content' }, 180000);
  const outcome = pending.then(() => { settled = true; return null; }, error => { settled = true; return error; });
  assert.equal(body, '{"content":"synthetic-public-content"}');
  stdin.emit('error', new Error('synthetic stdin error body must not leak'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(killed, 1); assert.equal(settled, false);
  close(null, '{"sha":"synthetic-output-must-not-pass"}', 'synthetic-private-stderr-must-not-leak');
  const error = await outcome;
  assert.ok(error instanceof Error); assert.match(error.message, /^GitHub API refused: POST git\/blobs;/);
  assert.doesNotMatch(error.message, /synthetic|private|content/); assert.equal(settled, true);
});

test('non-blob API requests cannot extend deadlines and malformed stdout is never echoed', async t => {
  let calls = 0;
  t.mock.method(childProcess, 'execFile', ((_command: string, _args: string[], _options: Record<string, unknown>, callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    calls++; queueMicrotask(() => callback(null, 'synthetic-private-invalid-json', 'synthetic-private-stderr'));
    return { stdin: { on() { return this; }, end() {} }, kill() { return true; } };
  }) as unknown as typeof childProcess.execFile);
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  for (const [endpoint, method, timeout] of [['git/trees', 'POST', 180000], ['git/blobs', 'GET', 180000], ['git/blobs', 'POST', 180001]] as const) {
    await assert.rejects(publicationApiRequest('/test-owned-root', endpoint, method, undefined, timeout), /Only bounded blob/);
  }
  assert.equal(calls, 0);
  await assert.rejects(publicationApiRequest('/test-owned-root', 'git/trees'), error => error instanceof Error && error.message === 'GitHub API returned invalid JSON: GET git/trees');
  assert.equal(calls, 1);
});
