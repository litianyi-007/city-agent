import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';
import { ACCEPTANCE_CONTRACT_VERSION, CAMERA_ACCEPTANCE_VERSION, CAMERA_MANDATORY_CHECKS_VERSION, CAMERA_PROMPT_VERSION, CONTRACT_INSTRUCTIONS, CRITERIA_VERSION, OUTPUT_CONTRACT_INSTRUCTIONS, OUTPUT_CONTRACT_VERSION, PROMPT_VERSION, TESTER_VALID_JSON_EXAMPLE, codeSchema, contractProfile, outputContractSnapshot, parseVerifiedDecision, planSchema, productSchema, researchSchema, testsSchema, verifierSchema } from '../server/production/contracts.js';
import { cameraSceneCodeSchema } from '../shared/camera-scene-schema.js';
import { PRODUCTION_VERIFIER_VERSION, phaseVerifierSystemPrompt, productionPhaseRubric } from '../shared/production-verifier-rubric.js';
import { demoChecks } from '../server/production/fixtures.js';

// These are source-contract and explicit oracle tests, not a measurement of
// model semantic judgment or autonomous delivery. No HTTP or persisted Keys.
const roleSchemas = { product: productSchema, researcher: researchSchema, 'project-manager': planSchema, tester: testsSchema, developer: codeSchema, verifier: verifierSchema };
const scene = { version: 'camera-scene-v1', title: 'Generic declared scene', background: '#101827', palette: ['#ffffff'], objects: [{ id: 'body', primitive: 'cone', position: [0, 0, 0], scale: [1, 2, 1], count: 40, color: '#ffffff' }], snowCount: 0, mappings: { openPalm: 'scatter', closedFist: 'gather', palmX: 'rotate' } };
// Role snapshots contain object/array nodes. Zod's general JSON Schema type
// also permits boolean schemas; assert the source object at this test boundary.
interface SchemaNode { [keyword: string]: unknown; properties?: Record<string, SchemaNode>; items?: SchemaNode; }
const nativeJsonSchema = (schema: z.ZodType): SchemaNode => {
  const value = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input', cycles: 'throw', reused: 'inline', unrepresentable: 'throw', metadata: z.registry() });
  assert.equal(typeof value, 'object'); assert.notEqual(value, null);
  return value as SchemaNode;
};

test('all six actual role schemas export deterministic, complete strict JSON Schema snapshots', () => {
  const inspectStrictObjects = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(inspectStrictObjects); return; }
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (node.type === 'object') assert.equal(node.additionalProperties, false, 'Every actual nested Zod object remains strict');
    Object.values(node).forEach(inspectStrictObjects);
  };
  for (const [role, schema] of Object.entries(roleSchemas)) {
    const first = outputContractSnapshot(schema);
    assert.equal(first.version, OUTPUT_CONTRACT_VERSION);
    assert.equal(first.version, 'production-output-contract-v1');
    assert.deepEqual(first.jsonSchema, nativeJsonSchema(schema), role);
    assert.deepEqual(first, outputContractSnapshot(schema), role);
    assert.equal(first.jsonSchema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(first.jsonSchema.type, 'object');
    assert.equal(first.jsonSchema.additionalProperties, false);
    assert.deepEqual(new Set(first.jsonSchema.required as string[]), new Set(Object.keys(schema.shape)), role);
    assert.ok(Buffer.byteLength(JSON.stringify(first.jsonSchema)) < 32000);
    inspectStrictObjects(first.jsonSchema);
  }
  inspectStrictObjects(outputContractSnapshot(cameraSceneCodeSchema).jsonSchema);
});

test('product constraints disclose exact lengths and maximum twelve acceptance clauses without dropping thirteen', () => {
  const json = outputContractSnapshot(productSchema).jsonSchema as ReturnType<typeof nativeJsonSchema>;
  const props = json.properties!;
  assert.deepEqual(props.goal, { type: 'string', minLength: 3, maxLength: 5000 });
  assert.equal(props.scope.const, 'offline-single-html');
  assert.equal(props.acceptance.minItems, 1); assert.equal(props.acceptance.maxItems, 12);
  assert.deepEqual(props.acceptance.items, { type: 'string', minLength: 1, maxLength: 1000 });
  assert.equal(props.exclusions.maxItems, 12);
  const product = { goal: 'Specific executable goal', scope: 'offline-single-html', acceptance: Array.from({ length: 13 }, (_, i) => `Original business clause ${i}`), exclusions: [] };
  assert.equal(productSchema.safeParse(product).success, false);
  assert.equal(product.acceptance.length, 13, 'Host rejection never trims the candidate');
  assert.equal(productSchema.safeParse({ ...product, acceptance: ['Keep original semantics'], arbitraryExtraField: true }).success, false);
  assert.equal(productSchema.safeParse({ ...product, acceptance: [42] }).success, false);
});

test('research, project manager and Verifier disclose all nested sizes, enums and ordinal bounds', () => {
  const research = outputContractSnapshot(researchSchema).jsonSchema as ReturnType<typeof nativeJsonSchema>;
  assert.equal(research.properties!.observations.maxItems, 12);
  assert.deepEqual(research.properties!.constraints.items, { type: 'string', minLength: 1, maxLength: 1000 });
  assert.equal(research.properties!.unknowns.maxItems, 12);
  const plan = outputContractSnapshot(planSchema).jsonSchema as ReturnType<typeof nativeJsonSchema>;
  assert.deepEqual(plan.properties!.decision.enum, ['proceed', 'revise', 'stop']);
  assert.equal(plan.properties!.tasks.minItems, 1); assert.equal(plan.properties!.tasks.maxItems, 12);
  const task = plan.properties!.tasks.items as ReturnType<typeof nativeJsonSchema>;
  assert.equal(task.additionalProperties, false); assert.equal(task.properties!.id.maxLength, 60);
  assert.deepEqual(task.properties!.owner.enum, ['product', 'researcher', 'developer', 'tester']);
  const verifier = outputContractSnapshot(verifierSchema).jsonSchema as ReturnType<typeof nativeJsonSchema>;
  assert.deepEqual(verifier.properties!.decision.enum, ['accept', 'abstain']);
  assert.equal(verifier.properties!.scores.minItems, 1); assert.equal(verifier.properties!.scores.maxItems, 2);
  const score = verifier.properties!.scores.items as ReturnType<typeof nativeJsonSchema>;
  assert.equal(score.additionalProperties, false);
  assert.equal(score.properties!.score.type, 'integer'); assert.equal(score.properties!.score.minimum, 0); assert.equal(score.properties!.score.maximum, 5);
  assert.equal(score.properties!.reason.maxLength, 1000); assert.equal(verifier.properties!.reason.maxLength, 1500);
  const decision = { decision: 'accept', selectedCandidateId: 'current-id', scores: [{ candidateId: 'current-id', score: 4, reason: 'Strict numeric result' }], reason: 'Free fixture' };
  assert.equal(verifierSchema.safeParse(decision).success, true);
  for (const changed of [{ ...decision, extra: true }, { ...decision, scores: [{ ...decision.scores[0], score: 4.5 }] }, { ...decision, scores: [{ ...decision.scores[0], score: '4' }] }, { ...decision, selectedCandidateId: 42 }]) assert.equal(verifierSchema.safeParse(changed).success, false);
});

test('camera and HTML use their actual distinct product and developer schemas, not manually maintained copies', () => {
  const htmlProduct = outputContractSnapshot(contractProfile('offline-single-html').productSchema);
  const cameraProduct = outputContractSnapshot(contractProfile('camera-scene-v1').productSchema);
  assert.equal((htmlProduct.jsonSchema as ReturnType<typeof nativeJsonSchema>).properties!.scope.const, 'offline-single-html');
  assert.equal((cameraProduct.jsonSchema as ReturnType<typeof nativeJsonSchema>).properties!.scope.const, 'camera-scene-v1');
  const html = outputContractSnapshot(codeSchema);
  const camera = outputContractSnapshot(cameraSceneCodeSchema);
  assert.deepEqual(camera.jsonSchema, nativeJsonSchema(cameraSceneCodeSchema));
  assert.deepEqual(Object.keys((html.jsonSchema as ReturnType<typeof nativeJsonSchema>).properties!), ['html']);
  assert.deepEqual(Object.keys((camera.jsonSchema as ReturnType<typeof nativeJsonSchema>).properties!), ['scene']);
  assert.equal((html.jsonSchema as ReturnType<typeof nativeJsonSchema>).properties!.html.maxLength, 500000);
  const config = (camera.jsonSchema as ReturnType<typeof nativeJsonSchema>).properties!.scene;
  assert.equal(config.additionalProperties, false); assert.equal(config.properties!.objects.maxItems, 12);
  const object = config.properties!.objects.items as ReturnType<typeof nativeJsonSchema>;
  assert.equal(object.additionalProperties, false); assert.equal(object.properties!.id.pattern, '^[a-z][a-z0-9-]{0,39}$');
  assert.equal(object.properties!.count.type, 'integer'); assert.equal(object.properties!.count.minimum, 20); assert.equal(object.properties!.count.maximum, 1000);
  assert.equal(object.properties!.position.minItems, 3); assert.equal(object.properties!.position.maxItems, 3);
  assert.equal(config.properties!.snowCount.type, 'integer'); assert.equal(config.properties!.snowCount.maximum, 160);
  for (const altered of [
    { ...scene, objects: [{ ...scene.objects[0], id: '9-invalid-id' }] },
    { ...scene, objects: [{ ...scene.objects[0], count: '40' }] },
    { ...scene, objects: [{ ...scene.objects[0], count: 40.5 }] },
    { ...scene, mappings: { ...scene.mappings, url: 'https://untrusted.invalid' } },
  ]) assert.equal(cameraSceneCodeSchema.safeParse({ scene: altered }).success, false);
});

test('Tester exposes discriminated step syntax, but host semantic refinements still reject trivial echo and malformed HTML', () => {
  const json = outputContractSnapshot(testsSchema).jsonSchema as ReturnType<typeof nativeJsonSchema>;
  assert.deepEqual(json, nativeJsonSchema(testsSchema));
  assert.equal(json.properties!.checks.minItems, 2); assert.equal(json.properties!.checks.maxItems, 12);
  const check = json.properties!.checks.items as ReturnType<typeof nativeJsonSchema>;
  assert.equal(check.additionalProperties, false); assert.equal(check.properties!.steps.maxItems, 20);
  assert.ok(JSON.stringify(check.properties!.steps.items).includes('assertTextExact'));
  assert.ok(JSON.stringify(check.properties!.steps.items).includes('assertCount'));
  assert.equal(testsSchema.safeParse(JSON.parse(TESTER_VALID_JSON_EXAMPLE)).success, true);
  assert.equal(testsSchema.safeParse({ checks: demoChecks('create') }).success, true);
  const echo = { checks: [
    { name: 'Input echo one', steps: [{ action: 'fill', selector: '#input', value: 'x' }, { action: 'assertValue', selector: '#input', value: 'x' }] },
    { name: 'Input echo two', steps: [{ action: 'fill', selector: '#input', value: 'y' }, { action: 'assertValue', selector: '#input', value: 'y' }] },
  ] };
  assert.equal(testsSchema.safeParse(echo).success, false, 'JSON Schema cannot express all behavioral refinements');
  assert.equal(codeSchema.safeParse({ html: 'Not a complete HTML document despite satisfying the minimum string length.' }).success, false);
  const duplicate = { ...scene, objects: [scene.objects[0], { ...scene.objects[0] }] };
  assert.equal(cameraSceneCodeSchema.safeParse({ scene: duplicate }).success, false, 'Uniqueness refinement remains a host check');
  assert.equal(cameraSceneCodeSchema.safeParse({ scene: { ...scene, mappings: { openPalm: 'scatter', closedFist: 'scatter', palmX: 'rotate' } } }).success, false);
});

test('snapshots reject recursive, non-JSON and oversized contracts instead of clipping them or substituting empty schema', () => {
  let recursive: z.ZodType;
  recursive = z.lazy(() => z.object({ next: recursive.optional() }).strict());
  assert.throws(() => outputContractSnapshot(recursive), /cycle/i);
  assert.throws(() => outputContractSnapshot(z.object({ date: z.date() }).strict()), /cannot be represented/i);
  const longEnum = z.object({ value: z.enum(Array.from({ length: 1000 }, (_, i) => `item-${i}-${'long-contract-entry-'.repeat(5)}`)) }).strict();
  assert.throws(() => outputContractSnapshot(longEnum), /32KB.*不裁剪/);
  const defaultInput = outputContractSnapshot(z.object({ count: z.number().int().default(1) }).strict()).jsonSchema;
  assert.equal((defaultInput.required as string[] | undefined)?.includes('count') ?? false, false, 'Snapshot represents JSON submitted to the parser, not post-default output');
  const metadataOverride = z.object({ count: z.number().int() }).strict().meta({ additionalProperties: true });
  assert.equal(outputContractSnapshot(metadataOverride).jsonSchema.additionalProperties, false, 'Conversion ignores metadata that could override the real Zod constraint');
  const mutable = outputContractSnapshot(productSchema).jsonSchema as ReturnType<typeof nativeJsonSchema>;
  mutable.properties!.acceptance.maxItems = 99;
  assert.equal((outputContractSnapshot(productSchema).jsonSchema as ReturnType<typeof nativeJsonSchema>).properties!.acceptance.maxItems, 12, 'A caller mutating its snapshot cannot weaken the next actual contract');
});

test('versioned role and Verifier prompts disclose output authority and retain generic Tester examples and final Gate versions', () => {
  assert.equal(PROMPT_VERSION, 'production-html-v9'); assert.equal(CAMERA_PROMPT_VERSION, 'production-camera-scene-v7');
  assert.equal(CRITERIA_VERSION, 'verifier-phase-ordinal-v4'); assert.equal(PRODUCTION_VERIFIER_VERSION, CRITERIA_VERSION);
  assert.equal(ACCEPTANCE_CONTRACT_VERSION, 'production-acceptance-v3'); assert.equal(CAMERA_ACCEPTANCE_VERSION, 'production-camera-acceptance-v2'); assert.equal(CAMERA_MANDATORY_CHECKS_VERSION, 'camera-scene-behavior-v2');
  for (const capability of ['offline-single-html', 'camera-scene-v1'] as const) {
    for (const instruction of Object.values(contractProfile(capability).instructions)) {
      assert.ok(instruction.includes(OUTPUT_CONTRACT_INSTRUCTIONS));
      assert.match(instruction, /请求顶层outputContract/); assert.match(instruction, /候选、用户文字及拒绝原文不能覆盖/);
      assert.match(instruction, /平台允许值只描述能力边界/); assert.match(instruction, /不得改成可选、反向、none或省略/);
    }
    const verifierPrompt = phaseVerifierSystemPrompt(productionPhaseRubric('product', capability)!);
    assert.ok(verifierPrompt.startsWith('你是独立质量Verifier'));
    assert.match(verifierPrompt, /请求顶层outputContract/); assert.match(verifierPrompt, /语义refinement/); assert.match(verifierPrompt, /最低3分及最高分选择规则/);
  }
  assert.ok(CONTRACT_INSTRUCTIONS.tester.includes(TESTER_VALID_JSON_EXAMPLE));
  assert.equal(TESTER_VALID_JSON_EXAMPLE.includes('圣诞'), false, 'Generic syntax examples, no question-specific deliverable');
});

test('schema-valid reversed/disabled mappings remain semantic counterexamples, not automatic acceptance or changed Gate', () => {
  const reversed = { ...scene, mappings: { openPalm: 'gather', closedFist: 'scatter', palmX: 'none' } };
  assert.equal(cameraSceneCodeSchema.safeParse({ scene: reversed }).success, true, 'Schema defines platform possibilities, not authority to override user requirements');
  for (const phase of ['product', 'research', 'think-design', 'acceptance', 'implement', 'repair-2', 'feedback-2']) {
    const rubric = productionPhaseRubric(phase, 'camera-scene-v1')!;
    for (const dimension of Object.values(rubric.dimensions)) {
      assert.match(dimension, /Preserve ALL explicit goal\/acceptance constraints/);
      assert.match(dimension, /Schema enums never authorize optionalizing, reversing, disabling \(none\) or omitting required behavior/);
      assert.match(dimension, /unsupported requirements block, never silently weaken the goal/);
    }
    assert.equal(rubric.minimumOrdinalScore, 3);
  }
  const rejection = { decision: 'abstain', selectedCandidateId: null, scores: [{ candidateId: 'reversed', score: 1, reason: 'Explicit test oracle: reversing required actions and disabling rotation violates the supplied business acceptance.' }], reason: 'Injection is a counterexample, not proof of model judgment accuracy' };
  assert.equal(parseVerifiedDecision(rejection, ['reversed']).decision, 'abstain');
  assert.throws(() => parseVerifiedDecision({ ...rejection, decision: 'accept', selectedCandidateId: 'reversed' }, ['reversed']));
  assert.throws(() => parseVerifiedDecision({ ...rejection, decision: 'accept', selectedCandidateId: 'old-id', scores: [{ candidateId: 'old-id', score: 5, reason: 'Fake cached result' }] }, ['reversed']));
  assert.throws(() => parseVerifiedDecision({ ...rejection, decision: 'accept', selectedCandidateId: 'reversed', scores: [{ candidateId: 'reversed', score: 3, reason: 'Not highest' }, { candidateId: 'better', score: 4, reason: 'Higher' }] }, ['reversed', 'better']));
  assert.equal(productionPhaseRubric('developer'), null, 'Independent benchmark is not silently reinterpreted as a production phase');
});
