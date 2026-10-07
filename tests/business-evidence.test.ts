import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  businessEvidencePackSchema, businessEvidenceRequirementsSchema, createBusinessEvidenceTemplate,
  validateBusinessEvidence, type BusinessEvidencePack, type BusinessEvidenceRequirements,
} from '../shared/business-evidence.ts';

// Every value, region, review record and claimed business source below is synthetic test data.
// The positive fixture deliberately tests consistency of submitted declarations, NOT source authenticity.
function fixture(): BusinessEvidencePack {
  const pack = createBusinessEvidenceTemplate();
  pack.id = 'synthetic-test-business';
  pack.createdAt = '2026-10-02';
  pack.region = { code: 'test-region', name: '合成测试区域，不是真实地区', boundaryVintage: 'test-boundary' };
  pack.period = { start: '2026-09-01', end: '2026-09-30' };
  pack.limitations = ['所有数字、来源及核验声明均为合成测试夹具，不构成现实证据。'];
  pack.sources = [{
    id: 'synthetic-source', title: '合成业务导出测试夹具', publisher: 'test fixture', provenance: 'business-export',
    url: null, exportOwner: 'synthetic fixture owner', publishedAt: '2026-10-01', retrievedAt: '2026-10-01',
    coveredRegionCodes: ['test-region'], periodStart: '2026-09-01', periodEnd: '2026-09-30',
    snapshot: { sha256: 'a'.repeat(64), bytes: 123, mediaType: 'application/json' },
    license: '仅合成测试用途', shareScope: 'private', verificationStatus: 'verified',
    verificationRecord: { reviewer: 'test reviewer', reviewedAt: '2026-10-02', note: '合成测试记录，非现实人工核验' },
    useLimit: '仅合成测试夹具；仅能描述本店去重客户，不代表所有居民。',
  }];
  pack.observations = [{
    id: 'customers', metric: 'uniqueCustomers', value: 40, unit: '人', populationBasis: '测试本店完成订单的去重客户',
    geography: { regionCode: 'test-region', level: 'district', code: 'test-region', name: '合成测试区域', boundaryVintage: 'test-boundary' },
    periodStart: '2026-09-01', periodEnd: '2026-09-30', sourceId: 'synthetic-source', locator: 'synthetic fixture aggregate row',
    provenance: 'fact', verificationStatus: 'verified', missingReason: null, useLimit: '合成测试，仅限上述目标客户。',
    denominatorObservationId: null, derivation: null, modelEvidence: null,
  }];
  return pack;
}

function requirements(): BusinessEvidenceRequirements {
  return {
    schemaVersion: '1.0', regionCode: 'test-region', boundaryVintage: 'test-boundary',
    periodStart: '2026-09-01', periodEnd: '2026-09-30', asOf: '2026-10-07', maxAgeDays: 30,
    requiredMetrics: [{
      metric: 'uniqueCustomers', unit: '人', populationBasis: '测试本店完成订单的去重客户', geographyLevel: 'district',
      geographyCode: null, requiresDenominator: false, denominatorUnit: null, denominatorPopulationBasis: null,
    }],
  };
}

test('consistent submitted declarations are ready only for manual review, never recommendations or source certification', () => {
  const audit = validateBusinessEvidence(fixture(), requirements());
  assert.equal(audit.status, 'ready-for-review');
  assert.equal(audit.manualSourceVerificationNeeded, true);
  assert.equal(audit.automaticRecommendationsAllowed, false);
  assert.equal(audit.populationPublicationAllowed, false);
  assert.deepEqual(audit.claimedVerifiedSourceIds, ['synthetic-source']);
  assert.ok(audit.limitations.some(note => note.includes('哈希不是来源认证')));
  assert.doesNotThrow(() => JSON.stringify(audit));
});

test('empty intake template keeps nulls and is needs-data rather than zero or ready', async () => {
  const template = createBusinessEvidenceTemplate();
  assert.equal(businessEvidencePackSchema.safeParse(template).success, true);
  assert.equal(validateBusinessEvidence(template).status, 'needs-data');
  assert.equal(template.observations[0].value, null);
  assert.equal(template.sources[0].snapshot.bytes, null);
  const saved = JSON.parse(await readFile(new URL('../data/business-evidence/new-business-evidence-template.json', import.meta.url), 'utf8'));
  assert.deepEqual(saved, template);
});

test('unsupported versions, unknown fields, nonfinite numbers, bad dates and file URL are invalid', () => {
  for (const change of [
    (pack: Record<string, unknown>) => { pack.schemaVersion = '2.0'; },
    (pack: Record<string, unknown>) => { pack.localPath = '/must-not-read'; },
    (pack: Record<string, unknown>) => { pack.createdAt = '2026-02-30'; },
  ]) {
    const pack = fixture() as unknown as Record<string, unknown>;
    change(pack); assert.equal(validateBusinessEvidence(pack).status, 'invalid');
  }
  const numeric = fixture(); numeric.observations[0].value = Infinity;
  assert.equal(validateBusinessEvidence(numeric).status, 'invalid');
  const url = fixture(); url.sources[0].url = 'file:///must-not-read';
  assert.equal(validateBusinessEvidence(url).status, 'invalid');
});

test('all primary and reference IDs are unique and source references must exist', () => {
  for (const key of ['sources', 'observations'] as const) {
    const pack = fixture(); (pack[key] as unknown[]).push(structuredClone(pack[key][0]));
    assert.equal(validateBusinessEvidence(pack).status, 'invalid');
  }
  const pack = fixture(); pack.observations[0].sourceId = 'absent';
  assert.equal(validateBusinessEvidence(pack).status, 'invalid');
});

test('same-scope conflicting values and mixed units are conflict, equal duplicate observations require selection', () => {
  for (const change of ['value', 'unit', 'same'] as const) {
    const pack = fixture(); const row = structuredClone(pack.observations[0]); row.id = 'second';
    if (change === 'value') row.value = 41;
    if (change === 'unit') row.unit = '单';
    pack.observations.push(row);
    assert.equal(validateBusinessEvidence(pack).status, change === 'same' ? 'needs-data' : 'conflict');
  }
});

test('cross region, boundary, package periods and source coverage cannot be silently mapped', () => {
  for (const field of ['regionCode', 'boundaryVintage'] as const) {
    const pack = fixture(); pack.observations[0].geography[field] = 'other';
    assert.equal(validateBusinessEvidence(pack).status, 'conflict');
  }
  const period = fixture(); period.observations[0].periodEnd = '2026-08-31';
  assert.equal(validateBusinessEvidence(period).status, 'conflict');
  const coverage = fixture(); coverage.sources[0].coveredRegionCodes = ['other'];
  assert.equal(validateBusinessEvidence(coverage).status, 'conflict');
  const sourcePeriod = fixture(); sourcePeriod.sources[0].periodStart = '2026-09-02';
  assert.equal(validateBusinessEvidence(sourcePeriod).status, 'conflict');
});

test('pending, explicit conflict, missing fingerprint, license and synthetic source never certify facts', () => {
  for (const change of ['pending', 'fingerprint', 'license', 'synthetic', 'review'] as const) {
    const pack = fixture();
    if (change === 'pending') pack.sources[0].verificationStatus = 'pending';
    if (change === 'fingerprint') pack.sources[0].snapshot.sha256 = null;
    if (change === 'license') pack.sources[0].license = null;
    if (change === 'synthetic') pack.sources[0].provenance = 'synthetic-fixture';
    if (change === 'review') pack.sources[0].verificationRecord = null;
    assert.equal(validateBusinessEvidence(pack, requirements()).status, 'needs-data');
  }
  const conflict = fixture(); conflict.sources[0].verificationStatus = 'conflict';
  assert.equal(validateBusinessEvidence(conflict).status, 'conflict');
});

test('unknown target denominator is explicit and cannot be inferred from population or zero', () => {
  const required = requirements(); required.requiredMetrics[0].requiresDenominator = true;
  assert.equal(validateBusinessEvidence(fixture(), required).status, 'needs-data');
  required.requiredMetrics[0].denominatorUnit = '人';
  required.requiredMetrics[0].denominatorPopulationBasis = '测试全部目标客户';
  const pack = fixture(); const denominator = structuredClone(pack.observations[0]);
  denominator.id = 'eligible'; denominator.metric = 'eligibleCustomers'; denominator.populationBasis = '测试全部目标客户'; denominator.value = 100;
  pack.observations.push(denominator); pack.observations[0].denominatorObservationId = 'eligible';
  assert.equal(validateBusinessEvidence(pack, required).status, 'ready-for-review');
  for (const value of [null, 0]) {
    const unavailable = structuredClone(pack); unavailable.observations[1].value = value;
    unavailable.observations[1].missingReason = value === null ? '未采集' : null;
    assert.equal(validateBusinessEvidence(unavailable, required).status, 'needs-data');
  }
  const wrongBasis = structuredClone(required); wrongBasis.requiredMetrics[0].denominatorPopulationBasis = '常住人口';
  assert.equal(validateBusinessEvidence(pack, wrongBasis).status, 'needs-data');
  pack.observations[1].geography.code = 'other-geography';
  assert.equal(validateBusinessEvidence(pack, required).status, 'conflict');
});

test('denominator references cannot be absent or self-referential', () => {
  for (const reference of ['absent', 'customers']) {
    const pack = fixture(); pack.observations[0].denominatorObservationId = reference;
    assert.equal(validateBusinessEvidence(pack).status, 'invalid');
  }
});

test('task requirements are caller-driven, strictly scoped, and never matched by topic keywords', () => {
  const required = requirements(); required.requiredMetrics[0].metric = 'anything-the-task-requires';
  assert.equal(validateBusinessEvidence(fixture(), required).status, 'needs-data');
  for (const field of ['regionCode', 'boundaryVintage', 'periodStart'] as const) {
    const target = requirements(); target[field] = field === 'periodStart' ? '2026-08-01' : 'other';
    assert.equal(validateBusinessEvidence(fixture(), target).status, 'conflict');
  }
  const unit = requirements(); unit.requiredMetrics[0].unit = '户';
  assert.equal(validateBusinessEvidence(fixture(), unit).status, 'conflict');
  const basis = requirements(); basis.requiredMetrics[0].populationBasis = '全区居民';
  assert.equal(validateBusinessEvidence(fixture(), basis).status, 'conflict');
  assert.equal(businessEvidenceRequirementsSchema.safeParse({ ...requirements(), unexpected: true }).success, false);
});

test('staleness depends on frozen caller asOf and time allowance, not machine clock', () => {
  const required = requirements(); required.maxAgeDays = 2;
  assert.equal(validateBusinessEvidence(fixture(), required).status, 'needs-data');
  assert.equal(validateBusinessEvidence(fixture(), { ...required, asOf: '2026-09-20' }).status, 'invalid');
  const future = fixture(); future.sources[0].verificationRecord!.reviewedAt = '2026-10-08';
  assert.equal(validateBusinessEvidence(future, requirements()).status, 'conflict');
});

test('unsupported claims, changed units or invented quantities are rejected', () => {
  const pack = fixture(); const row = pack.observations[0];
  pack.claims = [{
    id: 'summary', text: '合成测试观测直接摘要，不是真实业务结论。', kind: 'observation-summary', observationIds: [row.id],
    metric: row.metric, value: row.value, unit: row.unit, populationBasis: row.populationBasis,
    geography: structuredClone(row.geography), periodStart: row.periodStart, periodEnd: row.periodEnd,
    provenance: 'fact', useLimit: '合成测试；只匹配明确引用的原观测。',
  }];
  assert.equal(validateBusinessEvidence(pack).status, 'ready-for-review');
  const absent = structuredClone(pack); absent.claims[0].observationIds = ['absent'];
  assert.equal(validateBusinessEvidence(absent).status, 'invalid');
  const changed = structuredClone(pack); changed.claims[0].unit = '户';
  assert.equal(validateBusinessEvidence(changed).status, 'conflict');
  const quantity = structuredClone(pack); quantity.claims[0].value = 500;
  assert.equal(validateBusinessEvidence(quantity).status, 'conflict');
  const forged = structuredClone(pack); forged.observations[0].provenance = 'generated';
  assert.equal(validateBusinessEvidence(forged).status, 'conflict');
  const recommendation = structuredClone(pack) as unknown as { claims: { kind: string }[] };
  recommendation.claims[0].kind = 'recommendation';
  assert.equal(validateBusinessEvidence(recommendation).status, 'invalid');
});

test('hypotheses remain non-numeric assumptions, while generated/inferred observations need provenance', () => {
  const pack = fixture(); const row = pack.observations[0];
  pack.claims = [{
    id: 'hypothesis', text: '仅是待验证假设。', kind: 'hypothesis', observationIds: [row.id], metric: row.metric,
    value: null, unit: row.unit, populationBasis: row.populationBasis, geography: structuredClone(row.geography),
    periodStart: row.periodStart, periodEnd: row.periodEnd, provenance: 'assumption', useLimit: '不产生任何经营建议。',
  }];
  assert.equal(validateBusinessEvidence(pack).status, 'ready-for-review');
  pack.claims[0].provenance = 'fact';
  assert.equal(validateBusinessEvidence(pack).status, 'invalid');
  const generated = fixture(); generated.observations[0].provenance = 'generated';
  assert.equal(validateBusinessEvidence(generated).status, 'needs-data');
  const inferred = fixture(); inferred.observations[0].provenance = 'infer';
  assert.equal(validateBusinessEvidence(inferred).status, 'needs-data');
});

test('derived observation inputs must exist, share scope, and be acyclic', () => {
  const pack = fixture(); const second = structuredClone(pack.observations[0]); second.id = 'derived'; second.metric = 'derivedMetric';
  second.provenance = 'infer'; second.derivation = { method: 'synthetic test method', methodVersion: 'test-v1', inputObservationIds: ['customers'] };
  pack.observations.push(second);
  assert.equal(validateBusinessEvidence(pack).status, 'needs-data');
  pack.observations[0].derivation = { ...second.derivation, inputObservationIds: ['derived'] };
  assert.equal(validateBusinessEvidence(pack).status, 'invalid');
  pack.observations[0].derivation = null; pack.observations[1].derivation!.inputObservationIds = ['absent'];
  assert.equal(validateBusinessEvidence(pack).status, 'invalid');
});

test('canonical hashes are stable across object key order, sensitive to versions and do not mutate input', () => {
  const pack = fixture(); const before = structuredClone(pack); const required = requirements();
  const report = validateBusinessEvidence(pack, required);
  const reordered = Object.fromEntries(Object.entries(pack).reverse());
  assert.equal(validateBusinessEvidence(reordered, required).auditHash, report.auditHash);
  assert.deepEqual(pack, before);
  pack.version = 'new-version';
  assert.notEqual(validateBusinessEvidence(pack, required).packHash, report.packHash);
  assert.notEqual(validateBusinessEvidence(pack, { ...required, maxAgeDays: 31 }).requirementsHash, report.requirementsHash);
  const unscoped = validateBusinessEvidence(before);
  assert.equal(unscoped.requirementsProvided, false);
  assert.equal(unscoped.requirementsHash, null);
  assert.ok(unscoped.checks.some(check => check.id === 'requirements-not-provided'));
});
