import { createDefaultPersona, type ResidentPersona } from './resident-persona';

/** Purposeful scenario coverage, not observed Binjiang classes or a prevalence model. */
export const PERSONA_SCENARIOS = [
  { id: 'technology-alone', label: '技术从业 · 独居情景', education: 'bachelor', employment: 'employed', occupation: '技术研发（情景假设）', relationship: 'single', livingRoles: ['living-alone'], experiences: ['relocated'] },
  { id: 'service-family', label: '服务就业 · 家庭同住情景', education: 'vocational', employment: 'employed', occupation: '商贸或生活服务（情景假设）', relationship: 'married', livingRoles: ['with-partner', 'with-children'], experiences: ['urban'] },
  { id: 'care-multigeneration', label: '照护职责 · 多代同住情景', education: 'unknown', employment: 'unknown', occupation: '', relationship: 'married', livingRoles: ['with-partner', 'with-children', 'with-parents', 'multi-generation', 'caregiver'], experiences: ['extended-family'] },
  { id: 'study-relocated', label: '学习阶段 · 异地成长情景', education: 'secondary', employment: 'student', occupation: '在读学习（情景假设）', relationship: 'unknown', livingRoles: ['shared-housing'], experiences: ['relocated', 'boarding'] },
  { id: 'retired-partner', label: '退休阶段 · 伴侣同住情景', education: 'unknown', employment: 'retired', occupation: '', relationship: 'married', livingRoles: ['with-partner'], experiences: [] },
] as const;

export function createPersonaScenario(id: string): ResidentPersona {
  const selected = PERSONA_SCENARIOS.find(item => item.id === id);
  if (!selected) throw new Error('未知五层情景组合。');
  const persona = createDefaultPersona();
  persona.upbringing.experiences = [...selected.experiences];
  persona.education.level = selected.education;
  persona.household.relationship = selected.relationship;
  persona.household.livingRoles = [...selected.livingRoles];
  persona.work.employment = selected.employment;
  persona.work.occupation = selected.occupation;
  // No scenario assigns personality, income, buying preferences or real population shares.
  return persona;
}
