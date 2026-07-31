import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const installed = Symbol.for('affetta.runtimeDiagnosticsInstalled');

function defaultDataDir() {
  return path.resolve(process.env.AFFETTA_DATA_DIR || path.join(process.cwd(), 'data'));
}

export function normalizeError(error, depth = 0) {
  if (depth > 4) return null;
  if (error == null) return null;
  if (typeof error !== 'object') return { message: String(error) };
  const result = {
    name: error.name || null,
    message: error.message || String(error),
    code: error.code ?? null,
    errno: error.errno ?? null,
    syscall: error.syscall ?? null,
    address: error.address ?? null,
    port: error.port ?? null,
    exit_code: error.exitCode ?? error.exit_code ?? null,
    signal: error.signal ?? null,
    stack: error.stack || null
  };
  if (error.cause && error.cause !== error) result.cause = normalizeError(error.cause, depth + 1);
  return result;
}

export function appendDiagnostic(event, details = {}, { dataDir = defaultDataDir(), file = 'runtime-diagnostics.jsonl' } = {}) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      pid: process.pid,
      ppid: process.ppid,
      platform: process.platform,
      node: process.version,
      hostname: os.hostname(),
      ...details
    });
    fs.appendFileSync(path.join(dataDir, file), `${line}\n`, 'utf8');
    return true;
  } catch (error) {
    try { process.stderr.write(`[Affetta diagnostics] ${event}: ${error.message}\n`); } catch {}
    return false;
  }
}

export function installProcessDiagnostics({ dataDir = defaultDataDir() } = {}) {
  if (process[installed]) return;
  process[installed] = true;

  process.on('uncaughtExceptionMonitor', (error, origin) => {
    appendDiagnostic('process_uncaught_exception', { origin, error: normalizeError(error) }, { dataDir, file: 'process-crash.jsonl' });
  });

  process.on('unhandledRejection', (reason, promise) => {
    appendDiagnostic('process_unhandled_rejection', {
      error: normalizeError(reason),
      promise: String(promise)
    }, { dataDir, file: 'process-crash.jsonl' });
  });

  process.on('warning', (warning) => {
    appendDiagnostic('process_warning', { warning: normalizeError(warning) }, { dataDir });
  });

  process.on('exit', (code) => {
    appendDiagnostic('process_exit', { code, uptime_seconds: process.uptime(), memory: process.memoryUsage() }, { dataDir, file: 'process-crash.jsonl' });
  });

  appendDiagnostic('process_diagnostics_installed', {
    argv: process.argv,
    cwd: process.cwd(),
    exec_path: process.execPath,
    memory: process.memoryUsage()
  }, { dataDir });
}
