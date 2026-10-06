import { sha256 } from 'js-sha256';

export const HASH_ALGORITHM = 'sha256-canonical-json-v1';
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function fingerprint(value: unknown) { return sha256(canonicalJson(value)); }
