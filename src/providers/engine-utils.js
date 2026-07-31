import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendDiagnostic, normalizeError } from '../runtime-diagnostics.js';

const TAIL_LIMIT = 64 * 1024;

function appendTail(current, chunk, limit = TAIL_LIMIT) {
  const next = current + Buffer.from(chunk).toString('utf8');
  return next.length > limit ? next.slice(-limit) : next;
}

function safeWrite(fd, chunk) {
  if (fd == null) return;
  try { fs.writeSync(fd, chunk); } catch {}
}

function safeClose(fd) {
  if (fd == null) return;
  try { fs.closeSync(fd); } catch {}
}

export function runProcess(command, args, {
  cwd,
  timeoutMs = 10 * 60 * 1000,
  env = process.env,
  diagnosticDir = path.resolve(process.env.AFFETTA_DATA_DIR || 'data', 'engine-process'),
  diagnosticMetadata = {}
} = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const runId = `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${process.pid}-${randomUUID().slice(0, 8)}`;
    fs.mkdirSync(diagnosticDir, { recursive: true });
    const stdoutPath = path.join(diagnosticDir, `${runId}.stdout.log`);
    const stderrPath = path.join(diagnosticDir, `${runId}.stderr.log`);
    let stdoutFd = null;
    let stderrFd = null;
    try {
      stdoutFd = fs.openSync(stdoutPath, 'a');
      stderrFd = fs.openSync(stderrPath, 'a');
    } catch {}

    let child;
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeoutTimer = null;
    let killFallbackTimer = null;
    let exitEvent = null;

    const metadata = {
      ...diagnosticMetadata,
      run_id: runId,
      command,
      args,
      cwd: cwd || process.cwd(),
      timeout_ms: timeoutMs,
      stdout_path: stdoutPath,
      stderr_path: stderrPath,
      parent_memory: process.memoryUsage()
    };
    appendDiagnostic('engine_process_spawn_requested', metadata);

    const cleanup = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (killFallbackTimer) clearTimeout(killFallbackTimer);
      safeClose(stdoutFd);
      safeClose(stderrFd);
      stdoutFd = null;
      stderrFd = null;
    };

    const finishReject = (error, extra = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      Object.assign(error, {
        stdout,
        stderr,
        stdoutPath,
        stderrPath,
        command,
        args,
        cwd: cwd || process.cwd(),
        durationMs: Date.now() - startedAt,
        ...extra
      });
      appendDiagnostic('engine_process_failed', {
        ...metadata,
        child_pid: child?.pid || null,
        duration_ms: Date.now() - startedAt,
        timed_out: timedOut,
        exit_event: exitEvent,
        error: normalizeError(error),
        stdout_tail: stdout,
        stderr_tail: stderr
      });
      reject(error);
    };

    const finishResolve = (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const result = {
        stdout,
        stderr,
        code,
        signal,
        pid: child?.pid || null,
        durationMs: Date.now() - startedAt,
        stdoutPath,
        stderrPath
      };
      appendDiagnostic('engine_process_completed', {
        ...metadata,
        child_pid: result.pid,
        duration_ms: result.durationMs,
        exit_code: code,
        signal,
        stdout_tail: stdout,
        stderr_tail: stderr
      });
      resolve(result);
    };

    try {
      child = spawn(command, args, { cwd, shell: false, windowsHide: true, env });
    } catch (error) {
      const wrapped = Object.assign(error, { code: error.code === 'ENOENT' ? 'engine_not_found' : 'engine_start_failed' });
      finishReject(wrapped);
      return;
    }

    child.once('spawn', () => {
      appendDiagnostic('engine_process_spawned', { ...metadata, child_pid: child.pid });
    });

    child.stdout?.on('data', (chunk) => {
      safeWrite(stdoutFd, chunk);
      stdout = appendTail(stdout, chunk);
    });
    child.stderr?.on('data', (chunk) => {
      safeWrite(stderrFd, chunk);
      stderr = appendTail(stderr, chunk);
    });
    child.stdout?.on('error', (error) => {
      appendDiagnostic('engine_stdout_stream_error', { ...metadata, child_pid: child.pid, error: normalizeError(error) });
    });
    child.stderr?.on('error', (error) => {
      appendDiagnostic('engine_stderr_stream_error', { ...metadata, child_pid: child.pid, error: normalizeError(error) });
    });

    timeoutTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      appendDiagnostic('engine_process_timeout', { ...metadata, child_pid: child.pid });
      try { child.kill('SIGKILL'); } catch {}
      killFallbackTimer = setTimeout(() => {
        const error = Object.assign(new Error(`${path.basename(command)} ha superato il tempo massimo.`), {
          code: 'engine_timeout',
          exitCode: exitEvent?.code ?? null,
          signal: exitEvent?.signal ?? null
        });
        finishReject(error);
      }, 5000);
      killFallbackTimer.unref?.();
    }, timeoutMs);
    timeoutTimer.unref?.();

    child.once('error', (error) => {
      const wrapped = Object.assign(error, { code: error.code === 'ENOENT' ? 'engine_not_found' : 'engine_start_failed' });
      finishReject(wrapped);
    });

    child.once('exit', (code, signal) => {
      exitEvent = { code, signal, at: new Date().toISOString() };
      appendDiagnostic('engine_process_exit', { ...metadata, child_pid: child.pid, exit_code: code, signal });
    });

    child.once('close', (code, signal) => {
      if (settled) return;
      if (timedOut) {
        const error = Object.assign(new Error(`${path.basename(command)} ha superato il tempo massimo.`), {
          code: 'engine_timeout', exitCode: code, signal
        });
        finishReject(error);
      } else if (code === 0) {
        finishResolve(code, signal);
      } else {
        const detail = (stderr || stdout).slice(-2200);
        const error = Object.assign(new Error(`${path.basename(command)} terminato con codice ${code}${signal ? ` (${signal})` : ''}: ${detail}`), {
          code: 'engine_failed', exitCode: code, signal
        });
        finishReject(error);
      }
    });
  });
}

export function replaceTokens(parts, tokens) {
  return parts.map((part) => String(part).replace(/\{([a-z_]+)\}/g, (_, key) => tokens[key] ?? `{${key}}`));
}

export function findFileRecursive(root, basenames) {
  if (!root || !fs.existsSync(root)) return null;
  const wanted = new Set(basenames.map((name) => name.toLowerCase()));
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (wanted.has(entry.name.toLowerCase())) return full;
    }
  }
  return null;
}

export function listFilesRecursive(root, predicate) {
  const found = [];
  if (!root || !fs.existsSync(root)) return found;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (!predicate || predicate(full, entry.name)) found.push(full);
    }
  }
  return found;
}
