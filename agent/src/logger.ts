import fs from 'node:fs';
import path from 'node:path';
import type { AgentConfig } from './config.js';
import { nowIso } from './time.js';

const secretPattern = /(token|authorization|pairing|secret|password|api[_-]?key)/i;

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      secretPattern.test(key) ? '[REDACTED]' : redact(item)
    ]));
  }
  return value;
}

export class Logger {
  private readonly file: string;

  constructor(config: AgentConfig) {
    this.file = path.join(config.logDir, 'agent.jsonl');
  }

  log(level: 'debug' | 'info' | 'warn' | 'error', event: string, data: Record<string, unknown> = {}): void {
    const redacted = redact(data) as Record<string, unknown>;
    const row = JSON.stringify({ time: nowIso(), level, event, ...redacted });
    fs.appendFileSync(this.file, `${row}\n`, { encoding: 'utf8', mode: 0o600 });
    const method = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    method(row);
  }

  info(event: string, data: Record<string, unknown> = {}): void { this.log('info', event, data); }
  warn(event: string, data: Record<string, unknown> = {}): void { this.log('warn', event, data); }
  error(event: string, data: Record<string, unknown> = {}): void { this.log('error', event, data); }
  debug(event: string, data: Record<string, unknown> = {}): void { this.log('debug', event, data); }
}
