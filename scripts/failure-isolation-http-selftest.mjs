import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function freePort() {
  return await new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const port = listener.address().port;
      listener.close(() => resolve(port));
    });
  });
}

async function health(baseUrl, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return await response.json();
    } catch (error) { lastError = error; }
    await sleep(100);
  }
  throw lastError || new Error('Health timeout server isolato');
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-failure-http-'));
const port = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const failCommand = JSON.stringify([process.execPath, path.join(root, 'scripts', 'failing-slicer.mjs'), '{input}', '{output}']);
const reportPath = path.join(root, 'data', 'acceptance-engine-failure.json');
const stdoutPath = path.join(temp, 'server.stdout.log');
const stderrPath = path.join(temp, 'server.stderr.log');
const stdout = fs.openSync(stdoutPath, 'w');
const stderr = fs.openSync(stderrPath, 'w');
const child = spawn(process.execPath, [path.join(root, 'bootstrap.js')], {
  cwd: root,
  env: {
    ...process.env,
    AFFETTA_PORT: String(port),
    AFFETTA_HOST: '127.0.0.1',
    AFFETTA_PUBLIC_BASE_URL: baseUrl,
    AFFETTA_DATA_DIR: temp,
    AFFETTA_INSTANCE_ID: 'acceptance-engine-failure',
    AFFETTA_BUILD_ID: 'acceptance-engine-failure',
    AFFETTA_PUBLIC_MODE: 'true',
    AFFETTA_ALLOW_DEMO_GCODE: 'false',
    AFFETTA_ENGINE_COMMAND_ORCA: failCommand
  },
  stdio: ['ignore', stdout, stderr]
});

const report = {
  generated_at: new Date().toISOString(),
  test: 'simulated_engine_failure_http_isolation',
  isolated_base_url: baseUrl,
  isolated_server_pid: child.pid,
  ok: false
};

try {
  const before = await health(baseUrl);
  report.health_before = before;
  const model = fs.readFileSync(path.join(root, 'samples', 'cube20.stl')).toString('base64');
  const createdResponse = await fetch(`${baseUrl}/api/v1/slice-jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-affetta-client': 'failure-isolation-selftest' },
    body: JSON.stringify({
      filename: 'cube20.stl', file_base64: model, printer_id: 'bambu-x1c', nozzle_mm: 0.4,
      material_id: 'pla', quality_id: 'standard', strength_id: 'standard', color_id: 'random',
      custom_color: null, quantity: 1, source: 'failure-isolation-selftest', metadata: { simulated: true }
    })
  });
  report.create_status = createdResponse.status;
  const created = await createdResponse.json();
  report.job_id = created?.job?.id || null;
  if (createdResponse.status !== 202 || !report.job_id) throw new Error(`Creazione job simulato fallita: HTTP ${createdResponse.status}`);

  for (let attempt = 1; attempt <= 100; attempt++) {
    await sleep(100);
    const response = await fetch(`${baseUrl}/api/v1/slice-jobs/${report.job_id}`);
    const body = await response.json();
    report.last_poll = { attempt, status: response.status, body };
    if (response.status === 422) break;
  }
  if (report.last_poll?.status !== 422) throw new Error('Il guasto motore non ha prodotto HTTP 422.');
  if (report.last_poll.body?.job?.status !== 'failed') throw new Error('Il JSON non contiene job.status=failed.');
  if (report.last_poll.body?.error?.stage !== 'slice_engine') throw new Error('Il JSON non identifica stage=slice_engine.');

  const after = await health(baseUrl);
  report.health_after = after;
  if (after.process_id !== before.process_id) throw new Error('Il PID del server isolato è cambiato dopo il guasto motore.');

  const diagnosticsPath = path.join(temp, 'runtime-diagnostics.jsonl');
  const diagnostics = fs.existsSync(diagnosticsPath) ? fs.readFileSync(diagnosticsPath, 'utf8') : '';
  report.diagnostics = {
    engine_process_failed: diagnostics.includes('engine_process_failed'),
    stderr_captured: diagnostics.includes('fixture stderr: guasto motore simulato'),
    job_id_captured: diagnostics.includes(report.job_id),
    http_422_captured: diagnostics.includes('"status":422')
  };
  if (Object.values(report.diagnostics).some((value) => !value)) throw new Error('Diagnostica del guasto motore incompleta.');
  report.ok = true;
  report.completed_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log('OK   errore motore simulato -> HTTP 422 JSON; server isolato ancora attivo con PID invariato');
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack, cause: error.cause || null };
  report.completed_at = new Date().toISOString();
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`ERRORE collaudo isolamento motore: ${error.message}`);
  process.exitCode = 1;
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    sleep(3000)
  ]);
  if (child.exitCode == null) child.kill('SIGKILL');
  fs.closeSync(stdout);
  fs.closeSync(stderr);
  fs.rmSync(temp, { recursive: true, force: true });
}
