import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  assertLocalLoopback,
  buildJobRequest,
  chooseProductionGcodeTarget,
  normalizeBaseUrl,
  parseJsonEvents,
  readDotEnv,
  redact,
  safeReportPath,
  sessionSuffix,
  sha256Buffer
} from './lib.mjs';

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key?.startsWith('--')) continue;
    result[key.slice(2)] = argv[i + 1];
    i += 1;
  }
  return result;
}

async function requestJson(url, { method = 'GET', headers = {}, body, expected = [200] } = {}) {
  const response = await fetch(url, {
    method,
    headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; }
  catch { parsed = text; }
  if (!expected.includes(response.status)) {
    const error = new Error(`HTTP ${response.status} ${method} ${url}`);
    error.statusCode = response.status;
    error.responseBody = parsed;
    throw error;
  }
  return { status: response.status, headers: response.headers, body: parsed };
}

async function waitForJob(backendUrl, apiKey, jobId, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await requestJson(`${backendUrl}/v1/jobs/${encodeURIComponent(jobId)}`, {
      headers: { 'x-api-key': apiKey }
    });
    last = response.body;
    const status = last?.job?.status;
    if (['completed', 'failed', 'cancelled'].includes(status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const error = new Error(`Job ${jobId} non terminale entro ${timeoutMs} ms.`);
  error.job = last;
  throw error;
}

function runAgent({ agentDir, env, label, logDir, expectSuccess = true }) {
  return new Promise((resolve, reject) => {
    const entry = path.join(agentDir, 'dist', 'src', 'index.js');
    const child = spawn(process.execPath, [entry, '--once'], {
      cwd: agentDir,
      env: { ...process.env, ...env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on('data', (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.on('error', reject);
    child.on('close', (code) => {
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, `${label}.stdout.log`), stdout, 'utf8');
      fs.writeFileSync(path.join(logDir, `${label}.stderr.log`), stderr, 'utf8');
      const result = { code: code ?? -1, stdout, stderr, events: parseJsonEvents(`${stdout}\n${stderr}`) };
      const success = result.code === 0;
      if (success !== expectSuccess) {
        const error = new Error(`Esecuzione Agent '${label}' terminata con codice ${result.code}; atteso successo=${expectSuccess}.`);
        error.agentRun = result;
        reject(error);
      } else resolve(result);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoPath = path.resolve(args.repo || path.join(import.meta.dirname, '..', '..'));
  const agentDir = path.join(repoPath, 'agent');
  const backendEnvPath = path.resolve(args['backend-env'] || path.join(repoPath, 'backend', '.env'));
  const fixturePath = path.resolve(args.fixture || path.join(agentDir, 'p3-3', 'fixture-cube-10mm.stl'));
  const backendUrl = normalizeBaseUrl(args['backend-url'] || 'http://127.0.0.1:8790', 'backend URL');
  const localUrl = normalizeBaseUrl(args['local-url'] || 'http://127.0.0.1:8787', 'local URL');
  assertLocalLoopback(backendUrl, 'Backend P3.3');
  assertLocalLoopback(localUrl, 'Affetta locale');

  if (!fs.existsSync(backendEnvPath)) throw new Error(`Configurazione backend non trovata: ${backendEnvPath}`);
  if (!fs.existsSync(fixturePath)) throw new Error(`Fixture STL non trovata: ${fixturePath}`);
  if (!fs.existsSync(path.join(agentDir, 'dist', 'src', 'index.js'))) throw new Error('Build Agent mancante. Eseguire npm --prefix agent run build.');

  const backendEnv = readDotEnv(backendEnvPath);
  const apiKey = backendEnv.AFFETTA_BOOTSTRAP_API_KEY;
  const storageEndpoint = normalizeBaseUrl(backendEnv.S3_PUBLIC_ENDPOINT || 'http://127.0.0.1:9000', 'S3_PUBLIC_ENDPOINT');
  assertLocalLoopback(storageEndpoint, 'Storage P3.3');
  if (!apiKey) throw new Error('AFFETTA_BOOTSTRAP_API_KEY mancante in backend/.env.');

  const localApiKey = args['local-api-key'] || '';
  const localHeaders = localApiKey ? { authorization: `Bearer ${localApiKey}` } : {};
  const reportDir = path.join(agentDir, 'agent-data');
  const suffix = sessionSuffix();
  const sessionDir = path.resolve(args['data-dir'] || path.join(reportDir, `p3-3-session-${suffix}`));
  const reportPath = path.resolve(args.report || safeReportPath(reportDir));
  const logDir = path.join(sessionDir, 'orchestrator-logs');
  fs.mkdirSync(sessionDir, { recursive: true });

  const report = {
    tested_at: new Date().toISOString(),
    result: 'running',
    secrets_included: false,
    endpoints: { backend: backendUrl, local_affetta: localUrl, storage: storageEndpoint },
    checks: {},
    target: null,
    agent_id: null,
    job_id: null,
    artifact_id: null,
    output_artifact_id: null,
    session_data_retained: true
  };
  let agentId = null;
  let pairingCode = '';
  let completed = false;

  try {
    const ready = await requestJson(`${backendUrl}/readyz`);
    if (ready.body?.ok !== true) throw new Error('Backend non ready.');
    report.checks.backend_ready = 'ok';

    const [health, catalog, fleet, diagnostics] = await Promise.all([
      requestJson(`${localUrl}/api/v1/health`, { headers: localHeaders }),
      requestJson(`${localUrl}/api/v1/catalog`, { headers: localHeaders }),
      requestJson(`${localUrl}/api/v1/fleet`, { headers: localHeaders }),
      requestJson(`${localUrl}/api/v1/capabilities`, { headers: localHeaders })
    ]);
    if (health.body?.success !== true) throw new Error('Affetta locale non healthy.');
    report.checks.local_affetta = 'ok';

    const target = chooseProductionGcodeTarget({ catalog: catalog.body, fleet: fleet.body, diagnostics: diagnostics.body });
    report.target = target;
    report.checks.production_gcode_target = 'ok';

    const pairing = await requestJson(`${backendUrl}/v1/pairing-codes`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: { name: `P3.3 controlled ${suffix}`, ttl_seconds: 1800, max_uses: 1 },
      expected: [201]
    });
    pairingCode = pairing.body?.pairing_code;
    if (!pairingCode) throw new Error('Il backend non ha restituito un codice di pairing.');
    report.checks.one_time_pairing_code = 'ok';

    const fixture = fs.readFileSync(fixturePath);
    const inputSha = sha256Buffer(fixture);
    const filename = path.basename(fixturePath);
    const prepared = await requestJson(`${backendUrl}/v1/artifacts/prepare-upload`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey },
      body: { filename, format: 'stl', type: 'model', sha256: inputSha, size_bytes: fixture.length, media_type: 'model/stl' },
      expected: [201]
    });
    const upload = prepared.body?.upload;
    const artifact = prepared.body?.artifact;
    if (!artifact?.id || !upload?.url) throw new Error('Preparazione upload input incompleta.');
    report.artifact_id = artifact.id;

    const signedHost = new URL(upload.url).host.toLowerCase();
    if (signedHost !== new URL(storageEndpoint).host.toLowerCase()) throw new Error(`Host URL firmato inatteso: ${signedHost}`);
    const uploadResponse = await fetch(upload.url, {
      method: upload.method || 'PUT',
      headers: upload.headers || { 'content-type': 'model/stl' },
      body: fixture
    });
    if (!uploadResponse.ok) throw new Error(`Upload STL a MinIO fallito: HTTP ${uploadResponse.status}`);
    await requestJson(`${backendUrl}/v1/artifacts/${encodeURIComponent(artifact.id)}/upload-complete`, {
      method: 'POST', headers: { 'x-api-key': apiKey }, body: { sha256: inputSha, size_bytes: fixture.length }
    });
    report.checks.input_upload_verified = 'ok';

    const jobRequest = buildJobRequest({ artifact, sha256: inputSha, sizeBytes: fixture.length, target, suffix, filename });
    const created = await requestJson(`${backendUrl}/v1/jobs`, {
      method: 'POST', headers: { 'x-api-key': apiKey }, body: jobRequest, expected: [201]
    });
    const jobId = created.body?.job?.id;
    if (!jobId) throw new Error('Creazione job P3.3 priva di job_id.');
    report.job_id = jobId;
    report.checks.job_queued = 'ok';

    const commonAgentEnv = {
      AFFETTA_CLOUD_BASE_URL: backendUrl,
      AFFETTA_AGENT_NAME: `Affetta P3.3 Local ${suffix}`,
      AFFETTA_LOCAL_BASE_URL: localUrl,
      AFFETTA_LOCAL_API_KEY: localApiKey,
      AFFETTA_AGENT_DATA_DIR: sessionDir,
      AFFETTA_ARTIFACT_ALLOWED_HOSTS: new URL(storageEndpoint).host,
      AFFETTA_AGENT_ALLOW_INSECURE_HTTP: 'true',
      AFFETTA_AGENT_POLL_MS: '1000',
      AFFETTA_AGENT_HEARTBEAT_MS: '5000',
      AFFETTA_AGENT_LEASE_RENEW_MS: '5000',
      AFFETTA_HTTP_TIMEOUT_MS: '60000',
      AFFETTA_LOCAL_JOB_TIMEOUT_MS: '3600000',
      AFFETTA_MAX_DOWNLOAD_MB: '25'
    };

    const first = await runAgent({
      agentDir,
      env: { ...commonAgentEnv, AFFETTA_PAIRING_CODE: pairingCode },
      label: '01-pair-and-process',
      logDir
    });
    pairingCode = '';
    agentId = first.events.find((event) => event.event === 'agent_paired')?.agent_id || null;
    if (!agentId) throw new Error('agent_id non rilevato dai log del pairing.');
    report.agent_id = agentId;
    if (!first.events.some((event) => event.event === 'job_completed' && event.job_id === jobId)) {
      throw new Error('L’Agent non ha registrato job_completed per il job P3.3.');
    }
    report.checks.pair_heartbeat_lease_slice_upload = 'ok';

    const terminal = await waitForJob(backendUrl, apiKey, jobId);
    if (terminal.job?.status !== 'completed') {
      const error = new Error(`Job P3.3 terminato con stato ${terminal.job?.status}.`);
      error.job = terminal;
      throw error;
    }
    const resultArtifact = terminal.job?.result?.result?.artifacts?.[0];
    if (!resultArtifact?.sha256 || resultArtifact.format !== 'gcode') throw new Error('Risultato G-code verificato mancante.');
    report.output_artifact_id = resultArtifact.artifact_id;
    report.output_sha256 = resultArtifact.sha256;
    report.output_size_bytes = resultArtifact.size_bytes;
    report.events_count = Array.isArray(terminal.events) ? terminal.events.length : 0;
    report.checks.backend_completion_and_checksum = 'ok';

    const second = await runAgent({
      agentDir,
      env: { ...commonAgentEnv, AFFETTA_PAIRING_CODE: '' },
      label: '02-restart-no-duplicate',
      logDir
    });
    if (second.events.some((event) => event.event === 'agent_paired')) throw new Error('Il riavvio ha tentato un secondo pairing.');
    const afterRestart = await requestJson(`${backendUrl}/v1/jobs/${encodeURIComponent(jobId)}`, { headers: { 'x-api-key': apiKey } });
    const completedEvents = (afterRestart.body?.events || []).filter((event) => event.status === 'completed');
    if (afterRestart.body?.job?.status !== 'completed' || completedEvents.length !== 1) {
      throw new Error('Riavvio Agent non idempotente o job duplicato.');
    }
    report.checks.restart_without_duplicate = 'ok';

    await requestJson(`${backendUrl}/v1/agents/${encodeURIComponent(agentId)}/revoke`, {
      method: 'POST', headers: { 'x-api-key': apiKey }, body: {}
    });
    report.checks.agent_revoked = 'ok';

    const revokedRun = await runAgent({
      agentDir,
      env: { ...commonAgentEnv, AFFETTA_PAIRING_CODE: '' },
      label: '03-revocation-enforced',
      logDir,
      expectSuccess: false
    });
    const revokedObserved = revokedRun.events.some((event) => event.event === 'agent_revoked') ||
      revokedRun.events.some((event) => event.event === 'agent_fatal_error' && JSON.stringify(event).includes('agent_revoked'));
    if (!revokedObserved) throw new Error('Revoca backend non osservata dall’Agent.');
    report.checks.revocation_enforced = 'ok';

    completed = true;
    report.result = 'passed';
    report.completed_at = new Date().toISOString();
    fs.rmSync(sessionDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    report.session_data_retained = false;
  } catch (error) {
    report.result = 'failed';
    report.completed_at = new Date().toISOString();
    report.error = redact({
      message: error instanceof Error ? error.message : String(error),
      statusCode: error?.statusCode,
      responseBody: error?.responseBody,
      job: error?.job,
      agentRun: error?.agentRun ? { code: error.agentRun.code, events: error.agentRun.events } : undefined
    });
    if (agentId) {
      try {
        await requestJson(`${backendUrl}/v1/agents/${encodeURIComponent(agentId)}/revoke`, {
          method: 'POST', headers: { 'x-api-key': apiKey }, body: {}
        });
        report.cleanup_revoke = 'ok';
      } catch (cleanupError) {
        report.cleanup_revoke = `failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
    }
    throw error;
  } finally {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(redact(report), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(`P3.3 report: ${reportPath}`);
    if (completed) console.log('=== COLLAUDO CONTROLLATO AGENT P3.3 SUPERATO ===');
  }
}

main().catch((error) => {
  console.error(`ERRORE P3.3: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
