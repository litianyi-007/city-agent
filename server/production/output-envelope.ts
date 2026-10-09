import { createHash } from 'node:crypto';
import { types } from 'node:util';

export const OUTPUT_ENVELOPE_VERSION = 'production-output-envelope-v1' as const;
export const OUTPUT_ENVELOPE_INSTRUCTIONS = 'outputEnvelope：宿主按实际outputContract派生的导航，非schema/答案/通过。仅内部自检：一个完整JSON根对象；字符串数组逐项双引号成对，引号/反斜杠/控制字符正确转义；全部required后才闭根，勿提前闭根/追加尾字段。只用allowedFields/itemObject，无metadata/note/自检/额外字段；合法空必需数组保留。短句去重不删原需求/事实/约束/unknowns。导航非合法/覆盖证明；完整契约、实际schema及冻结Gate仍必需。不解析/修JSON/删字段/预填答案/加调用/放宽预算。' as const;
export const OUTPUT_ENVELOPE_LIMITS = Object.freeze({ contractBytes: 32768, nodes: 10000, depth: 16, fields: 64, fieldNameCharacters: 64 });

export type OutputEnvelopeRole = 'researcher' | 'project-manager';
export interface OutputEnvelopeObject {
  readonly allowedFields: readonly string[];
  readonly requiredFields: readonly string[];
  readonly additionalProperties: false;
}
export type OutputEnvelopeArray =
  | { readonly path: string; readonly itemType: 'string' }
  | { readonly path: string; readonly itemType: 'object'; readonly itemObject: OutputEnvelopeObject };
export interface OutputEnvelopePolicy {
  readonly version: typeof OUTPUT_ENVELOPE_VERSION;
  readonly role: OutputEnvelopeRole;
  readonly phase: string;
  readonly outputContractHash: string;
  readonly root: OutputEnvelopeObject;
  /** Host-schema paths only. [] denotes an item, never a candidate index. */
  readonly arrays: readonly OutputEnvelopeArray[];
}

type JsonObject = Record<string, unknown>;
const fieldPattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}(?![\s\S])/;
const unsupportedKeywords = ['\u0024ref', '\u0024dynamicRef', '\u0024defs', 'definitions', 'anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else', 'patternProperties', 'propertyNames', 'dependentSchemas', 'dependentRequired', 'dependencies', 'unevaluatedProperties', 'unevaluatedItems', 'prefixItems', 'additionalItems', 'contains'];
const scalarTypes = new Set(['string', 'number', 'integer', 'boolean', 'null']);
function reject(): never { throw new Error('Output envelope unavailable'); }
function object(value: unknown): value is JsonObject { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function phaseAllowed(role: unknown, phase: unknown): role is OutputEnvelopeRole {
  return typeof phase === 'string' && (role === 'researcher' ? phase === 'research' : role === 'project-manager' && (phase === 'think-design' || phase === 'acceptance-plan' || /^feedback-(?:0|[1-9]\d{0,5})(?![\s\S])/.test(phase)));
}

/** Validate plain host JSON before accessing values or serializing it. A
 * getter, Proxy, toJSON method, cycle or non-JSON value cannot run here. */
function assertHostJson(value: unknown): void {
  let nodes = 0; let bytes = 0;
  const ancestors = new Set<object>();
  const addString = (text: string) => { bytes += Buffer.byteLength(text, 'utf8'); if (bytes > OUTPUT_ENVELOPE_LIMITS.contractBytes) reject(); };
  const visit = (item: unknown, depth: number, jsonSchemaRoot = false): void => {
    if (++nodes > OUTPUT_ENVELOPE_LIMITS.nodes || depth > OUTPUT_ENVELOPE_LIMITS.depth) reject();
    if (typeof item === 'string') { addString(item); return; }
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item !== 'object' || types.isProxy(item) || ancestors.has(item)) return reject();
    const array = Array.isArray(item); const prototype = Object.getPrototypeOf(item);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) reject();
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > OUTPUT_ENVELOPE_LIMITS.nodes) reject();
    ancestors.add(item);
    for (const key of keys) {
      if (typeof key !== 'string') reject();
      if (array && key === 'length') continue;
      const descriptor = descriptors[key]!;
      if (!Object.hasOwn(descriptor, 'value')) reject();
      if (!descriptor.enumerable) {
        // Zod adds this exporter adapter only to the JSON Schema root. It is
        // not serialized contract data. Do not even read its descriptor value;
        // all accessors and every other hidden/nested property still reject.
        if (jsonSchemaRoot && key === '~standard') continue;
        reject();
      }
      if (array && !/^(0|[1-9]\d*)(?![\s\S])/.test(key)) reject();
      addString(key); visit(descriptor.value, depth + 1, depth === 0 && key === 'jsonSchema');
    }
    if (array && keys.length !== (item as unknown[]).length + 1) reject();
    ancestors.delete(item);
  };
  visit(value, 0);
}

function objectFields(schema: JsonObject): OutputEnvelopeObject {
  if (schema.type !== 'object' || schema.additionalProperties !== false || !object(schema.properties) || !Array.isArray(schema.required)) return reject();
  const allowedFields = Object.keys(schema.properties);
  const requiredFields = schema.required;
  if (!allowedFields.length || allowedFields.length > OUTPUT_ENVELOPE_LIMITS.fields || allowedFields.some(field => !fieldPattern.test(field))
    || requiredFields.some(field => typeof field !== 'string' || !allowedFields.includes(field)) || new Set(requiredFields).size !== requiredFields.length) return reject();
  return Object.freeze({ allowedFields: Object.freeze(allowedFields), requiredFields: Object.freeze([...requiredFields] as string[]), additionalProperties: false as const });
}

/** Only homogeneous string/object arrays and closed object/scalar nodes are
 * represented. Unsupported schema constructs fail closed, not flattened into
 * a permissive summary. Annotations/defaults/enums are hashed, never copied. */
function navigate(schema: unknown, path: string, arrays: OutputEnvelopeArray[]): void {
  if (!object(schema) || unsupportedKeywords.some(key => Object.hasOwn(schema, key))) return reject();
  if (schema.type === 'object') {
    const fields = objectFields(schema); const properties = schema.properties as JsonObject;
    for (const field of fields.allowedFields) navigate(properties[field], path ? `${path}.${field}` : field, arrays);
  } else if (schema.type === 'array') {
    if (!object(schema.items) || schema.items.type !== 'string' && schema.items.type !== 'object') return reject();
    const itemType = schema.items.type;
    arrays.push(itemType === 'string'
      ? Object.freeze({ path, itemType })
      : Object.freeze({ path, itemType, itemObject: objectFields(schema.items) }));
    navigate(schema.items, `${path}[]`, arrays);
  } else if (typeof schema.type !== 'string' || !scalarTypes.has(schema.type)) return reject();
}

/** Schema-derived navigation only. Never receives, parses, repairs, validates
 * or generates a candidate; adoption is restricted by the caller to opt-in
 * grouped production. The complete contract hash uses its original JSON order. */
export function outputEnvelopePolicy(role: OutputEnvelopeRole, phase: string, outputContract: { version: string; jsonSchema: Record<string, unknown> }): OutputEnvelopePolicy {
  if (!phaseAllowed(role, phase)) return reject();
  assertHostJson(outputContract);
  if (!object(outputContract) || Object.keys(outputContract).length !== 2 || !Object.hasOwn(outputContract, 'version') || !Object.hasOwn(outputContract, 'jsonSchema')
    || typeof outputContract.version !== 'string' || outputContract.version.length < 1 || outputContract.version.length > 128 || !object(outputContract.jsonSchema)) return reject();
  const serialized = JSON.stringify(outputContract);
  if (Buffer.byteLength(serialized, 'utf8') > OUTPUT_ENVELOPE_LIMITS.contractBytes) return reject();
  const root = objectFields(outputContract.jsonSchema); const arrays: OutputEnvelopeArray[] = [];
  navigate(outputContract.jsonSchema, '', arrays);
  const facts = Object.freeze({ version: OUTPUT_ENVELOPE_VERSION, role, phase, outputContractHash: createHash('sha256').update(serialized, 'utf8').digest('hex'), root, arrays: Object.freeze(arrays) });
  if (Buffer.byteLength(JSON.stringify(facts), 'utf8') > OUTPUT_ENVELOPE_LIMITS.contractBytes) return reject();
  return facts;
}
