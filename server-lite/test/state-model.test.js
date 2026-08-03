import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrinterSnapshot, serverCanShutdown } from '../src/state-model.js';

const printer = { id: 'p1', name: 'Printer 1', model: 'Mock', adapter: 'mock' };

test('normalizzazione non inventa percentuali mancanti', () => {
  const snapshot = normalizePrinterSnapshot(printer, {
    connection_status: 'connected', machine_status: 'printing', job_status: 'printing'
  }, '2026-08-03T12:00:00.000Z');
  assert.equal(snapshot.progress_percent, null);
  assert.equal(snapshot.server_dependency, 'device_autonomous');
});

test('shutdown bloccato durante trasferimento non autonomo', () => {
  const result = serverCanShutdown([], [{ id: 'j1', filename: 'part.gcode', status: 'transferring', autonomous: false }]);
  assert.equal(result.can_shutdown, false);
  assert.equal(result.blocking_job_id, 'j1');
});

test('shutdown consentito durante stampa autonoma', () => {
  const snapshot = normalizePrinterSnapshot(printer, {
    connection_status: 'connected', machine_status: 'printing', job_status: 'printing',
    progress_percent: 42, server_dependency: 'device_autonomous'
  });
  const result = serverCanShutdown([snapshot], [{ id: 'j1', filename: 'part.gcode', status: 'printing', autonomous: true }]);
  assert.equal(result.can_shutdown, true);
});
