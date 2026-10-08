import assert from 'node:assert/strict';
import test from 'node:test';
import { nextSurveyAudience } from '../src/survey-audience.ts';

test('fixture visitor count is restored after live mode defaults to one', () => {
  const initial = { mode: 'fixture' as const, count: 12, fixtureCount: 12 };
  const live = nextSurveyAudience(initial, 'live');
  assert.deepEqual(live, { mode: 'live', count: 1, fixtureCount: 12 });
  assert.deepEqual(nextSurveyAudience(live, 'fixture'), { mode: 'fixture', count: 12, fixtureCount: 12 });

  const edited = nextSurveyAudience({ mode: 'fixture', count: 8, fixtureCount: 12 }, 'live');
  assert.equal(edited.count, 1);
  assert.equal(edited.fixtureCount, 8);
  const liveEdited = { ...edited, count: 3 };
  const restored = nextSurveyAudience(liveEdited, 'fixture');
  assert.equal(restored.count, 8);
  assert.equal(restored.fixtureCount, 8);
  assert.deepEqual(nextSurveyAudience(restored, 'live'), { mode: 'live', count: 1, fixtureCount: 8 });
  assert.deepEqual(nextSurveyAudience(liveEdited, 'live'), liveEdited);
});
