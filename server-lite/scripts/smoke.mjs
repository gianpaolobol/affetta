import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ServerLiteDatabase } from '../src/db.js';
import { AdapterRegistry } from '../src/adapter-registry.js';
import { ServerLiteService } from '../src/service.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-server-lite-smoke-'));
const db = new ServerLiteDatabase(path.join(dir, 'state.sqlite'));
try {
  const snapshots = new Map([['mock-printer', {
    connection_status: 'connected', machine_status: 'printing', job_status: 'printing',
    progress_percent: 51, active_file: 'smoke.gcode', server_dependency: 'device_autonomous'
  }]]);
  const service = new ServerLiteService({
    db,
    registry: new AdapterRegistry({ mockSnapshots: snapshots }),
    printers: [{ id: 'mock-printer', name: 'Mock Printer', model: 'Test', adapter: 'mock', enabled: true, options: {} }]
  });
  service.registerDelivery({ printer_id: 'mock-printer', filename: 'smoke.gcode', status: 'transferred', autonomous: true });
  await service.reconcileAll('smoke');
  const summary = service.summary();
  if (summary.totals.printing !== 1 || !summary.shutdown_readiness.can_shutdown) {
    throw new Error(`Smoke non superato: ${JSON.stringify(summary)}`);
  }
  console.log('=== AFFETTA SERVER LITE P4.3 SMOKE SUPERATO ===');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}
