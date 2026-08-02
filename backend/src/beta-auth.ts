import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { BackendError } from './errors.js';

function derive(password: string, salt: Buffer, bytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, bytes, { maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}
const KEY_BYTES = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES);
  return `scrypt$v1$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt' || parts[1] !== 'v1') return false;
  try {
    const salt = Buffer.from(parts[2]!, 'base64url');
    const expected = Buffer.from(parts[3]!, 'base64url');
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
    const actual = await derive(password, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateEmail(value: string): string {
  const email = normalizeEmail(value);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BackendError('invalid_email', 'Indirizzo email non valido.', { statusCode: 422, details: { field: 'email' } });
  }
  return email;
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function validateUsername(value: string): string {
  const username = normalizeUsername(value);
  if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username)) {
    throw new BackendError('invalid_username', 'Username non valido.', {
      statusCode: 422,
      details: { field: 'username', rule: '3-32 caratteri: lettere minuscole, numeri, punto, trattino o underscore.' }
    });
  }
  return username;
}

export function validatePhoneE164(value: string): string {
  const phone = value.trim();
  if (!/^\+[1-9][0-9]{7,14}$/.test(phone)) {
    throw new BackendError('invalid_phone', 'Numero di cellulare non valido. Usare il formato internazionale, ad esempio +393331234567.', {
      statusCode: 422,
      details: { field: 'phone_e164' }
    });
  }
  return phone;
}
