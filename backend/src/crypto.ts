import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IdFactory, TokenFactory } from './types.js';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function secureEqualHex(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export class DefaultIdFactory implements IdFactory {
  create(prefix: string): string {
    return `${prefix}_${randomUUID().replaceAll('-', '')}`;
  }
}

export class DefaultTokenFactory implements TokenFactory {
  create(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }
}
