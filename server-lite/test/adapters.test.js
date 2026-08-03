import test from 'node:test';
import assert from 'node:assert/strict';
import { MoonrakerAdapter } from '../src/adapters/moonraker.js';
import { OctoPrintAdapter } from '../src/adapters/octoprint.js';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return structuredClone(body); } };
}

test('Moonraker normalizza stampa e percentuale', async () => {
  const adapter = new MoonrakerAdapter({ fetchImpl: async () => response({
    result: { status: {
      print_stats: { state: 'printing', filename: 'cube.gcode', print_duration: 120, info: { current_layer: 4, total_layer: 10 } },
      display_status: { progress: 0.4 },
      extruder: { temperature: 205, target: 210 },
      heater_bed: { temperature: 59, target: 60 }
    } }
  }) });
  const state = await adapter.probe({ endpoint: 'http://v400.local' });
  assert.equal(state.job_status, 'printing');
  assert.equal(state.progress_percent, 40);
  assert.equal(state.layer_current, 4);
  assert.equal(state.server_dependency, 'device_autonomous');
});

test('OctoPrint normalizza stampa e tempo residuo', async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith('/api/job')) return response({
      state: 'Printing', job: { file: { name: 'predator.gcode', path: 'predator.gcode' } },
      progress: { completion: 25, printTime: 300, printTimeLeft: 900 }
    });
    return response({
      state: { text: 'Printing', flags: { operational: true, printing: true, paused: false, error: false } },
      temperature: { tool0: { actual: 205, target: 210 }, bed: { actual: 55, target: 60 } }
    });
  };
  const adapter = new OctoPrintAdapter({ fetchImpl });
  const state = await adapter.probe({ endpoint: 'http://octopi.local', api_key: 'secret' });
  assert.equal(state.job_status, 'printing');
  assert.equal(state.progress_percent, 25);
  assert.equal(state.remaining_seconds, 900);
  assert.equal(state.active_file, 'predator.gcode');
});
