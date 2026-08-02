import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectCapabilities } from '../src/capabilities.js';
import { AgentDatabase } from '../src/db.js';
import type { LocalAffettaClient } from '../src/local-affetta-client.js';
import { testConfig } from './support/test-config.js';

test('heartbeat pubblica una capability distinta per ogni unità fisica', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-agent-capabilities-'));
  const config = testConfig(root, 'http://127.0.0.1:8790', 'http://127.0.0.1:8787');
  const db = await AgentDatabase.open(config.databasePath, config.secretKeyPath);
  const local = {
    getHealth: async () => ({ success: true, service: 'affetta', version: '0.5.2', api_version: 'v1' }),
    getCatalog: async () => ({ success: true, printers: {
      'bambu-x1c': { status: 'validated', materials: ['pla', 'petg'], nozzles: [0.4], default_nozzle: 0.4 },
      'thing-o-matic': { status: 'experimental', materials: ['pla'], nozzles: [0.35], default_nozzle: 0.35 }
    } }),
    getFleet: async () => ({ success: true, fleet: { units: [
      { id: 'x1c-01', printer_id: 'bambu-x1c', production_ready: true, calibration_status: 'passed', material_ids: ['pla', 'petg'] },
      { id: 'thing-o-matic-01', printer_id: 'thing-o-matic', production_ready: false, calibration_status: 'pending', material_ids: ['pla'] }
    ] } }),
    getDiagnostics: async () => ({ slicing: { printers: {
      'bambu-x1c': { output_format: 'gcode', profile_status: 'validated' },
      'thing-o-matic': { output_format: 'x3g', profile_status: 'experimental' }
    } }, engines: {} })
  } as unknown as LocalAffettaClient;

  try {
    const capabilities = await collectCapabilities(config, db, local, 'agt_capability_test');
    const x1c = capabilities.printer_profiles.find((profile) => profile.fleet_unit_id === 'x1c-01');
    const thingOMatic = capabilities.printer_profiles.find((profile) => profile.fleet_unit_id === 'thing-o-matic-01');
    assert.ok(x1c);
    assert.equal(x1c.profile_id, 'bambu-x1c');
    assert.equal(x1c.production_ready, true);
    assert.equal(x1c.physical_validation, 'passed');
    assert.ok(thingOMatic);
    assert.equal(thingOMatic.production_ready, false);
    assert.equal(thingOMatic.physical_validation, 'pending');
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});
