import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeGcode, parseDurationSeconds } from '../src/gcode.js';
import { validateGcode } from '../src/gcode-validator.js';

test('analizza estrusione e movimenti G-code', () => {
  const code = `G90\nM82\nG1 X0 Y0 Z0.2 F1200\nG1 X20 Y0 E1 F600\nG1 X20 Y20 E2\nG1 X0 Y20 E3\nG1 X0 Y0 E4\n`;
  const stats = analyzeGcode(code);
  assert.equal(stats.filament_length_mm, 4);
  assert.ok(stats.time_seconds > 0);
  const valid = validateGcode(code.repeat(4), { buildMm:[220,220,250], material:{nozzle_c:210} });
  assert.equal(valid.valid, true);
});

test('interpreta correttamente i tempi umani di Prusa e Orca', () => {
  assert.equal(parseDurationSeconds('1h 2m 3s'), 3723);
  assert.equal(parseDurationSeconds('02:03:04'), 7384);
  assert.equal(parseDurationSeconds('12:34'), 754);

  const prusa = analyzeGcode('; estimated printing time (normal mode) = 1h 2m 3s\nG1 X10 F600\n');
  assert.equal(prusa.time_seconds, 3723);
  assert.equal(prusa.time_source, 'slicer_estimate');

  const orca = analyzeGcode('; model printing time: 10m 5s; total estimated time: 12m 30s\nG1 X10 F600\n');
  assert.equal(orca.time_seconds, 750);
  assert.equal(orca.time_source, 'slicer_total_estimate');
});

test('preferisce i metadati filamento dello slicer ai reset E del G-code', () => {
  const code = `; filament used [mm] = 950.9\n; filament used [g] = 2.84\nM82\nG92 E0\nG1 X10 E1 F600\nG92 E0\nG1 X20 E1\n`;
  const stats = analyzeGcode(code);
  assert.equal(stats.filament_length_mm, 950.9);
  assert.equal(stats.filament_g, 2.84);
  assert.equal(stats.filament_source, 'slicer_metadata');
});
