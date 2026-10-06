import test from 'node:test';
import assert from 'node:assert/strict';
import { getCityProfile, simulateSurvey } from '../server/city.ts';

const input = { product: 'AI 生活服务会员', price: 39, sampleSize: 120, seed: 20260923 };

test('official street and age margins reconcile, with a separate 15+ survey frame', () => {
  const city = getCityProfile();
  assert.equal(city.population, 503859);
  assert.equal(city.eligiblePopulation, 434827);
  assert.equal(city.streets.reduce((sum, street) => sum + street.population, 0), city.population);
  assert.equal(city.ageGroups.reduce((sum, age) => sum + age.population, 0), city.population);
  for (const street of city.streets) {
    assert.equal(street.ageGroups.reduce((sum, age) => sum + age.population!, 0), street.population);
    assert.equal(street.sexCounts.reduce((sum, sex) => sum + sex.population, 0), street.population);
    assert.equal(street.provenance, 'fact');
  }
  assert.ok(city.sources.every((source) => source.url.includes('cloud.zj.gov.cn') && source.locator));
  city.sources[0].title = 'changed by consumer';
  assert.notEqual(getCityProfile().sources[0].title, 'changed by consumer');
});

test('stratified allocation accounts for every sample and every unit of population', () => {
  for (const sampleSize of [30, 31, 120, 600]) {
    const result = simulateSurvey({ ...input, sampleSize });
    assert.equal(result.responses.length, sampleSize);
    assert.equal(result.strata.reduce((sum, stratum) => sum + stratum.sampleSize, 0), sampleSize);
    assert.equal(new Set(result.responses.map((response) => response.id)).size, sampleSize);
    assert.ok(result.strata.every((stratum) => stratum.sampleSize > 0 && stratum.weight > 0));
    assert.ok(Math.abs(result.responses.reduce((sum, row) => sum + row.weight, 0) - result.eligiblePopulation) < 1e-6);
    for (const street of getCityProfile().streets) {
      const group = result.byStreet.find((row) => row.id === street.id)!;
      assert.ok(Math.abs(group.population - street.eligiblePopulation) < 1e-6);
    }
    assert.ok(result.responses.every((row) => row.ageId === '15-59' || row.ageId === '60+'));
  }
});

test('same input exactly reproduces the report; changing seed changes synthetic responses', () => {
  assert.deepEqual(simulateSurvey(input), simulateSurvey(input));
  assert.notDeepEqual(simulateSurvey(input).responses, simulateSurvey({ ...input, seed: 42 }).responses);
});

test('price scenarios keep respondents fixed and monotonically reduce modeled acceptance', () => {
  const low = simulateSurvey({ ...input, price: 10 });
  const high = simulateSurvey({ ...input, price: 90 });
  assert.deepEqual(low.responses.map((r) => r.willingnessToPay), high.responses.map((r) => r.willingnessToPay));
  assert.ok(low.summary.acceptanceRate >= high.summary.acceptanceRate);
  const result = simulateSurvey(input);
  let previous = 1;
  for (const point of result.priceSensitivity) {
    assert.ok(point.acceptanceRate >= 0 && point.acceptanceRate <= 1);
    assert.ok(point.acceptanceRate <= previous);
    previous = point.acceptanceRate;
  }
  for (const row of result.responses) assert.ok(row.acceptanceProbability >= 0 && row.acceptanceProbability <= 1);
  assert.equal(simulateSurvey({ ...input, price: 100000 }).summary.acceptanceRate, 0);
});

test('demographic inference and generated attitudes are never labeled as facts', () => {
  const result = simulateSurvey(input);
  assert.ok(result.strata.every((stratum) => stratum.provenance === 'infer'));
  assert.ok(result.responses.every((response) => response.provenance === 'generated' && response.attributeProvenance.willingnessToPay === 'generated' && response.attributeProvenance.answer === 'generated'));
  assert.equal(result.summary.provenance, 'generated');
  assert.equal(result.mode, 'deterministic-fixture');
  assert.equal(result.manifest.llmCalls, 0);
  assert.ok(result.disclaimers.some((text) => text.includes('15–17')));
  assert.equal(result.manifest.datasetHash, getCityProfile().datasetHash);
  assert.match(result.manifest.datasetHash, /^[a-f0-9]{64}$/);
  assert.ok(result.manifest.sourceHashes.every((source) => /^[a-f0-9]{64}$/.test(source.sha256)));
  assert.ok(result.strata.every((stratum) => stratum.evidenceIds.length > 0 && stratum.feasibleRange.min <= stratum.population && stratum.feasibleRange.max >= stratum.population));
});

test('invalid or unbounded requests are rejected', () => {
  for (const override of [{ sampleSize: 29 }, { sampleSize: 601 }, { sampleSize: 120.5 }, { price: NaN }, { price: Infinity }, { price: -1 }, { seed: -1 }, { seed: 2 ** 32 }, { product: '' }]) {
    assert.throws(() => simulateSurvey({ ...input, ...override }));
  }
});
