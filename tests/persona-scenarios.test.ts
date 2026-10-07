import assert from 'node:assert/strict';
import test from 'node:test';
import { PERSONA_SCENARIOS, createPersonaScenario } from '../shared/persona-scenarios';
import { residentPersonaSchema } from '../shared/resident-persona';

test('exploratory scenario combinations stay assumptions with unknown personality/income and no weights', () => {
  for (const item of PERSONA_SCENARIOS) {
    const persona = createPersonaScenario(item.id);
    assert.ok(residentPersonaSchema.safeParse(persona).success, item.id);
    assert.equal(persona.provenance, 'assumption');
    for (const [key, value] of Object.entries(persona.personality)) if (key !== 'customTraits') assert.equal(value, null);
    assert.equal(persona.work.income.lower, null); assert.equal(persona.work.income.upper, null);
    assert.equal('weight' in item, false); assert.equal('preference' in persona, false);
  }
  assert.throws(() => createPersonaScenario('unknown'));
  const a = createPersonaScenario(PERSONA_SCENARIOS[0].id); a.upbringing.experiences.push('boarding');
  assert.equal(createPersonaScenario(PERSONA_SCENARIOS[0].id).upbringing.experiences.includes('boarding'), false);
});
