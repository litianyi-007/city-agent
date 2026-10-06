import { sha256 } from 'js-sha256';

/** The shared evidence code only needs synchronous SHA-256, not Node's crypto runtime. */
export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error('Only SHA-256 is supported');
  const hash = sha256.create();
  const adapter = {
    update(value: string) { hash.update(value); return adapter; },
    digest(format: string) { if (format !== 'hex') throw new Error('Only hexadecimal digests are supported'); return hash.hex(); },
  };
  return adapter;
}
