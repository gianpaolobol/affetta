import fs from 'node:fs';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SecretVault {
  private readonly key: Buffer;

  constructor(keyPath: string) {
    if (!fs.existsSync(keyPath)) {
      fs.writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    }
    const key = fs.readFileSync(keyPath);
    if (key.length !== 32) throw new Error('Chiave del vault non valida.');
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
  }

  decrypt(encoded: string): string {
    const [version, ivValue, tagValue, ciphertextValue] = encoded.split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue) throw new Error('Segreto cifrato non valido.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  }
}
