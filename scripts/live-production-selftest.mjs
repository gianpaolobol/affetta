import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from '../src/env.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFile(path.join(root, '.env'));

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const port = Number(process.env.AFFETTA_PORT || 8787);
const baseUrl = `http://127.0.0.1:${port}`;
const expectedVersion = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const onlyRoute = argument('--route');
const repeat = Math.max(1, Number(argument('--repeat', '1')) || 1);
const sequenceRepeat = Math.max(1, Number(argument('--sequence-repeat', String(repeat))) || repeat);
const pollMs = Math.max(500, Number(argument('--poll-ms', '1000')) || 1000);
const maxPolls = Math.max(1, Number(argument('--max-polls', '900')) || 900);
const transportRetries = Math.max(1, Number(argument('--transport-retries', '3')) || 3);
const reportPath = path.resolve(argument('--report', path.join(root, 'data', 'live-production-selftest.json')));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const routeCatalog = [
  { id: 'prusa', printer_id: 'prusa-mk4' },
  { id: 'marlin', printer_id: 'generic-reprap-marlin' },
  { id: 'orca', printer_id: 'bambu-x1c' },
  { id: 'snapmaker', printer_id: 'snapmaker-u1' }
];
const selectedRoutes = onlyRoute ? routeCatalog.filter((route) => route.id === onlyRoute) : routeCatalog;
if (!selectedRoutes.length) {
  console.error(`Route sconosciuta: ${onlyRoute}`);
  process.exit(2);
}
const cycles = onlyRoute ? repeat : sequenceRepeat;

function errorDetails(error, depth = 0) {
  if (depth > 4 || error == null) return null;
  if (typeof error !== 'object') return { message: String(error) };
  return {
    name: error.name || null,
    message: error.message || String(error),
    code: error.code ?? null,
    errno: error.errno ?? null,
    syscall: error.syscall ?? null,
    address: error.address ?? null,
    port: error.port ?? null,
    status: error.status ?? null,
    stack: error.stack || null,
    cause: error.cause && error.cause !== error ? errorDetails(error.cause, depth + 1) : null
  };
}

function allErrorCodes(error) {
  const codes = [];
  let current = error;
  for (let depth = 0; current && depth < 6; depth++) {
    if (current.code) codes.push(String(current.code));
    current = current.cause;
  }
  return codes;
}

function isTransportError(error) {
  if (!error || error.code === 'http_error' || error.code === 'job_failed') return false;
  const codes = allErrorCodes(error);
  const transportCodes = new Set([
    'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ETIMEDOUT', 'ENETRESET', 'ENETUNREACH',
    'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT',
    'UND_ERR_BODY_TIMEOUT', 'UND_ERR_ABORTED'
  ]);
  return error.name === 'TypeError' || error.name === 'AbortError' || error.name === 'TimeoutError' || codes.some((code) => transportCodes.has(code));
}

function persist(report) {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  const temp = `${reportPath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, reportPath);
}

function readServerPid() {
  try {
    const value = Number(fs.readFileSync(path.join(root, 'data', 'affetta.pid'), 'utf8').trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch { return null; }
}

function pidAlive(pid) {
  if (!pid) return null;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function probeServerAlive({ attempts = 2 } = {}) {
  const pid = readServerPid();
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now();
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
      const text = await response.text();
      let data = null;
      try { data = JSON.parse(text); } catch {}
      return {
        alive: response.ok && data?.service === 'affetta',
        attempt,
        status: response.status,
        duration_ms: Date.now() - startedAt,
        process_id: data?.process_id || pid,
        pid_file_alive: pidAlive(pid),
        health: data
      };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(200 * attempt);
    }
  }
  return {
    alive: false,
    process_id: pid,
    pid_file_alive: pidAlive(pid),
    error: errorDetails(lastError)
  };
}

async function readResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 4000) }; }
  return { text, data };
}

async function fetchJsonWithRetry({ url, options = {}, phase, phaseEntry, timeoutMs = 30_000, maxAttempts = transportRetries }) {
  phaseEntry.requests ||= [];
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const startedAt = Date.now();
    const request = {
      attempt,
      method: options.method || 'GET',
      url,
      started_at: new Date(startedAt).toISOString()
    };
    phaseEntry.requests.push(request);
    persist(report);
    try {
      const response = await fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(timeoutMs) });
      const { data } = await readResponse(response);
      Object.assign(request, {
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        status: response.status,
        ok: response.ok,
        request_id: response.headers.get('x-request-id')
      });
      if (!response.ok) {
        request.response = data;
        persist(report);
        throw Object.assign(new Error(`${response.status} ${JSON.stringify(data)}`), {
          code: 'http_error', status: response.status, phase, url, response: data
        });
      }
      persist(report);
      return { response, data };
    } catch (error) {
      lastError = error;
      Object.assign(request, {
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        ok: false,
        error: errorDetails(error),
        transport_error: isTransportError(error)
      });
      if (isTransportError(error)) {
        request.server_probe = await probeServerAlive();
      }
      persist(report);
      const canRetry = isTransportError(error) && attempt < maxAttempts && request.server_probe?.alive;
      if (!canRetry) {
        error.phase = phase;
        error.url = url;
        throw error;
      }
      await sleep(250 * attempt);
    }
  }
  lastError.phase = phase;
  throw lastError;
}

async function requestJson(url, options, phase, run, timeoutMs = 30_000) {
  const phaseEntry = { phase, url, method: options?.method || 'GET', started_at: new Date().toISOString(), requests: [] };
  run.phases.push(phaseEntry);
  persist(report);
  try {
    const result = await fetchJsonWithRetry({ url, options, phase, phaseEntry, timeoutMs });
    Object.assign(phaseEntry, { ok: true, completed_at: new Date().toISOString(), status: result.response.status });
    persist(report);
    return result;
  } catch (error) {
    Object.assign(phaseEntry, { ok: false, completed_at: new Date().toISOString(), error: errorDetails(error) });
    persist(report);
    throw error;
  }
}

async function poll(jobId, run) {
  const url = `${baseUrl}/api/v1/slice-jobs/${jobId}`;
  const phaseEntry = {
    phase: 'poll_job', url, job_id: jobId, started_at: new Date().toISOString(),
    poll_iterations: 0, requests: [], transport_recoveries: 0
  };
  run.phases.push(phaseEntry);
  persist(report);
  const startedAt = Date.now();
  for (let i = 0; i < maxPolls; i++) {
    await sleep(pollMs);
    phaseEntry.poll_iterations = i + 1;
    const beforeErrors = phaseEntry.requests.filter((item) => item.transport_error).length;
    try {
      const { data } = await fetchJsonWithRetry({ url, phase: 'poll_job', phaseEntry, timeoutMs: 15_000 });
      const afterErrors = phaseEntry.requests.filter((item) => item.transport_error).length;
      if (afterErrors > beforeErrors) phaseEntry.transport_recoveries += afterErrors - beforeErrors;
      phaseEntry.last_job_status = data?.job?.status || null;
      phaseEntry.last_job_phase = data?.job?.phase || null;
      phaseEntry.last_progress = data?.job?.progress ?? null;
      if (data.job.status === 'completed') {
        Object.assign(phaseEntry, { ok: true, completed_at: new Date().toISOString(), duration_ms: Date.now() - startedAt });
        persist(report);
        return data.job;
      }
      if (data.job.status === 'failed') {
        throw Object.assign(new Error(data.job.error?.message || 'Job fallito'), {
          code: 'job_failed', job_error: data.job.error, phase: 'poll_job'
        });
      }
      if ((i + 1) % 5 === 0) persist(report);
    } catch (error) {
      Object.assign(phaseEntry, {
        ok: false,
        completed_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
        error: errorDetails(error)
      });
      persist(report);
      error.phase = 'poll_job';
      throw error;
    }
  }
  Object.assign(phaseEntry, { ok: false, completed_at: new Date().toISOString(), duration_ms: Date.now() - startedAt });
  persist(report);
  throw Object.assign(new Error(`Timeout job ${jobId}`), { code: 'job_timeout', phase: 'poll_job' });
}

async function downloadArtifact(job, run) {
  const url = `${baseUrl}${job.artifact_url}`;
  const phaseEntry = { phase: 'download_artifact', url, job_id: job.id, started_at: new Date().toISOString(), requests: [] };
  run.phases.push(phaseEntry);
  persist(report);
  let lastError = null;
  for (let attempt = 1; attempt <= transportRetries; attempt++) {
    const startedAt = Date.now();
    const request = { attempt, method: 'GET', url, started_at: new Date(startedAt).toISOString() };
    phaseEntry.requests.push(request);
    persist(report);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      Object.assign(request, {
        completed_at: new Date().toISOString(), duration_ms: Date.now() - startedAt,
        status: response.status, ok: response.ok, bytes: bytes.length,
        request_id: response.headers.get('x-request-id')
      });
      if (!response.ok || bytes.length < 10_000) {
        throw Object.assign(new Error(`Artefatto G-code non valido (${response.status}, ${bytes.length} byte).`), {
          code: 'invalid_artifact', status: response.status, bytes: bytes.length, phase: 'download_artifact'
        });
      }
      Object.assign(phaseEntry, { ok: true, completed_at: new Date().toISOString(), bytes: bytes.length });
      persist(report);
      return bytes;
    } catch (error) {
      lastError = error;
      Object.assign(request, { completed_at: new Date().toISOString(), duration_ms: Date.now() - startedAt, ok: false, error: errorDetails(error), transport_error: isTransportError(error) });
      if (isTransportError(error)) request.server_probe = await probeServerAlive();
      persist(report);
      const canRetry = isTransportError(error) && attempt < transportRetries && request.server_probe?.alive;
      if (!canRetry) break;
      await sleep(300 * attempt);
    }
  }
  Object.assign(phaseEntry, { ok: false, completed_at: new Date().toISOString(), error: errorDetails(lastError) });
  persist(report);
  lastError.phase = 'download_artifact';
  throw lastError;
}

async function recoverJobAfterFailure(jobId) {
  if (!jobId) return null;
  await sleep(2500);
  const phaseEntry = { requests: [] };
  try {
    const { data } = await fetchJsonWithRetry({
      url: `${baseUrl}/api/v1/slice-jobs/${jobId}`,
      phase: 'recover_job_after_failure',
      phaseEntry,
      timeoutMs: 5000,
      maxAttempts: 2
    });
    return { reachable: true, job: data.job, requests: phaseEntry.requests };
  } catch (error) {
    return { reachable: false, error: errorDetails(error), requests: phaseEntry.requests };
  }
}

const report = {
  version: expectedVersion,
  generated_at: new Date().toISOString(),
  base_url: baseUrl,
  mode: onlyRoute ? 'single_route_repeat' : 'sequence_repeat',
  requested_route: onlyRoute || null,
  cycles,
  poll_ms: pollMs,
  max_polls: maxPolls,
  transport_retries: transportRetries,
  health: null,
  runs: [],
  routes: {},
  ok: false
};
persist(report);

let overallFailure = null;
try {
  const healthRun = { phases: [] };
  report.health_check = healthRun;
  const { data: health } = await requestJson(`${baseUrl}/api/v1/health`, {}, 'health', healthRun, 5000);
  report.health = health;
  if (health.version !== expectedVersion) throw Object.assign(new Error(`Server vecchio: health=${health.version}, atteso=${expectedVersion}`), { code: 'version_mismatch', phase: 'health' });
  if (!health.instance_id || health.instance_id !== process.env.AFFETTA_INSTANCE_ID) {
    throw Object.assign(new Error('Il server attivo non appartiene alla cartella Affetta corrente.'), { code: 'instance_mismatch', phase: 'health' });
  }
  report.server_process_id = health.process_id || readServerPid();
  report.server_cwd = health.cwd || null;
  report.server_exec_path = health.exec_path || null;
  persist(report);

  const model = fs.readFileSync(path.join(root, 'samples', 'cube20.stl')).toString('base64');
  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (const route of selectedRoutes) {
      const run = {
        cycle,
        route: route.id,
        printer_id: route.printer_id,
        started_at: new Date().toISOString(),
        job_id: null,
        phases: [],
        ok: false
      };
      report.runs.push(run);
      persist(report);
      const body = {
        filename: 'cube20.stl',
        file_base64: model,
        printer_id: route.printer_id,
        nozzle_mm: 0.4,
        material_id: 'pla',
        quality_id: 'standard',
        strength_id: 'standard',
        color_id: 'random',
        custom_color: null,
        quantity: 1,
        source: 'standalone-runtime-selftest',
        metadata: { test: 'live-production-0412', cycle, route: route.id }
      };
      try {
        const created = await requestJson(`${baseUrl}/api/v1/affetta-jobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-affetta-client': 'selftest-0412' },
          body: JSON.stringify(body)
        }, 'create_job', run, 30_000);
        run.job_id = created.data.job.id;
        const job = await poll(run.job_id, run);
        if (!job.result?.print_ready) {
          throw Object.assign(new Error('G-code non marcato come pronto per la stampa.'), { code: 'not_print_ready', phase: 'poll_job' });
        }
        const bytes = await downloadArtifact(job, run);
        const aliveAfterSuccess = await probeServerAlive();
        if (!aliveAfterSuccess.alive || (report.server_process_id && aliveAfterSuccess.process_id !== report.server_process_id)) {
          throw Object.assign(new Error('Il server non è rimasto vivo con lo stesso PID dopo il successo della route.'), {
            code: 'server_not_stable_after_success', phase: 'server_health_after_success'
          });
        }
        Object.assign(run, {
          ok: true,
          completed_at: new Date().toISOString(),
          gcode_bytes: bytes.length,
          time_seconds: job.result.time_seconds,
          filament_g: job.result.filament_g,
          print_ready: job.result.print_ready,
          server_alive_after_success: true,
          server_probe_after_success: aliveAfterSuccess
        });
        const routeAggregate = report.routes[route.id] || { printer_id: route.printer_id, attempts: 0, successes: 0, failures: 0, runs: [] };
        routeAggregate.attempts++;
        routeAggregate.successes++;
        routeAggregate.runs.push({ cycle, ok: true, job_id: run.job_id, gcode_bytes: bytes.length });
        report.routes[route.id] = routeAggregate;
        persist(report);
        console.log(`OK   ciclo ${cycle} ${route.id} -> ${route.printer_id} (${bytes.length} byte)`);
      } catch (error) {
        const alive = await probeServerAlive();
        const recoveredJob = await recoverJobAfterFailure(run.job_id);
        Object.assign(run, {
          ok: false,
          completed_at: new Date().toISOString(),
          phase: error.phase || 'unknown',
          error: errorDetails(error),
          server_alive_after_error: alive.alive,
          server_probe_after_error: alive,
          recovered_job_after_error: recoveredJob
        });
        const routeAggregate = report.routes[route.id] || { printer_id: route.printer_id, attempts: 0, successes: 0, failures: 0, runs: [] };
        routeAggregate.attempts++;
        routeAggregate.failures++;
        routeAggregate.runs.push({ cycle, ok: false, job_id: run.job_id, phase: run.phase, error: run.error, server_alive_after_error: alive.alive, recovered_job_status: recoveredJob?.job?.status || null });
        report.routes[route.id] = routeAggregate;
        report.failure = { route: route.id, cycle, phase: run.phase, job_id: run.job_id, error: run.error, server_alive_after_error: alive.alive, recovered_job_status: recoveredJob?.job?.status || null };
        persist(report);
        throw error;
      }
    }
  }

  report.ok = true;
  report.completed_at = new Date().toISOString();
  report.final_server_probe = await probeServerAlive();
  persist(report);
  console.log('COLLAUDO SERVER/APPLICAZIONE COMPLETATO CON SUCCESSO.');
} catch (error) {
  overallFailure = error;
  report.ok = false;
  report.completed_at = new Date().toISOString();
  report.error = errorDetails(error);
  report.final_server_probe = await probeServerAlive();
  persist(report);
  const phase = report.failure?.phase || error.phase || 'unknown';
  const route = report.failure?.route || 'health';
  const causeCode = allErrorCodes(error)[0] || error.code || 'unknown';
  console.error(`ERRORE ${route}/${phase}: ${error.message} (${causeCode})`);
  process.exitCode = 1;
}

if (!overallFailure) process.exitCode = 0;
