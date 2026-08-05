#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--repo-root') result.repoRoot = argv[++index];
  }
  return result;
}

function readBody(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => resolveBody(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function send(response, status, value) {
  const body = value === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store'
  });
  response.end(body);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(here, '..');
  const repoRoot = resolve(args.repoRoot || join(packageRoot, '..', '..', '..'));
  const adapterPath = join(repoRoot, 'server-lite', 'src', 'adapters', 'octobridge.js');
  const { OctoBridgeAdapter } = await import(pathToFileURL(adapterPath).href);

  const token = 'adapter-e2e-token';
  const jobs = new Map();
  let syncAck = null;
  let activeJobId = null;

  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${token}`) {
        send(response, 401, { error: { code: 'unauthorized' } });
        return;
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      const path = url.pathname;

      if (request.method === 'GET' && path === '/v1/status') {
        send(response, 200, {
          schema_version: 'affetta.octobridge-status.v1',
          release_channel: 'experimental',
          production_ready: false,
          bridge_id: 'adapter-e2e-bridge',
          serial_printing_enabled: true,
          active_job_id: activeJobId,
          pending_sync_count: jobs.size,
          printer_snapshot: {
            connection_status: 'connected',
            machine_status: activeJobId ? 'printing' : 'ready',
            job_status: activeJobId ? 'printing' : 'none',
            progress_percent: activeJobId ? 42 : null,
            phase: activeJobId ? 'Printing' : 'Operational',
            elapsed_seconds: activeJobId ? 120 : null,
            remaining_seconds: activeJobId ? 180 : null,
            active_file: activeJobId ? jobs.get(activeJobId)?.filename : null,
            temperatures: { tool0: { actual: 205, target: 210 } },
            alerts: [],
            server_dependency: activeJobId ? 'device_autonomous' : 'not_applicable',
            raw: { simulator: true }
          }
        });
        return;
      }
      if (request.method === 'GET' && path === '/v1/sync/pending') {
        send(response, 200, { jobs: [...jobs.values()].map((job) => ({ job_id: job.job_id, state: job.state })) });
        return;
      }
      if (request.method === 'POST' && path === '/v1/jobs') {
        const payload = JSON.parse((await readBody(request)).toString('utf8'));
        jobs.set(payload.job_id, { ...payload, state: 'created', bytes: null });
        send(response, 201, jobs.get(payload.job_id));
        return;
      }
      const match = path.match(/^\/v1\/jobs\/([^/]+)(?:\/(.*))?$/);
      if (match) {
        const jobId = decodeURIComponent(match[1]);
        const action = match[2] || '';
        const job = jobs.get(jobId);
        if (!job) {
          send(response, 404, { error: { code: 'job_not_found' } });
          return;
        }
        if (request.method === 'PUT' && action === 'gcode') {
          const bytes = await readBody(request);
          job.bytes = bytes;
          job.state = 'staged';
          send(response, 200, job);
          return;
        }
        if (request.method === 'POST' && action === 'transfer') {
          assert(job.bytes, 'gcode non ricevuto');
          assert.equal(job.bytes.length, Number(job.size_bytes));
          assert.equal(createHash('sha256').update(job.bytes).digest('hex'), job.sha256);
          job.state = 'transferred';
          send(response, 200, job);
          return;
        }
        if (request.method === 'POST' && action === 'start') {
          job.state = 'printing';
          activeJobId = jobId;
          send(response, 200, job);
          return;
        }
        if (request.method === 'POST' && action === 'cancel') {
          job.state = 'cancelled';
          if (activeJobId === jobId) activeJobId = null;
          send(response, 200, job);
          return;
        }
        if (request.method === 'POST' && action === 'sync-ack') {
          syncAck = JSON.parse((await readBody(request)).toString('utf8'));
          send(response, 200, { ok: true, ...syncAck });
          return;
        }
      }
      send(response, 404, { error: { code: 'not_found' } });
    } catch (error) {
      send(response, 500, { error: { code: 'simulator_error', message: String(error?.stack || error) } });
    }
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const endpoint = `http://127.0.0.1:${address.port}`;
  const printer = { id: 'predator-01', endpoint, api_key: token };
  const adapter = new OctoBridgeAdapter({ timeoutMs: 3000, transferTimeoutMs: 10000, actionTimeoutMs: 5000 });
  const temp = await mkdtemp(join(tmpdir(), 'affetta-adapter-e2e-'));

  try {
    console.log('[TEST] probe normalizzato');
    const ready = await adapter.probe(printer);
    assert.equal(ready.connection_status, 'connected');
    assert.equal(ready.machine_status, 'ready');
    assert.equal(ready.raw.bridge_id, 'adapter-e2e-bridge');
    assert.equal(ready.raw.bridge_production_ready, false);

    console.log('[TEST] autenticazione errata classificata');
    await assert.rejects(
      () => adapter.probe({ ...printer, api_key: 'wrong-token' }),
      (error) => error?.code === 'authentication_failed'
    );

    console.log('[TEST] stageJob + SHA-256 + transfer');
    const filePath = join(temp, 'adapter-e2e.gcode');
    const content = Buffer.from('; adapter e2e\nG28\nG1 X10 Y10\n');
    await writeFile(filePath, content);
    const digest = createHash('sha256').update(content).digest('hex');
    const staged = await adapter.stageJob(printer, {
      id: 'adapter-e2e-job',
      gcode_path: filePath,
      filename: 'adapter-e2e.gcode',
      printer_profile_id: 'anycubic-predator',
      sha256: digest,
      size_bytes: content.length,
      source: { test: true }
    });
    assert.equal(staged.state, 'transferred');

    console.log('[TEST] start + probe printing');
    await adapter.startJob(printer, 'adapter-e2e-job');
    const printing = await adapter.probe(printer);
    assert.equal(printing.job_status, 'printing');
    assert.equal(printing.progress_percent, 42);
    assert.equal(printing.server_dependency, 'device_autonomous');

    console.log('[TEST] pending sync + acknowledge');
    const pending = await adapter.pendingSync(printer);
    assert.equal(pending.jobs[0].job_id, 'adapter-e2e-job');
    await adapter.acknowledgeSync(printer, 'adapter-e2e-job', { event_sequence: 7, files: ['04_completed.jpg'] });
    assert.deepEqual(syncAck, { event_sequence: 7, files: ['04_completed.jpg'] });

    console.log('[TEST] cancel');
    const cancelled = await adapter.cancelJob(printer, 'adapter-e2e-job');
    assert.equal(cancelled.state, 'cancelled');

    console.log('[TEST] integrità locale rifiutata prima della rete');
    await assert.rejects(
      () => adapter.stageJob(printer, {
        id: 'bad-size', gcode_path: filePath, filename: 'bad.gcode',
        printer_profile_id: 'anycubic-predator', size_bytes: content.length + 1
      }),
      (error) => error?.code === 'gcode_integrity_error'
    );

    console.log('[OK] Adapter Server Lite OctoBridge superato.');
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(temp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
