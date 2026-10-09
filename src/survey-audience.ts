export interface SurveyAudience {
  mode: 'fixture' | 'live';
  count: number;
  /** Count last used in fixture mode. Live edits must not replace it. */
  fixtureCount: number;
}

/** Live selection uses 1. Leaving live restores the fixture count from before that switch. */
export function nextSurveyAudience(current: SurveyAudience, nextMode: SurveyAudience['mode']): SurveyAudience {
  if (nextMode === current.mode) return current;
  if (nextMode === 'live') return { mode: 'live', count: 1, fixtureCount: current.mode === 'fixture' ? current.count : current.fixtureCount };
  return { mode: 'fixture', count: current.fixtureCount, fixtureCount: current.fixtureCount };
}
