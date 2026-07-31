import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/providers/engine-utils.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(baseUrl, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return await response.json();
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError || new Error('Health timeout');
}

test('diagnostica forense copre fasi HTTP, rejection job e stream artefatto', () => {
  const selftest = fs.readFileSync(path.join(root, 'scripts', 'live-production-selftest.mjs'), 'utf8');
  const sliceService = fs.readFileSync(path.join(root, 'src', 'slice-service.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  assert.match(selftest, /create_job/);
  assert.match(selftest, /poll_job/);
  assert.match(selftest, /download_artifact/);
  assert.match(selftest, /server_alive_after_error/);
  assert.doesNotMatch(sliceService, /\.catch\(\(\)\s*=>\s*\{\}\)/);
  assert.match(sliceService, /slice_job_scheduler_rejection/);
  assert.match(server, /http_file_stream_error/);
  assert.match(server, /server\.on\('clientError'/);
  assert.match(server, /server\.on\('error'/);
});

test('runProcess limita i buffer in memoria e conserva output completo su file', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-runprocess-'));
  const script = path.join(temp, 'noisy.mjs');
  fs.writeFileSync(script, `process.stdout.write('O'.repeat(180000)); process.stderr.write('E'.repeat(170000)); process.exit(7);`);
  try {
    await assert.rejects(
      runProcess(process.execPath, [script], { cwd: temp, diagnosticDir: path.join(temp, 'logs'), timeoutMs: 5000 }),
      (error) => {
        assert.equal(error.code, 'engine_failed');
        assert.equal(error.exitCode, 7);
        assert.ok(error.stdout.length <= 64 * 1024);
        assert.ok(error.stderr.length <= 64 * 1024);
        assert.ok(fs.statSync(error.stdoutPath).size >= 180000);
        assert.ok(fs.statSync(error.stderrPath).size >= 170000);
        return true;
      }
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('runProcess esegue un solo settle sul timeout', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-timeout-'));
  const script = path.join(temp, 'hang.mjs');
  fs.writeFileSync(script, `setInterval(() => {}, 1000);`);
  try {
    await assert.rejects(
      runProcess(process.execPath, [script], { cwd: temp, diagnosticDir: path.join(temp, 'logs'), timeoutMs: 150 }),
      (error) => error.code === 'engine_timeout'
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('percorso HTTP asincrono regge Orca 5x e tre sequenze senza riavvio con fixture', { timeout: 45_000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-http-forensic-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const fake = path.join(root, 'scripts', 'fake-slicer.mjs');
  const custom = JSON.stringify([process.execPath, fake, '{input}', '{output}']);
  const env = {
    ...process.env,
    AFFETTA_PORT: String(port),
    AFFETTA_HOST: '127.0.0.1',
    AFFETTA_PUBLIC_BASE_URL: baseUrl,
    AFFETTA_DATA_DIR: temp,
    AFFETTA_INSTANCE_ID: 'forensic-http-test',
    AFFETTA_BUILD_ID: 'forensic-http-test',
    AFFETTA_PUBLIC_MODE: 'true',
    AFFETTA_ALLOW_DEMO_GCODE: 'false',
    AFFETTA_ENGINE_COMMAND_PRUSA: custom,
    AFFETTA_ENGINE_COMMAND_ORCA: custom,
    AFFETTA_ENGINE_COMMAND_SNAPMAKER_ORCA: custom
  };
  const stdout = fs.openSync(path.join(temp, 'server.stdout.log'), 'w');
  const stderr = fs.openSync(path.join(temp, 'server.stderr.log'), 'w');
  const server = spawn(process.execPath, [path.join(root, 'bootstrap.js')], { cwd: root, env, stdio: ['ignore', stdout, stderr] });
  try {
    const healthBefore = await waitForHealth(baseUrl);
    assert.equal(healthBefore.instance_id, 'forensic-http-test');

    const orcaReport = path.join(temp, 'orca-5x.json');
    const orca = spawnSync(process.execPath, [path.join(root, 'scripts', 'live-production-selftest.mjs'), '--route', 'orca', '--repeat', '5', '--poll-ms', '250', '--report', orcaReport], { cwd: root, env, encoding: 'utf8', timeout: 20_000 });
    assert.equal(orca.status, 0, `${orca.stdout}\n${orca.stderr}`);

    const sequenceReport = path.join(temp, 'sequence-3x.json');
    const sequence = spawnSync(process.execPath, [path.join(root, 'scripts', 'live-production-selftest.mjs'), '--sequence-repeat', '3', '--poll-ms', '250', '--report', sequenceReport], { cwd: root, env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(sequence.status, 0, `${sequence.stdout}\n${sequence.stderr}`);

    const healthAfter = await waitForHealth(baseUrl);
    assert.equal(healthAfter.process_id, healthBefore.process_id);

    const orcaData = JSON.parse(fs.readFileSync(orcaReport, 'utf8'));
    const sequenceData = JSON.parse(fs.readFileSync(sequenceReport, 'utf8'));
    assert.equal(orcaData.ok, true);
    assert.equal(orcaData.runs.length, 5);
    assert.equal(sequenceData.ok, true);
    assert.equal(sequenceData.runs.length, 12);
    for (const run of [...orcaData.runs, ...sequenceData.runs]) {
      assert.equal(run.ok, true);
      assert.equal(run.print_ready, true);
      assert.ok(run.gcode_bytes > 10_000);
    }

    const crashLog = path.join(temp, 'process-crash.jsonl');
    const crashText = fs.existsSync(crashLog) ? fs.readFileSync(crashLog, 'utf8') : '';
    assert.doesNotMatch(crashText, /process_uncaught_exception|process_unhandled_rejection/);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('close', resolve));
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('guasto motore via HTTP restituisce 422 JSON e non arresta il server', { timeout: 20_000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-engine-failure-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const failing = path.join(root, 'scripts', 'failing-slicer.mjs');
  const failCommand = JSON.stringify([process.execPath, failing, '{input}', '{output}']);
  const env = {
    ...process.env,
    AFFETTA_PORT: String(port),
    AFFETTA_HOST: '127.0.0.1',
    AFFETTA_PUBLIC_BASE_URL: baseUrl,
    AFFETTA_DATA_DIR: temp,
    AFFETTA_INSTANCE_ID: 'engine-failure-test',
    AFFETTA_BUILD_ID: 'engine-failure-test',
    AFFETTA_PUBLIC_MODE: 'true',
    AFFETTA_ALLOW_DEMO_GCODE: 'false',
    AFFETTA_ENGINE_COMMAND_ORCA: failCommand
  };
  const stdout = fs.openSync(path.join(temp, 'server.stdout.log'), 'w');
  const stderr = fs.openSync(path.join(temp, 'server.stderr.log'), 'w');
  const server = spawn(process.execPath, [path.join(root, 'bootstrap.js')], { cwd: root, env, stdio: ['ignore', stdout, stderr] });
  try {
    const healthBefore = await waitForHealth(baseUrl);
    const model = fs.readFileSync(path.join(root, 'samples', 'cube20.stl')).toString('base64');
    const createdResponse = await fetch(`${baseUrl}/api/v1/slice-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-affetta-client': 'failure-isolation-test' },
      body: JSON.stringify({
        filename: 'cube20.stl', file_base64: model, printer_id: 'bambu-x1c', nozzle_mm: 0.4,
        material_id: 'pla', quality_id: 'standard', strength_id: 'standard', color_id: 'random',
        custom_color: null, quantity: 1, source: 'failure-isolation-test', metadata: { simulated: true }
      })
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json();
    const jobId = created.job.id;

    let failedResponse = null;
    let failedBody = null;
    for (let attempt = 0; attempt < 80; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const response = await fetch(`${baseUrl}/api/v1/slice-jobs/${jobId}`);
      const body = await response.json();
      if (response.status === 422) {
        failedResponse = response;
        failedBody = body;
        break;
      }
    }
    assert.ok(failedResponse, 'Il job simulato non ha restituito HTTP 422');
    assert.equal(failedBody.success, false);
    assert.equal(failedBody.job.status, 'failed');
    assert.equal(failedBody.job.phase, 'failed');
    assert.equal(failedBody.error.stage, 'slice_engine');
    assert.match(failedBody.error.message, /Nessun motore compatibile/);

    const healthAfter = await waitForHealth(baseUrl);
    assert.equal(healthAfter.process_id, healthBefore.process_id);

    const diagnostics = fs.readFileSync(path.join(temp, 'runtime-diagnostics.jsonl'), 'utf8');
    assert.match(diagnostics, /engine_process_failed/);
    assert.match(diagnostics, /fixture stderr: guasto motore simulato/);
    assert.match(diagnostics, new RegExp(jobId));
    assert.match(diagnostics, /"status":422/);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('close', resolve));
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('quantità oltre capacità restituisce 422 JSON senza avviare il motore', { timeout: 15_000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-quantity-422-'));
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const fake = path.join(root, 'scripts', 'fake-slicer.mjs');
  const custom = JSON.stringify([process.execPath, fake, '{input}', '{output}']);
  const env = {
    ...process.env,
    AFFETTA_PORT: String(port),
    AFFETTA_HOST: '127.0.0.1',
    AFFETTA_PUBLIC_BASE_URL: baseUrl,
    AFFETTA_DATA_DIR: temp,
    AFFETTA_INSTANCE_ID: 'quantity-422-test',
    AFFETTA_BUILD_ID: 'quantity-422-test',
    AFFETTA_PUBLIC_MODE: 'true',
    AFFETTA_ALLOW_DEMO_GCODE: 'false',
    AFFETTA_ENGINE_COMMAND_PRUSA: custom
  };
  const stdout = fs.openSync(path.join(temp, 'server.stdout.log'), 'w');
  const stderr = fs.openSync(path.join(temp, 'server.stderr.log'), 'w');
  const server = spawn(process.execPath, [path.join(root, 'bootstrap.js')], { cwd: root, env, stdio: ['ignore', stdout, stderr] });
  try {
    const healthBefore = await waitForHealth(baseUrl);
    const model = fs.readFileSync(path.join(root, 'samples', 'cube20.stl')).toString('base64');
    const response = await fetch(`${baseUrl}/api/v1/slice-jobs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-affetta-client': 'quantity-422-test' },
      body: JSON.stringify({
        filename: 'cube20.stl', file_base64: model, printer_id: 'prusa-mk4', nozzle_mm: 0.4,
        material_id: 'pla', quality_id: 'standard', strength_id: 'standard', color_id: 'random',
        custom_color: null, quantity: 999, source: 'quantity-422-test'
      })
    });
    const body = await response.json();
    assert.equal(response.status, 422);
    assert.equal(body.success, false);
    assert.equal(body.error.code, 'quantity_does_not_fit');
    assert.match(body.error.message, /non entrano/);
    const healthAfter = await waitForHealth(baseUrl);
    assert.equal(healthAfter.process_id, healthBefore.process_id);
  } finally {
    server.kill('SIGTERM');
    await new Promise((resolve) => server.once('close', resolve));
    fs.closeSync(stdout);
    fs.closeSync(stderr);
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
