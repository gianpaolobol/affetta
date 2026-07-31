import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function id(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function round(value, digits = 2) {
  const p = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * p) / p;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function safeFilename(name = 'model.stl') {
  const base = path.basename(String(name)).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return base || 'model.stl';
}

export function splitCommand(command) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) tokens.push(current), current = '';
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  if (h) return `${h} h ${m} min`;
  return `${Math.max(1, m)} min`;
}

export function atomicWriteJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.${randomUUID().slice(0, 8)}.tmp`;
  const content = JSON.stringify(value, null, 2);
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx');
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;

    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (error) {
        lastError = error;
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt === 5) break;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * (attempt + 1));
      }
    }
    throw lastError;
  } finally {
    if (fd != null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}
