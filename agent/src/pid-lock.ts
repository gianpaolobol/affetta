import fs from 'node:fs';
import path from 'node:path';
import { AgentError } from './errors.js';

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string })?.code === 'EPERM';
  }
}

export class PidLock {
  private released = false;

  private constructor(private readonly file: string, private readonly pid: number) {}

  static acquire(file: string, pid = process.pid): PidLock {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const descriptor = fs.openSync(file, 'wx', 0o600);
        try { fs.writeFileSync(descriptor, `${pid}\n`, 'utf8'); }
        finally { fs.closeSync(descriptor); }
        return new PidLock(file, pid);
      } catch (error) {
        if ((error as { code?: string })?.code !== 'EEXIST') throw error;
        const existing = Number.parseInt(fs.readFileSync(file, 'utf8').trim(), 10);
        if (processExists(existing)) {
          throw new AgentError('agent_already_running', `Un altro Affetta Agent è già attivo con PID ${existing}.`, {
            stage: 'startup',
            details: { pid: existing }
          });
        }
        fs.rmSync(file, { force: true });
      }
    }
    throw new AgentError('pid_lock_failed', 'Impossibile acquisire il lock di processo dell’Agent.', { stage: 'startup' });
  }

  release(): void {
    if (this.released) return;
    this.released = true;
    try {
      const current = Number.parseInt(fs.readFileSync(this.file, 'utf8').trim(), 10);
      if (current === this.pid) fs.rmSync(this.file, { force: true });
    } catch (error) {
      if ((error as { code?: string })?.code !== 'ENOENT') throw error;
    }
  }
}
