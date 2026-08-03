import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OctoBridgeAdapter } from '../src/adapters/octobridge.js';

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

test('probe conserva gli stati espliciti e non inventa avanzamento', async () => {
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'http://bridge.local:8792/v1/status');
    assert.equal(options.headers.Authorization, 'Bearer secret-token');
    return jsonResponse({
      release_channel: 'experimental',
      production_ready: false,
      bridge_id: 'zero-01',
      active_job_id: 'job-1',
      serial_printing_enabled: true,
      pending_sync_count: 2,
      printer_snapshot: {
        connection_status: 'connected', machine_status: 'printing', job_status: 'printing',
        progress_percent: null, phase: 'Printing', elapsed_seconds: 10, remaining_seconds: null,
        active_file: 'part.gcode', temperatures: { tool0: { actual: 205, target: 205 } },
        server_dependency: 'device_autonomous'
      }
    });
  };
  const adapter = new OctoBridgeAdapter({ fetchImpl });
  const snapshot = await adapter.probe({ endpoint: 'http://bridge.local:8792', api_key: 'secret-token' });
  assert.equal(snapshot.progress_percent, null);
  assert.equal(snapshot.server_dependency, 'device_autonomous');
  assert.equal(snapshot.raw.bridge_production_ready, false);
});

test('stageJob invia metadati, byte originali e trasferisce prima dell’avvio', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'octobridge-adapter-'));
  try {
    const filePath = join(directory, 'part.gcode');
    const bytes = Buffer.from('G28\nG1 X10 Y10\n');
    await writeFile(filePath, bytes);
    const calls = [];
    const fetchImpl = async (url, options) => {
      let body = null;
      if (options.body && typeof options.body[Symbol.asyncIterator] === 'function') {
        const chunks = [];
        for await (const chunk of options.body) chunks.push(chunk);
        body = Buffer.concat(chunks);
      } else if (typeof options.body === 'string') {
        body = options.body;
      }
      calls.push({ url, method: options.method, body, headers: options.headers });
      return jsonResponse({ ok: true });
    };
    const adapter = new OctoBridgeAdapter({ fetchImpl, timeoutMs: 2000 });
    await adapter.stageJob(
      { endpoint: 'http://bridge.local:8792', api_key: 'secret-token' },
      { id: 'job-1', filename: 'part.gcode', gcode_path: filePath, printer_profile_id: 'anycubic-predator' }
    );
    assert.deepEqual(calls.map((call) => call.url.split('/v1/')[1]), [
      'jobs', 'jobs/job-1/gcode', 'jobs/job-1/transfer'
    ]);
    assert.deepEqual(calls[1].body, bytes);
    assert.equal(calls[1].headers['Content-Length'], String(bytes.length));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
