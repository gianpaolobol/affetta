import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { canonicalJson } from './canonical-json.js';

export function sha256Buffer(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256Json(value: unknown): string {
  return sha256Buffer(canonicalJson(value));
}

export async function sha256File(file: string): Promise<{ sha256: string; size_bytes: number }> {
  const hash = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    hash.update(buffer);
  }
  return { sha256: hash.digest('hex'), size_bytes: size };
}
