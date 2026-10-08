import { createHash } from 'node:crypto';
import { z } from 'zod';

export const PM_OUTPUT_POLICY_VERSION = 'production-pm-output-policy-v1' as const;
export const ROLE_SCHEMA_DIAGNOSTICS_VERSION = 'production-role-schema-diagnostics-v1' as const;
export const ROLE_SCHEMA_DIAGNOSTIC_LIMITS = Object.freeze({ rawBytes: 262144, nodes: 10000, depth: 16, issues: 8 });

type JsonSchema = Record<string, unknown>;
export interface PmOutputPolicy {
  readonly version: typeof PM_OUTPUT_POLICY_VERSION;
  readonly phase: string;
  readonly outputContractHash: string;
  readonly root: { readonly allowedFields: readonly string[]; readonly requiredFields: readonly string[]; readonly additionalProperties: false };
  readonly designDefaultFields: readonly string[];
}
export interface RoleSchemaBinding {
  readonly role: 'project-manager';
  readonly phase: string;
  readonly callId: string;
  readonly candidateId: string;
  readonly outputContractHash: string;
}
export type RoleSchemaIssueCode = 'invalid_type' | 'invalid_value' | 'too_small' | 'too_big' | 'unrecognized_keys' | 'invalid_format' | 'not_multiple_of' | 'invalid_union' | 'invalid_key' | 'invalid_element' | 'custom' | 'other';
export interface RoleSchemaDiagnostic extends RoleSchemaBinding {
  readonly version: typeof ROLE_SCHEMA_DIAGNOSTICS_VERSION;
  readonly kind: 'schema-structure' | 'resource-limit';
  /** Exact complete supplied, already-redacted source encoded as UTF-8. */
  readonly sourceSha256: string;
  readonly issueCount: number;
  readonly issues: readonly { readonly code: RoleSchemaIssueCode; readonly path: string; readonly unknownKeyCount?: number }[];
  readonly truncated: boolean;
  readonly resource?: 'raw-bytes' | 'nodes' | 'depth';
}

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
const fieldPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}(?![\s\S])/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![\s\S])/i;
const issueCodes = new Set<string>(['invalid_type', 'invalid_value', 'too_small', 'too_big', 'unrecognized_keys', 'invalid_format', 'not_multiple_of', 'invalid_union', 'invalid_key', 'invalid_element', 'custom']);
function invalid(): never { throw new Error('Role output policy unavailable'); }
function object(value: unknown): value is JsonSchema { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function validPhase(phase: unknown): phase is string { return typeof phase === 'string' && (phase === 'think-design' || phase === 'acceptance-plan' || /^feedback-(?:0|[1-9]\d{0,5})(?![\s\S])/.test(phase)); }

/** Only host JSON Schema nodes are navigated. Arbitrary property names from a
 * rejected answer are never appended to a diagnostic path. */
function branches(node: JsonSchema, depth = 0): JsonSchema[] {
  if (depth > ROLE_SCHEMA_DIAGNOSTIC_LIMITS.depth) return [];
  const result = [node];
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    const values = node[key];
    if (Array.isArray(values)) for (const value of values) if (object(value)) result.push(...branches(value, depth + 1));
  }
  return result;
}
function children(nodes: JsonSchema[], segment: PropertyKey): JsonSchema[] {
  const result: JsonSchema[] = [];
  for (const root of nodes) for (const node of branches(root)) {
    if (typeof segment === 'string' && fieldPattern.test(segment) && object(node.properties) && Object.hasOwn(node.properties, segment)) {
      const child = node.properties[segment]; if (object(child)) result.push(child);
    } else if (typeof segment === 'number' && Number.isSafeInteger(segment) && segment >= 0 && node.type === 'array') {
      const child = Array.isArray(node.prefixItems) && segment < node.prefixItems.length ? node.prefixItems[segment] : node.items;
      if (object(child)) result.push(child);
    }
  }
  return result;
}
function safePath(schema: JsonSchema, source: readonly PropertyKey[]): string {
  let nodes = [schema]; let path = '$';
  for (const segment of source.slice(0, ROLE_SCHEMA_DIAGNOSTIC_LIMITS.depth)) {
    const next = children(nodes, segment);
    if (!next.length) break;
    path += typeof segment === 'number' ? '[]' : `.${String(segment)}`;
    nodes = next;
  }
  return path;
}
function mappingExists(schema: JsonSchema, path: string): boolean {
  let nodes = [schema];
  for (const part of path.split('.')) {
    const array = part.endsWith('[]'); const field = array ? part.slice(0, -2) : part;
    nodes = children(nodes, field);
    if (!nodes.length) return false;
    if (array) { nodes = children(nodes, 0); if (!nodes.length) return false; }
  }
  return nodes.some(node => branches(node).some(branch => branch.type === 'string'));
}

/** Navigation facts derived from this exact host output contract, not a new
 * schema, a fallback answer, or permission to fill unspecified required facts.
 * Phase matters: both ordinary planning and acceptance-plan use the PM role. */
export function pmOutputPolicy(phase: string, outputContract: { version: string; jsonSchema: Record<string, unknown> }): PmOutputPolicy {
  if (!validPhase(phase) || !object(outputContract) || typeof outputContract.version !== 'string' || !outputContract.version.length || !object(outputContract.jsonSchema)) return invalid();
  const schema = outputContract.jsonSchema;
  if (schema.type !== 'object' || schema.additionalProperties !== false || !object(schema.properties) || !Array.isArray(schema.required)) return invalid();
  const allowedFields = Object.keys(schema.properties);
  const requiredFields = schema.required;
  if (!allowedFields.length || allowedFields.length > 64 || allowedFields.some(field => !fieldPattern.test(field)) || requiredFields.some(field => typeof field !== 'string' || !allowedFields.includes(field)) || new Set(requiredFields).size !== requiredFields.length) return invalid();
  const designDefaultFields = phase === 'acceptance-plan'
    ? ['obligations[].scenario', 'obligations[].expected', 'groups[].checks[].setup', 'groups[].checks[].exercise', 'groups[].checks[].assertions']
    : ['summary', 'tasks[].description', 'risks[]'];
  if (!designDefaultFields.every(path => mappingExists(schema, path))) return invalid();
  let serialized: string;
  try { serialized = JSON.stringify(outputContract); } catch { return invalid(); }
  if (Buffer.byteLength(serialized, 'utf8') > 32768) return invalid();
  return Object.freeze({ version: PM_OUTPUT_POLICY_VERSION, phase, outputContractHash: hash(serialized), root: Object.freeze({ allowedFields: Object.freeze(allowedFields), requiredFields: Object.freeze([...requiredFields] as string[]), additionalProperties: false as const }), designDefaultFields: Object.freeze(designDefaultFields) });
}

function resourceLimit(value: unknown): RoleSchemaDiagnostic['resource'] | undefined {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }]; let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > ROLE_SCHEMA_DIAGNOSTIC_LIMITS.nodes) return 'nodes';
    if (item.depth > ROLE_SCHEMA_DIAGNOSTIC_LIMITS.depth) return 'depth';
    if (item.value && typeof item.value === 'object') {
      // JSON.parse produces only ordinary data; no accessors, symbols or
      // provider-controlled object methods are invoked by this walk.
      for (const child of Object.values(item.value)) {
        if (pending.length + nodes >= ROLE_SCHEMA_DIAGNOSTIC_LIMITS.nodes) return 'nodes';
        pending.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  return undefined;
}
function bindingFields(binding: RoleSchemaBinding): RoleSchemaBinding {
  if (!binding || binding.role !== 'project-manager' || !validPhase(binding.phase) || typeof binding.callId !== 'string' || !uuidPattern.test(binding.callId) || typeof binding.candidateId !== 'string' || !uuidPattern.test(binding.candidateId) || typeof binding.outputContractHash !== 'string' || !/^[0-9a-f]{64}(?![\s\S])/.test(binding.outputContractHash)) return invalid();
  return { role: binding.role, phase: binding.phase, callId: binding.callId, candidateId: binding.candidateId, outputContractHash: binding.outputContractHash };
}

/** Optional explanation only: undefined never means a candidate is accepted.
 * The caller must redact first and still use the original actual schema/Gate.
 * Full JSON parsing matches the existing complete-fence grammar; no prefix
 * extraction, candidate mutation, normalization, JSON repair or retry occurs. */
export function diagnoseRoleSchema(raw: string, schema: z.ZodType, binding: RoleSchemaBinding): RoleSchemaDiagnostic | undefined {
  const fields = bindingFields(binding);
  if (typeof raw !== 'string') return undefined;
  const base = { version: ROLE_SCHEMA_DIAGNOSTICS_VERSION, ...fields, sourceSha256: hash(raw) };
  const limited = (resource: NonNullable<RoleSchemaDiagnostic['resource']>): RoleSchemaDiagnostic => Object.freeze({ ...base, kind: 'resource-limit', issueCount: 0, issues: Object.freeze([]), truncated: false, resource });
  if (raw.length > ROLE_SCHEMA_DIAGNOSTIC_LIMITS.rawBytes || Buffer.byteLength(raw, 'utf8') > ROLE_SCHEMA_DIAGNOSTIC_LIMITS.rawBytes) return limited('raw-bytes');
  let value: unknown;
  try { const trimmed = raw.trim(); const body = /^```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(trimmed)?.[1] ?? trimmed; value = JSON.parse(body); }
  catch { return undefined; }
  const resource = resourceLimit(value); if (resource) return limited(resource);
  let parsed: ReturnType<typeof schema.safeParse>; let jsonSchema: JsonSchema;
  try {
    parsed = schema.safeParse(value);
    if (parsed.success) return undefined;
    jsonSchema = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input', cycles: 'throw', reused: 'inline', unrepresentable: 'throw', metadata: z.registry() });
  } catch { return undefined; }
  const issues = parsed.error.issues.slice(0, ROLE_SCHEMA_DIAGNOSTIC_LIMITS.issues).map(issue => Object.freeze({
    code: (issueCodes.has(issue.code) ? issue.code : 'other') as RoleSchemaIssueCode,
    path: safePath(jsonSchema, issue.path),
    ...(issue.code === 'unrecognized_keys' ? { unknownKeyCount: issue.keys.length } : {}),
  }));
  return Object.freeze({ ...base, kind: 'schema-structure', issueCount: parsed.error.issues.length, issues: Object.freeze(issues), truncated: parsed.error.issues.length > issues.length });
}
