import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  assertLocalLoopback,
  buildJobRequest,
  chooseProductionGcodeTarget,
  parseDotEnv,
  parseJsonEvents,
  redact,
  safeReportPath
} from './lib.mjs';

test('parseDotEnv legge valori senza includere commenti', () => {
  assert.deepEqual(parseDotEnv("# x\nA=1\nB='due'\nC=tre=quattro\n"), { A: '1', B: 'due', C: 'tre=quattro' });
});

test('P3.3 accetta solo endpoint loopback', () => {
  assert.doesNotThrow(() => assertLocalLoopback('http://127.0.0.1:8790', 'backend'));
  assert.throws(() => assertLocalLoopback('http://192.168.1.10:8790', 'backend'), /loopback/);
});

test('seleziona una unità production_ready G-code e scarta Thing-O-Matic', () => {
  const selected = chooseProductionGcodeTarget({
    catalog: { printers: {
      'thing-o-matic': { materials: ['pla'], nozzles: [0.35] },
      'bambu-x1c': { materials: ['pla', 'petg'], nozzles: [0.4], default_nozzle: 0.4, status: 'validated' }
    } },
    fleet: { fleet: { units: [
      { id: 'thing-o-matic-01', printer_id: 'thing-o-matic', production_ready: false, material_ids: ['pla'] },
      { id: 'x1c-01', printer_id: 'bambu-x1c', production_ready: true, material_ids: ['pla', 'petg'] }
    ] } },
    diagnostics: { slicing: { printers: {
      'thing-o-matic': { output_format: 'x3g' },
      'bambu-x1c': { output_format: 'gcode' }
    } } }
  });
  assert.equal(selected.fleet_unit_id, 'x1c-01');
  assert.equal(selected.material_id, 'pla');
  assert.equal(selected.output_format, 'gcode');
});

test('rifiuta il collaudo se non esiste una unità production_ready G-code', () => {
  assert.throws(() => chooseProductionGcodeTarget({
    catalog: { printers: { 'thing-o-matic': { materials: ['pla'], nozzles: [0.35] } } },
    fleet: { fleet: { units: [{ id: 'thing-o-matic-01', printer_id: 'thing-o-matic', production_ready: false }] } },
    diagnostics: { slicing: { printers: { 'thing-o-matic': { output_format: 'x3g' } } } }
  }), /Nessuna unità G-code production_ready/);
});

test('costruisce un job manuale senza invio a stampante fisica', () => {
  const request = buildJobRequest({
    artifact: { id: 'art_test_01' }, sha256: 'a'.repeat(64), sizeBytes: 123,
    target: { material_id: 'pla', nozzle_mm: 0.4, printer_profile_id: 'bambu-x1c', fleet_unit_id: 'x1c-01' },
    suffix: 'abcdef12', filename: 'cube.stl'
  });
  assert.equal(request.routing.mode, 'manual');
  assert.equal(request.routing.require_production_ready, true);
  assert.equal(request.print_intent.requested_output_format, 'gcode');
  assert.equal(request.extensions['affetta.p3-3.no-physical-print'], true);
});

test('estrae soltanto eventi JSON validi dai log Agent', () => {
  assert.deepEqual(parseJsonEvents('rumore\n{"event":"agent_paired","agent_id":"agt_1"}\n{no}\n').map((event) => event.event), ['agent_paired']);
});

test('redact elimina segreti ricorsivamente dai report', () => {
  assert.deepEqual(redact({ api_key: 'abc', nested: { access_token: 'xyz', ok: 1 } }), {
    api_key: '[REDACTED]', nested: { access_token: '[REDACTED]', ok: 1 }
  });
});

test('report P3.3 resta nella directory dati ignorata da Git', () => {
  const report = safeReportPath(path.join('agent', 'agent-data'), new Date('2026-08-02T21:45:00.000Z'));
  assert.match(report.replaceAll('\\', '/'), /agent\/agent-data\/p3-3-live-test-report-20260802T214500Z\.json$/);
});
