import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import {
  assertLocalLoopback,
  chooseProductionGcodeTarget,
  normalizeBaseUrl,
  parseJsonEvents,
  readDotEnv,
  redact,
  sessionSuffix,
  sha256Buffer
} from '../../agent/p3-3/lib.mjs';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key?.startsWith('--')) continue;
    result[key.slice(2)] = argv[index + 1];
    index += 1;
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
    const error = new Error(`HTTP ${response.status} ${method} ${url}: ${parsed?.error?.code ?? ''} ${parsed?.error?.message ?? ''}`.trim());
    error.statusCode = response.status;
    error.responseBody = parsed;
    throw error;
  }
  return { status: response.status, headers: response.headers, body: parsed };
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
      if ((result.code === 0) !== expectSuccess) {
        const error = new Error(`Esecuzione Agent '${label}' terminata con codice ${result.code}; atteso successo=${expectSuccess}.`);
        error.agentRun = result;
        reject(error);
      } else resolve(result);
    });
  });
}

async function waitForBetaJob(backendUrl, authHeaders, jobId, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const response = await requestJson(`${backendUrl}/v1/beta/jobs/${encodeURIComponent(jobId)}`, { headers: authHeaders });
    last = response.body;
    const status = last?.job?.status;
    if (['completed', 'failed', 'cancelled', 'expired'].includes(status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const error = new Error(`Job beta ${jobId} non terminale entro ${timeoutMs} ms.`);
  error.job = last;
  throw error;
}

function registrationFor(suffix) {
  return {
    display_name: `P4.2 Test ${suffix}`,
    username: `p42.${suffix}`.slice(0, 32),
    email: `p42-${suffix}@local.invalid`,
    phone_e164: `+390${String(Date.now()).slice(-12)}`,
    password: `P4.2-test-${suffix}-Password!`,
    terms_accepted: true
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoPath = path.resolve(args.repo || path.join(import.meta.dirname, '..', '..'));
  const agentDir = path.join(repoPath, 'agent');
  const backendEnvPath = path.resolve(args['backend-env'] || path.join(repoPath, 'backend', '.env'));
  const fixturePath = path.resolve(args.fixture || path.join(agentDir, 'p3-3', 'fixture-cube-10mm.stl'));
  const backendUrl = normalizeBaseUrl(args['backend-url'] || 'http://127.0.0.1:8790', 'backend URL');
  const localUrl = normalizeBaseUrl(args['local-url'] || 'http://127.0.0.1:8787', 'local URL');
  const expectedDailyJobs = Number(args['expected-daily-jobs'] || 1);
  assertLocalLoopback(backendUrl, 'Backend P4.2');
  assertLocalLoopback(localUrl, 'Affetta locale P4.2');
  if (!Number.isInteger(expectedDailyJobs) || expectedDailyJobs < 1) throw new Error('expected-daily-jobs non valido.');
  if (!fs.existsSync(backendEnvPath)) throw new Error(`Configurazione backend non trovata: ${backendEnvPath}`);
  if (!fs.existsSync(fixturePath)) throw new Error(`Fixture STL non trovata: ${fixturePath}`);
  if (!fs.existsSync(path.join(agentDir, 'dist', 'src', 'index.js'))) throw new Error('Build Agent mancante.');

  const backendEnv = readDotEnv(backendEnvPath);
  const storageEndpoint = normalizeBaseUrl(backendEnv.S3_PUBLIC_ENDPOINT || 'http://127.0.0.1:9000', 'S3_PUBLIC_ENDPOINT');
  assertLocalLoopback(storageEndpoint, 'Storage P4.2');
  const localApiKey = args['local-api-key'] || '';
  const localHeaders = localApiKey ? { authorization: `Bearer ${localApiKey}` } : {};

  const suffix = sessionSuffix();
  const registration = registrationFor(suffix);
  const reportDir = path.resolve(args['report-dir'] || path.join(repoPath, 'backend', 'p4-2', 'reports'));
  const reportPath = path.join(reportDir, `p4-2-live-test-${new Date().toISOString().replace(/[-:.]/g, '')}.json`);
  const sessionDir = path.resolve(args['data-dir'] || path.join(agentDir, 'agent-data', `p4-2-session-${suffix}`));
  const logDir = path.join(sessionDir, 'orchestrator-logs');
  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(sessionDir, { recursive: true });

  const report = {
    tested_at: new Date().toISOString(), result: 'running', secrets_included: false,
    endpoints: { backend: backendUrl, local_affetta: localUrl, storage: storageEndpoint },
    checks: {}, account: { email: registration.email, username: registration.username },
    target_observed: null, agent_id: null, artifact_id: null, job_id: null,
    output: null, session_data_retained: true, completed_at: null, error: null
  };
  let accessToken = '';
  let agentId = null;
  let pairingCode = '';
  let success = false;

  try {
    const ready = await requestJson(`${backendUrl}/readyz`);
    if (ready.body?.ok !== true) throw new Error('Backend non ready.');
    report.checks.backend_ready = 'ok';

    const pageResponse = await fetch(`${backendUrl}/beta/`);
    const page = await pageResponse.text();
    if (!pageResponse.ok || !/\bid=["']file["']/.test(page) || !/\bid=["']jobs["']/.test(page)) {
      throw new Error('Pagina beta P4.2 assente o incompleta.');
    }
    report.checks.beta_browser_page = 'ok';

    const limits = await requestJson(`${backendUrl}/v1/beta/limits`);
    if (limits.body?.enforcement_stage !== 'enforced-p4.2' || limits.body?.daily_jobs !== expectedDailyJobs || limits.body?.max_agents !== 1) {
      throw new Error(`Limiti P4.2 inattesi: ${JSON.stringify(limits.body)}`);
    }
    report.limits = limits.body;
    report.checks.free_limits_live = 'ok';

    const [health, catalog, fleet, capabilities] = await Promise.all([
      requestJson(`${localUrl}/api/v1/health`, { headers: localHeaders }),
      requestJson(`${localUrl}/api/v1/catalog`, { headers: localHeaders }),
      requestJson(`${localUrl}/api/v1/fleet`, { headers: localHeaders }),
      requestJson(`${localUrl}/api/v1/capabilities`, { headers: localHeaders })
    ]);
    if (health.body?.success !== true) throw new Error('Affetta locale non healthy.');
    report.target_observed = chooseProductionGcodeTarget({ catalog: catalog.body, fleet: fleet.body, diagnostics: capabilities.body });
    report.checks.production_gcode_target_available = 'ok';

    const registered = await requestJson(`${backendUrl}/v1/beta/register`, { method: 'POST', body: registration, expected: [201] });
    const verificationToken = registered.body?.dev_verification_token;
    if (typeof verificationToken !== 'string' || verificationToken.length < 16) throw new Error('Token sviluppo verifica email non disponibile.');
    report.account.user_id = registered.body?.account?.user?.id ?? null;
    report.account.organization_id = registered.body?.account?.organization?.id ?? null;
    report.checks.registration = 'ok';

    await requestJson(`${backendUrl}/v1/beta/verify-email`, { method: 'POST', body: { token: verificationToken } });
    const login = await requestJson(`${backendUrl}/v1/beta/login`, {
      method: 'POST', body: { email: registration.email, password: registration.password }
    });
    accessToken = login.body?.access_token;
    if (typeof accessToken !== 'string' || accessToken.length < 16) throw new Error('Sessione beta non emessa.');
    const auth = { authorization: `Bearer ${accessToken}` };
    report.checks.verified_beta_session = 'ok';

    const pairing = await requestJson(`${backendUrl}/v1/beta/agents/pairing-code`, {
      method: 'POST', headers: auth, body: { name: `P4.2 browser ${suffix}`, ttl_seconds: 1800 }, expected: [201]
    });
    pairingCode = pairing.body?.pairing_code;
    if (typeof pairingCode !== 'string' || pairingCode.length < 8) throw new Error('Pairing beta monouso non emesso.');
    report.checks.beta_pairing_code = 'ok';

    const fixture = fs.readFileSync(fixturePath);
    const inputSha = sha256Buffer(fixture);
    const prepared = await requestJson(`${backendUrl}/v1/beta/artifacts/prepare-upload`, {
      method: 'POST', headers: auth, body: {
        filename: path.basename(fixturePath), format: 'stl', sha256: inputSha, size_bytes: fixture.length
      }, expected: [201]
    });
    const artifact = prepared.body?.artifact;
    const upload = prepared.body?.upload;
    if (!artifact?.id || !upload?.url) throw new Error('Preparazione upload beta incompleta.');
    report.artifact_id = artifact.id;
    if (new URL(upload.url).host.toLowerCase() !== new URL(storageEndpoint).host.toLowerCase()) {
      throw new Error('Host upload firmato diverso dallo storage loopback.');
    }
    const uploadResponse = await fetch(upload.url, {
      method: upload.method || 'PUT', headers: upload.headers || { 'content-type': 'model/stl' }, body: fixture
    });
    if (!uploadResponse.ok) throw new Error(`Upload beta firmato fallito: HTTP ${uploadResponse.status}`);
    await requestJson(`${backendUrl}/v1/beta/artifacts/${encodeURIComponent(artifact.id)}/upload-complete`, {
      method: 'POST', headers: auth, body: { sha256: inputSha, size_bytes: fixture.length }
    });
    report.checks.browser_style_signed_upload = 'ok';

    const idempotencyKey = `p4-2-${suffix}`;
    const jobBody = {
      artifact_id: artifact.id, idempotency_key: idempotencyKey,
      material_id: report.target_observed.material_id,
      quality_id: 'standard', strength_id: 'standard', color_id: report.target_observed.color_id,
      quantity: 1, nozzle_mm: report.target_observed.nozzle_mm
    };
    const created = await requestJson(`${backendUrl}/v1/beta/jobs`, {
      method: 'POST', headers: auth, body: jobBody, expected: [201]
    });
    const jobId = created.body?.job?.id;
    if (!jobId || created.body?.usage?.jobs_used !== 1) throw new Error('Job beta non creato o quota non incrementata.');
    report.job_id = jobId;
    report.checks.browser_job_created = 'ok';

    const replay = await requestJson(`${backendUrl}/v1/beta/jobs`, {
      method: 'POST', headers: auth, body: jobBody, expected: [200]
    });
    if (replay.body?.created !== false || replay.body?.usage?.jobs_used !== 1 || replay.body?.job?.id !== jobId) {
      throw new Error('Replay idempotente beta incoerente o conteggiato due volte.');
    }
    report.checks.idempotency_without_extra_quota = 'ok';

    const quotaBlocked = await requestJson(`${backendUrl}/v1/beta/jobs`, {
      method: 'POST', headers: auth, body: { ...jobBody, idempotency_key: `p4-2-block-${suffix}` }, expected: [429]
    });
    if (quotaBlocked.body?.error?.code !== 'free_daily_job_limit') throw new Error('Quota giornaliera Free non applicata realmente.');
    report.checks.daily_quota_enforced = 'ok';

    const oversize = await requestJson(`${backendUrl}/v1/beta/artifacts/prepare-upload`, {
      method: 'POST', headers: auth, body: {
        filename: 'oversize.stl', format: 'stl', sha256: 'a'.repeat(64), size_bytes: Number(limits.body.max_input_bytes) + 1
      }, expected: [413]
    });
    if (oversize.body?.error?.code !== 'free_input_size_limit') throw new Error('Limite dimensione Free non applicato.');
    report.checks.input_size_quota_enforced = 'ok';

    const commonAgentEnv = {
      AFFETTA_CLOUD_BASE_URL: backendUrl,
      AFFETTA_AGENT_NAME: `Affetta Beta P4.2 ${suffix}`,
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
      AFFETTA_MAX_DOWNLOAD_MB: '50'
    };

    const first = await runAgent({
      agentDir, env: { ...commonAgentEnv, AFFETTA_PAIRING_CODE: pairingCode },
      label: '01-beta-pair-and-process', logDir
    });
    pairingCode = '';
    agentId = first.events.find((event) => event.event === 'agent_paired')?.agent_id || null;
    report.agent_id = agentId;
    if (!agentId) throw new Error('agent_id beta non rilevato.');
    const failed = first.events.find((event) => event.event === 'job_failed' && event.job_id === jobId);
    if (failed) {
      const error = new Error(`Agent beta job_failed (${failed.error?.code ?? 'unknown'}): ${failed.error?.message ?? ''}`);
      error.agentRun = first;
      throw error;
    }
    if (!first.events.some((event) => event.event === 'job_completed' && event.job_id === jobId)) {
      const error = new Error('Agent beta non ha emesso job_completed.');
      error.agentRun = first;
      throw error;
    }
    report.checks.beta_agent_slice_and_upload = 'ok';

    const terminal = await waitForBetaJob(backendUrl, auth, jobId);
    if (terminal.job?.status !== 'completed' || terminal.job?.download_ready !== true) {
      const error = new Error(`Job beta terminale inatteso: ${terminal.job?.status}`);
      error.job = terminal;
      throw error;
    }
    report.checks.browser_polling_completion = 'ok';

    const downloadInfo = await requestJson(`${backendUrl}/v1/beta/jobs/${encodeURIComponent(jobId)}/download`, { headers: auth });
    const signedDownload = downloadInfo.body?.download;
    if (!signedDownload?.url) throw new Error('URL download firmato assente.');
    if (new URL(signedDownload.url).host.toLowerCase() !== new URL(storageEndpoint).host.toLowerCase()) {
      throw new Error('Host download firmato diverso dallo storage loopback.');
    }
    const outputResponse = await fetch(signedDownload.url, { method: signedDownload.method || 'GET', headers: signedDownload.headers || {} });
    if (!outputResponse.ok) throw new Error(`Download risultato fallito: HTTP ${outputResponse.status}`);
    const outputBytes = Buffer.from(await outputResponse.arrayBuffer());
    const outputSha = sha256Buffer(outputBytes);
    if (outputBytes.length !== downloadInfo.body.size_bytes || outputSha !== downloadInfo.body.sha256) {
      throw new Error('Checksum o dimensione del download non corrispondono al backend.');
    }
    report.output = {
      filename: downloadInfo.body.filename, sha256: outputSha, size_bytes: outputBytes.length,
      expires_at: downloadInfo.body.expires_at, format: terminal.job?.result?.output_format
    };
    report.checks.verified_signed_download = 'ok';

    const agents = await requestJson(`${backendUrl}/v1/beta/agents`, { headers: auth });
    if (agents.body?.agents?.length !== 1 || agents.body.agents[0]?.id !== agentId) throw new Error('Lista Agent beta incoerente.');
    const secondPairing = await requestJson(`${backendUrl}/v1/beta/agents/pairing-code`, {
      method: 'POST', headers: auth, body: {}, expected: [409]
    });
    if (secondPairing.body?.error?.code !== 'free_agent_limit') throw new Error('Limite di un Agent Free non applicato.');
    report.checks.one_agent_quota_enforced = 'ok';

    const restarted = await runAgent({
      agentDir, env: { ...commonAgentEnv, AFFETTA_PAIRING_CODE: '' },
      label: '02-beta-restart-no-duplicate', logDir
    });
    if (restarted.events.some((event) => event.event === 'agent_paired')) throw new Error('Riavvio Agent beta ha ripetuto il pairing.');
    const afterRestart = await requestJson(`${backendUrl}/v1/beta/jobs/${encodeURIComponent(jobId)}`, { headers: auth });
    const completedEvents = (afterRestart.body?.job?.events ?? []).filter((event) => event.status === 'completed');
    if (afterRestart.body?.job?.status !== 'completed' || completedEvents.length !== 1) {
      throw new Error('Riavvio Agent beta ha duplicato il completamento.');
    }
    report.checks.restart_without_duplicate = 'ok';

    await requestJson(`${backendUrl}/v1/beta/agents/${encodeURIComponent(agentId)}/revoke`, {
      method: 'POST', headers: auth, body: {}
    });
    const revokedRun = await runAgent({
      agentDir, env: { ...commonAgentEnv, AFFETTA_PAIRING_CODE: '' },
      label: '03-beta-revocation-enforced', logDir, expectSuccess: false
    });
    const revokedObserved = revokedRun.events.some((event) => event.event === 'agent_revoked') ||
      revokedRun.events.some((event) => event.event === 'agent_fatal_error' && JSON.stringify(event).includes('agent_revoked'));
    if (!revokedObserved) throw new Error('Revoca Agent beta non osservata dal processo Agent.');
    report.checks.beta_revocation_enforced = 'ok';

    const me = await requestJson(`${backendUrl}/v1/beta/me`, { headers: auth });
    if (me.body?.usage?.jobs_used !== 1 || me.body?.agents?.[0]?.revoked_at === null) {
      throw new Error('Profilo beta finale non riflette utilizzo o revoca.');
    }
    report.checks.account_usage_and_agent_state = 'ok';

    success = true;
    report.result = 'passed';
    report.completed_at = new Date().toISOString();
    fs.rmSync(sessionDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
    report.session_data_retained = false;
  } catch (error) {
    report.result = 'failed';
    report.completed_at = new Date().toISOString();
    report.error = redact({
      message: error instanceof Error ? error.message : String(error),
      statusCode: error?.statusCode, responseBody: error?.responseBody,
      job: error?.job,
      agentRun: error?.agentRun ? { code: error.agentRun.code, events: error.agentRun.events } : undefined
    });
    if (agentId && accessToken) {
      try {
        await requestJson(`${backendUrl}/v1/beta/agents/${encodeURIComponent(agentId)}/revoke`, {
          method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: {}
        });
        report.cleanup_revoke = 'ok';
      } catch (cleanupError) {
        report.cleanup_revoke = `failed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
      }
    }
    throw error;
  } finally {
    fs.writeFileSync(reportPath, `${JSON.stringify(redact(report), null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    console.log(`P4.2 report: ${reportPath}`);
    if (success) console.log('=== COLLAUDO LIVE BETA P4.2 SUPERATO ===');
  }
}

main().catch((error) => {
  console.error(`ERRORE P4.2: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
