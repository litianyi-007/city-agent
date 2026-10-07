import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

// URL imports exercise the plain-Node entry points without needing tsx to
// diagnose an unsupported Node version before startup.
const doctor = await import(new URL('../scripts/doctor.mjs', import.meta.url).href);
const launcher = await import(new URL('../scripts/launch-review.mjs', import.meta.url).href);

test('doctor Node minimum is 22.19.0, independently of the current shell', () => {
  for (const version of ['20.15.0', '22.18.0', '22.9.9', 'not-a-version']) assert.equal(doctor.checkNodeVersion(version).status, 'fail');
  for (const version of ['22.19.0', '22.22.3', '24.0.0', 'v22.19.1']) assert.equal(doctor.checkNodeVersion(version).status, 'pass');
});

test('review configuration is isolated and validates explicit ports/directories', () => {
  const root = path.resolve(tmpdir(), 'review-config-fixture');
  const defaults = doctor.parseReviewConfiguration({}, [], root);
  assert.equal(defaults.port, 4320);
  assert.equal(defaults.dataDir, path.join(root, '.city-agent-review'));
  const env = { PORT: '4330', CITY_AGENT_DATA_DIR: '.city-agent-one', PRIVATE_TEST_KEY: 'never-in-output' };
  assert.equal(doctor.parseReviewConfiguration(env, ['--port', '4332', '--data-dir', '.city-agent-two', '--json'], root).port, 4332);
  assert.equal(env.PORT, '4330');
  for (const port of ['0', '65536', '-1', '4320.5', '4320abc']) assert.throws(() => doctor.parseReviewConfiguration({ PORT: port }, [], root), /1–65535/);
  assert.throws(() => doctor.parseReviewConfiguration({}, ['--port'], root), /必须有值/);
  assert.throws(() => doctor.parseReviewConfiguration({}, ['--mystery'], root), /未知参数/);
  assert.throws(() => doctor.parseReviewConfiguration({}, ['--data-dir', root], root), /专用子目录/);
});

test('Harness check requires pinned SDK, same resolved runtime and binary', async () => {
  const sdk = { version: doctor.HARNESS_VERSION, dependencies: { '@deepseek-ai/dsh': doctor.HARNESS_VERSION } };
  assert.equal(doctor.checkHarnessManifests(sdk, { version: doctor.HARNESS_VERSION }, true).status, 'pass');
  assert.equal(doctor.checkHarnessManifests(sdk, { version: '0.1.4' }, true).status, 'fail');
  assert.equal(doctor.checkHarnessManifests({ ...sdk, version: '0.1.4' }, { version: doctor.HARNESS_VERSION }, true).status, 'fail');
  assert.equal(doctor.checkHarnessManifests(sdk, { version: doctor.HARNESS_VERSION }, false).status, 'fail');
  assert.equal((await doctor.checkHarnessRuntime(doctor.PROJECT_ROOT)).status, 'pass');
  assert.equal((await doctor.checkHarnessRuntime(path.join(tmpdir(), 'nonexistent-city-agent-package'))).status, 'fail');
});

test('doctor reports missing build; rejects missing and escaping assets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'city-agent-doctor-build-'));
  try {
    assert.equal((await doctor.checkBuiltFrontend(root)).status, 'fail');
    await mkdir(path.join(root, 'dist', 'assets'), { recursive: true });
    await writeFile(path.join(root, 'dist', 'index.html'), '<script src="/assets/app.js"></script>');
    assert.equal((await doctor.checkBuiltFrontend(root)).status, 'fail');
    await writeFile(path.join(root, 'dist', 'assets', 'app.js'), 'console.log("fixture");');
    assert.equal((await doctor.checkBuiltFrontend(root)).status, 'pass');
    await writeFile(path.join(root, 'outside.js'), 'not a valid dist asset');
    await writeFile(path.join(root, 'dist', 'index.html'), '<script src="/assets/../../outside.js"></script>');
    assert.equal((await doctor.checkBuiltFrontend(root)).status, 'fail');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('port probe rejects an occupied port without killing or reusing its owner', async () => {
  const owner = createServer();
  await new Promise<void>(resolve => owner.listen(0, '127.0.0.1', resolve));
  const address = owner.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  try {
    const result = await doctor.probePort(port);
    assert.equal(result.status, 'fail');
    assert.match(result.message, /已被占用/);
    assert.equal(owner.listening, true);
  } finally { await new Promise<void>(resolve => owner.close(() => resolve())); }
  assert.equal((await doctor.probePort(port)).status, 'pass');
});

test('readonly doctor is ready with explicit limits; never creates a directory/database or invokes SQLite', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'city-agent-doctor-ready-'));
  const dataDir = path.join(root, '.city-agent-private-test');
  try {
    await mkdir(path.join(root, 'dist', 'assets'), { recursive: true });
    await writeFile(path.join(root, 'dist', 'index.html'), '<script src="/assets/app.js"></script>');
    await writeFile(path.join(root, 'dist', 'assets', 'app.js'), '// fixture');
    const browser = path.join(root, 'chromium-fixture');
    await writeFile(browser, 'not executed');
    let sqliteConstructed = false;
    const probes = {
      harness: async () => ({ id: 'harness', status: 'pass', message: 'fixture only' }),
      sqlite: async () => ({ DatabaseSync: class { constructor() { sqliteConstructed = true; throw new Error('Do not construct'); } } }),
      chromiumPath: async () => browser,
      port: async () => ({ id: 'port', status: 'pass', message: 'fixture only' }),
    };
    const report = await doctor.runDoctor({ root, dataDir, port: 4330, nodeVersion: '22.22.3', platform: 'linux', probes });
    assert.equal(report.ready, true);
    assert.equal(report.exitCode, 0);
    assert.equal(report.checks.find((item: { id: string }) => item.id === 'platform').status, 'warning');
    assert.equal(sqliteConstructed, false);
    assert.equal(existsSync(dataDir), false);
    assert.equal(await readFile(browser, 'utf8'), 'not executed');
    let sqliteLoaded = false;
    const unsupported = await doctor.runDoctor({ root, dataDir, nodeVersion: '20.15.0', probes: { ...probes, sqlite: async () => { sqliteLoaded = true; throw new Error('Should be skipped'); } } });
    assert.equal(unsupported.exitCode, 1);
    assert.equal(sqliteLoaded, false);
    const missingChromium = await doctor.runDoctor({ root, dataDir, nodeVersion: '22.22.3', probes: { ...probes, chromiumPath: async () => path.join(root, 'missing-browser') } });
    assert.equal(missingChromium.ready, false);
    assert.equal(missingChromium.checks.find((item: { id: string }) => item.id === 'chromium').status, 'fail');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('doctor CLI invalid input returns machine-readable exit 2 without setup', () => {
  const result = spawnSync(process.execPath, [path.join(doctor.PROJECT_ROOT, 'scripts', 'doctor.mjs'), '--json', '--port', '0'], { cwd: doctor.PROJECT_ROOT, encoding: 'utf8' });
  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ready, false);
  assert.equal(report.exitCode, 2);
  assert.match(report.error, /1–65535/);
});

test('review launcher refuses failed doctor without spawning, installation or changing port', async () => {
  let spawned = false;
  const result = await launcher.launchReview({ root: doctor.PROJECT_ROOT, port: 4320, dataDir: path.join(doctor.PROJECT_ROOT, '.city-agent-test') }, {
    doctor: async () => ({ ready: false, exitCode: 1, checks: [] }),
    print: () => undefined,
    spawn: () => { spawned = true; throw new Error('Must not spawn'); },
  });
  assert.equal(result, 1);
  assert.equal(spawned, false);
});

test('launch specification uses exact current Node, no shell, explicit workdir/port/data', () => {
  const options = { root: doctor.PROJECT_ROOT, port: 4330, dataDir: path.join(doctor.PROJECT_ROOT, '.city-agent-review-4330') };
  const spec = launcher.buildLaunchSpec(options, { PATH: 'fixture', PORT: '4310', CITY_AGENT_DATA_DIR: 'old-data' });
  assert.equal(spec.command, process.execPath);
  assert.deepEqual(spec.args, ['--import', 'tsx', path.join(doctor.PROJECT_ROOT, 'server', 'index.ts')]);
  assert.equal(spec.options.cwd, doctor.PROJECT_ROOT);
  assert.equal(spec.options.shell, false);
  assert.equal(spec.options.env.PORT, '4330');
  assert.equal(spec.options.env.CITY_AGENT_DATA_DIR, options.dataDir);
});

test('review launcher returns child status and removes signal handlers', async () => {
  const before = process.listenerCount('SIGINT');
  const child = Object.assign(new EventEmitter(), { killed: false, kill: () => true });
  const result = await launcher.launchReview({ root: doctor.PROJECT_ROOT, port: 4330, dataDir: path.join(doctor.PROJECT_ROOT, '.city-agent-review-4330') }, {
    doctor: async () => ({ ready: true, exitCode: 0, checks: [] }), print: () => undefined,
    spawn: () => { queueMicrotask(() => child.emit('exit', 7, null)); return child; },
  });
  assert.equal(result, 7);
  assert.equal(process.listenerCount('SIGINT'), before);
});
