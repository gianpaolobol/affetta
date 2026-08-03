import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { ServerLiteDatabase } from '../src/db.js';
import { AdapterRegistry } from '../src/adapter-registry.js';
import { ServerLiteService } from '../src/service.js';
import { createServerLiteHttp } from '../src/http.js';

test('API espone riepilogo e riconciliazione', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-server-http-'));
  const db = new ServerLiteDatabase(path.join(dir, 'state.sqlite'));
  const registry = new AdapterRegistry({ mockSnapshots: new Map([['p1', {
    connection_status: 'connected', machine_status: 'ready', job_status: 'none'
  }]]) });
  const service = new ServerLiteService({
    db, registry, printers: [{ id: 'p1', name: 'Printer', model: 'Mock', adapter: 'mock', enabled: true, options: {} }]
  });
  const server = createServerLiteHttp({ service, config: { api_token: null } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const reconcile = await fetch(`${base}/api/v1/server-lite/reconcile`, { method: 'POST' });
  assert.equal(reconcile.status, 200);
  const summary = await (await fetch(`${base}/api/v1/server-lite/summary`)).json();
  assert.equal(summary.totals.connected, 1);
  assert.equal(summary.shutdown_readiness.can_shutdown, true);
});
