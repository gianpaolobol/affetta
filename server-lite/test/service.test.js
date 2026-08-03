import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServerLiteDatabase } from '../src/db.js';
import { AdapterRegistry } from '../src/adapter-registry.js';
import { ServerLiteService } from '../src/service.js';

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-server-lite-'));
  const db = new ServerLiteDatabase(path.join(dir, 'state.sqlite'));
  const snapshots = new Map();
  const registry = new AdapterRegistry({ mockSnapshots: snapshots });
  const printer = { id: 'v400', name: 'FLSUN V400', model: 'FLSUN V400', adapter: 'mock', enabled: true, options: {} };
  const service = new ServerLiteService({ db, registry, printers: [printer] });
  return { dir, db, snapshots, service };
}

test('riconcilia una stampa autonoma e conserva la percentuale', async (t) => {
  const fx = fixture();
  t.after(() => { fx.db.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); });
  const job = fx.service.registerDelivery({
    id: 'job_1', printer_id: 'v400', filename: 'pezzo.gcode', remote_job_id: 'pezzo.gcode',
    status: 'transferred', autonomous: true
  });
  assert.equal(job.status, 'transferred');
  fx.snapshots.set('v400', {
    connection_status: 'connected', machine_status: 'printing', job_status: 'printing',
    progress_percent: 37.5, active_file: 'pezzo.gcode', remote_job_id: 'pezzo.gcode',
    server_dependency: 'device_autonomous'
  });
  const result = await fx.service.reconcilePrinter('v400', 'test');
  assert.equal(result.snapshot.progress_percent, 37.5);
  assert.equal(fx.service.getJob('job_1').status, 'printing');
  assert.equal(fx.service.shutdownReadiness().can_shutdown, true);
});

test('alla riaccensione registra completamento riferito dal controller', async (t) => {
  const fx = fixture();
  t.after(() => { fx.db.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); });
  fx.service.registerDelivery({
    id: 'job_2', printer_id: 'v400', filename: 'pezzo.gcode', remote_job_id: 'pezzo.gcode',
    status: 'printing', autonomous: true, started_at: '2026-08-03T12:00:00.000Z'
  });
  fx.snapshots.set('v400', {
    connection_status: 'connected', machine_status: 'ready', job_status: 'completed',
    progress_percent: 100, active_file: 'pezzo.gcode', remote_job_id: 'pezzo.gcode',
    server_dependency: 'device_autonomous'
  });
  await fx.service.reconcilePrinter('v400', 'startup');
  const job = fx.service.getJob('job_2');
  assert.equal(job.status, 'completed');
  assert.equal(job.progress_percent, 100);
  assert.equal(job.outcome_source, 'adapter:mock');
});

test('non dichiara completata una stampa quando il controller non conserva l’esito', async (t) => {
  const fx = fixture();
  t.after(() => { fx.db.close(); fs.rmSync(fx.dir, { recursive: true, force: true }); });
  fx.service.registerDelivery({
    id: 'job_3', printer_id: 'v400', filename: 'pezzo.gcode', status: 'printing', autonomous: true
  });
  fx.snapshots.set('v400', {
    connection_status: 'connected', machine_status: 'printing', job_status: 'printing',
    progress_percent: 80, active_file: 'pezzo.gcode', server_dependency: 'device_autonomous'
  });
  await fx.service.reconcilePrinter('v400', 'poll');
  fx.snapshots.set('v400', {
    connection_status: 'connected', machine_status: 'ready', job_status: 'none',
    progress_percent: null, active_file: null, server_dependency: 'not_applicable'
  });
  await fx.service.reconcilePrinter('v400', 'startup');
  assert.equal(fx.service.getJob('job_3').status, 'outcome_unknown');
});
