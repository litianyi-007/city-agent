import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { auditPack, compilePopulation, hashPopulationPack, regionPackSchema, type RegionPack } from '../server/population/model.ts';
import { verifySourceFiles } from '../scripts/population.ts';

const execute = promisify(execFile);
const evidence = 'Synthetic test evidence; these numbers do not describe a real region.\n';

function fixture(): RegionPack {
  const observations = [
    { id: 'region-total', areaCode: 'region', dimension: 'total', value: 100 },
    { id: 'area-total', areaCode: 'a', dimension: 'total', value: 100 },
    { id: 'area-child', areaCode: 'a', dimension: 'age', ageBand: 'child', value: 20 },
    { id: 'area-adult', areaCode: 'a', dimension: 'age', ageBand: 'adult', value: 80 },
    { id: 'area-female', areaCode: 'a', dimension: 'sex', sex: 'female', value: 60 },
    { id: 'area-male', areaCode: 'a', dimension: 'sex', sex: 'male', value: 40 },
  ].map((row) => ({
    ...row, sourceId: 'source', period: '2020-11-01', populationBasis: '常住人口', boundaryVersion: '2020-test', provenance: 'fact',
    locator: { table: 'test-table', row: row.id, column: '人数' },
  }));
  return regionPackSchema.parse({
    schemaVersion: '1.0', id: 'test-region', version: '1',
    region: { code: 'region', name: '测试区域（合成测试夹具）', level: 'custom', boundaryVersion: '2020-test' },
    period: '2020-11-01', populationBasis: '常住人口',
    areas: [{ code: 'a', name: 'A' }],
    ageBands: [{ id: 'child', label: '0–17', minAge: 0, maxAge: 17 }, { id: 'adult', label: '18+', minAge: 18, maxAge: null }],
    sexCategories: [{ id: 'female', label: '女' }, { id: 'male', label: '男' }],
    sources: [{
      id: 'source', title: '合成测试证据', publisher: 'test fixture', url: 'https://example.com/test', landingUrl: 'https://example.com/',
      publishedAt: null, retrievedAt: '2026-09-23', localPath: 'source.txt',
      sha256: createHash('sha256').update(evidence).digest('hex'), bytes: Buffer.byteLength(evidence),
    }],
    observations, limitations: ['此数据包仅用于代码测试'],
    method: { jointStrategy: 'independence', eligibleAgeBandIds: ['adult'], note: '测试用独立性假设' },
  });
}

function addJoint(pack: RegionPack) {
  pack.method.jointStrategy = 'observed';
  const template = pack.observations[1];
  for (const [ageBand, sex, value] of [
    ['child', 'female', 0], ['child', 'male', 20], ['adult', 'female', 60], ['adult', 'male', 20],
  ] as const) {
    pack.observations.push({ ...template, id: `joint-${ageBand}-${sex}`, dimension: 'age_sex', ageBand, sex, value });
  }
}

test('population compiler reconciles all-age margins and keeps survey eligibility separate', () => {
  const pack = fixture();
  const original = structuredClone(pack);
  const compiled = compilePopulation(pack);
  assert.equal(compiled.audit.status, 'ready');
  assert.equal(compiled.population, 100);
  assert.equal(compiled.eligiblePopulation, 80);
  assert.deepEqual(compiled.cells.map((cell) => cell.population), [12, 8, 48, 32]);
  assert.equal(compiled.cells.filter((cell) => cell.eligible).reduce((sum, cell) => sum + cell.population, 0), 80);
  for (const age of pack.ageBands) {
    assert.equal(compiled.cells.filter((cell) => cell.ageBand === age.id).reduce((sum, cell) => sum + cell.population, 0), compiled.ageBands.find((row) => row.id === age.id)!.population);
  }
  for (const sex of pack.sexCategories) {
    assert.equal(compiled.cells.filter((cell) => cell.sex === sex.id).reduce((sum, cell) => sum + cell.population, 0), compiled.areas[0].sexCounts.find((row) => row.id === sex.id)!.population);
  }
  assert.ok(compiled.cells.every((cell) => cell.provenance === 'infer' && cell.evidenceIds.length === 3));
  assert.deepEqual(compiled.cells[0].feasibleRange, { min: 0, max: 20 });
  assert.deepEqual(compiled.cells[2].feasibleRange, { min: 40, max: 60 });
  assert.ok(compiled.audit.limitations.some((note) => note.includes('不是置信区间')));
  assert.ok(compiled.audit.limitations.some((note) => note.includes('不认证发布者')));
  compiled.sources[0].title = 'consumer mutation';
  assert.deepEqual(pack, original);
});

test('mixed statistical periods, resident definitions and boundary vintages block compilation', () => {
  for (const [field, value] of [['period', '2024-12-31'], ['populationBasis', '户籍人口'], ['boundaryVersion', '2024-boundary']] as const) {
    const pack = fixture();
    pack.observations[2][field] = value;
    assert.equal(auditPack(pack).status, 'blocked');
    assert.equal(auditPack(pack).checks.find((check) => check.id === 'same-basis')!.passed, false);
    assert.throws(() => compilePopulation(pack), /不可建模/);
  }
});

test('incomplete intake remains valid JSON schema but cannot silently invent missing demographics', () => {
  const pack = fixture();
  pack.observations = pack.observations.filter((row) => row.id !== 'area-child');
  assert.ok(regionPackSchema.safeParse(pack).success);
  assert.equal(auditPack(pack).status, 'blocked');
  assert.throws(() => compilePopulation(pack), /年龄边际/);
  pack.observations = [];
  assert.equal(auditPack(pack).status, 'blocked');
});

test('integer precision, totals and optional region margins must reconcile exactly', () => {
  const badTotal = fixture();
  badTotal.observations[0].value = 101;
  assert.equal(auditPack(badTotal).status, 'blocked');
  const rounded = fixture();
  rounded.observations[1].value = 100.4;
  assert.equal(regionPackSchema.safeParse(rounded).success, false);
  const badMargin = fixture();
  badMargin.observations[2].value = 19;
  assert.equal(auditPack(badMargin).status, 'blocked');
  const district = fixture();
  district.observations.push({ ...district.observations[2], id: 'district-child', areaCode: 'region' });
  assert.equal(auditPack(district).status, 'blocked');
  district.observations.push({ ...district.observations[3], id: 'district-adult', areaCode: 'region' });
  assert.equal(auditPack(district).status, 'ready');
});

test('ambiguous repeated facts, invalid references and overlapping or incomplete age partitions fail schema', () => {
  const cases: ((pack: RegionPack) => void)[] = [
    (pack) => { pack.observations.push({ ...pack.observations[2], id: 'different-id-same-cell' }); },
    (pack) => { pack.observations[2].id = pack.observations[1].id; },
    (pack) => { pack.observations[2].sourceId = 'unknown'; },
    (pack) => { pack.observations[2].areaCode = 'unknown'; },
    (pack) => { pack.observations[2].ageBand = 'unknown'; },
    (pack) => { pack.observations[0].sex = 'female'; },
    (pack) => { pack.ageBands[1].minAge = 17; },
    (pack) => { pack.ageBands[1].minAge = 19; },
    (pack) => { pack.ageBands[1].maxAge = 120; },
    (pack) => { pack.ageBands[0].minAge = 1; },
    (pack) => { pack.areas.push({ ...pack.areas[0] }); },
    (pack) => { pack.areas[0].code = pack.region.code; },
    (pack) => { pack.sexCategories.push({ ...pack.sexCategories[0] }); },
    (pack) => { pack.method.eligibleAgeBandIds = ['adult', 'adult']; },
  ];
  for (const mutate of cases) {
    const pack = fixture();
    mutate(pack);
    assert.equal(regionPackSchema.safeParse(pack).success, false, mutate.toString());
    assert.equal(auditPack(pack).status, 'blocked');
  }
});

test('observed strategy preserves factual zeros and rejects missing or contradictory joint counts', () => {
  const pack = fixture();
  addJoint(pack);
  const compiled = compilePopulation(pack);
  assert.deepEqual(compiled.cells.map((cell) => cell.population), [0, 20, 60, 20]);
  assert.ok(compiled.cells.every((cell) => cell.provenance === 'fact' && cell.evidenceIds.length === 1));
  const missingZero = structuredClone(pack);
  missingZero.observations = missingZero.observations.filter((row) => row.id !== 'joint-child-female');
  assert.equal(auditPack(missingZero).status, 'blocked');
  assert.throws(() => compilePopulation(missingZero), /缺少联合单元/);
  pack.observations.find((row) => row.id === 'joint-child-female')!.value = 1;
  assert.equal(auditPack(pack).status, 'blocked');
  const ignoredJoint = fixture();
  addJoint(ignoredJoint);
  ignoredJoint.method.jointStrategy = 'independence';
  assert.equal(auditPack(ignoredJoint).status, 'blocked');
});

test('zero-population subareas remain finite and do not add ghost population', () => {
  const pack = fixture();
  pack.areas.push({ code: 'empty', name: '空区域' });
  pack.observations.push(...pack.observations.filter((row) => row.areaCode === 'a').map((row) => ({ ...row, id: `empty-${row.id}`, areaCode: 'empty', value: 0 })));
  const compiled = compilePopulation(pack);
  assert.equal(compiled.population, 100);
  assert.ok(compiled.cells.filter((cell) => cell.areaCode === 'empty').every((cell) => cell.population === 0));
});

test('dataset digest is stable under object key order and changes when facts or provenance change', () => {
  const pack = fixture();
  const reversed = Object.fromEntries(Object.entries(pack).reverse()) as RegionPack;
  assert.equal(hashPopulationPack(pack), hashPopulationPack(reversed));
  assert.match(hashPopulationPack(pack), /^[a-f0-9]{64}$/);
  const changed = structuredClone(pack);
  changed.observations[2].locator.row = 'corrected row';
  assert.notEqual(hashPopulationPack(pack), hashPopulationPack(changed));
  changed.observations[2].value++;
  assert.notEqual(hashPopulationPack(pack), hashPopulationPack(changed));
});

test('arithmetic sex complements retain fact provenance with reproducible non-cyclic evidence', () => {
  const pack = fixture();
  const male = pack.observations.find((row) => row.id === 'area-male')!;
  male.derivation = { operation: 'subtract', inputObservationIds: ['area-total', 'area-female'] };
  assert.equal(auditPack(pack).status, 'ready');
  assert.deepEqual(compilePopulation(pack).observations.find((row) => row.id === male.id)!.derivation, male.derivation);
  male.value = 39;
  assert.equal(auditPack(pack).checks.find((check) => check.id === 'derived-facts')!.passed, false);
  male.value = 40;
  male.derivation.inputObservationIds[0] = 'region-total';
  assert.equal(auditPack(pack).checks.find((check) => check.id === 'derived-facts')!.passed, false);
  male.derivation.inputObservationIds[0] = 'unknown';
  assert.equal(regionPackSchema.safeParse(pack).success, false);
  male.derivation.inputObservationIds[0] = 'area-male';
  assert.equal(regionPackSchema.safeParse(pack).success, false);
  male.derivation.inputObservationIds[0] = 'area-total';
  const female = pack.observations.find((row) => row.id === 'area-female')!;
  female.derivation = { operation: 'subtract', inputObservationIds: ['area-total', 'area-male'] };
  assert.equal(regionPackSchema.safeParse(pack).success, false);
});

test('local source verification checks byte identity and refuses path or symlink escapes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'city-population-evidence-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'city-population-outside-'));
  try {
    const pack = fixture();
    await writeFile(path.join(root, 'source.txt'), evidence);
    assert.ok((await verifySourceFiles(pack, root))[0].passed);
    pack.sources[0].sha256 = '0'.repeat(64);
    assert.equal((await verifySourceFiles(pack, root))[0].passed, false);
    pack.sources[0] = fixture().sources[0];
    pack.sources[0].bytes++;
    assert.equal((await verifySourceFiles(pack, root))[0].passed, false);
    pack.sources[0] = fixture().sources[0];
    pack.sources[0].localPath = '../outside.txt';
    assert.match((await verifySourceFiles(pack, root))[0].detail, /工作区内/);
    await writeFile(path.join(outside, 'external.txt'), evidence);
    await symlink(path.join(outside, 'external.txt'), path.join(root, 'escaped.txt'));
    pack.sources[0].localPath = 'escaped.txt';
    assert.match((await verifySourceFiles(pack, root))[0].detail, /符号链接/);
  } finally {
    await rm(root, { recursive: true });
    await rm(outside, { recursive: true });
  }
});

test('CLI validates, compiles without overwriting input/output, and blocks tampered evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'city-population-cli-'));
  const cli = path.resolve('scripts/population.ts');
  const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
  const run = (...args: string[]) => execute(process.execPath, [tsx, cli, ...args], { cwd: root });
  try {
    const pack = fixture();
    const original = `${JSON.stringify(pack, null, 2)}\n`;
    await writeFile(path.join(root, 'pack.json'), original);
    await writeFile(path.join(root, 'source.txt'), evidence);
    assert.equal(JSON.parse((await run('validate', 'pack.json')).stdout).status, 'ready');
    await run('compile', 'pack.json', '--output', 'compiled.json');
    const compiled = JSON.parse(await readFile(path.join(root, 'compiled.json'), 'utf8'));
    assert.equal(compiled.population, 100);
    assert.equal(compiled.datasetHash, hashPopulationPack(pack));
    assert.equal(compiled.sourceFileAudit[0].passed, true);
    await assert.rejects(run('compile', 'pack.json', '--output', 'pack.json'), /EEXIST/);
    await assert.rejects(run('compile', 'pack.json', '--output', 'compiled.json'), /EEXIST/);
    assert.equal(await readFile(path.join(root, 'pack.json'), 'utf8'), original);
    await writeFile(path.join(root, 'source.txt'), `${evidence}tampered`);
    try {
      await run('compile', 'pack.json', '--output', 'should-not-exist.json');
      assert.fail('Tampered evidence unexpectedly compiled');
    } catch (error) {
      assert.equal(JSON.parse((error as { stdout: string }).stdout).status, 'blocked');
    }
    await assert.rejects(readFile(path.join(root, 'should-not-exist.json')), /ENOENT/);
  } finally {
    await rm(root, { recursive: true });
  }
});
