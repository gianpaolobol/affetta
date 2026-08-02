import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../src/config.js';
import { resolvePrintProfile } from '../src/providers/profile-resolver.js';
import { buildGpxArgs } from '../src/providers/postprocessors/gpx.js';

test('Thing-O-Matic è presente con configurazione Mk6/Sailfish/X3G', () => {
  const printer = catalogs.printers['thing-o-matic'];
  assert.ok(printer);
  assert.equal(printer.label, 'Thing-O-Matic');
  assert.equal(printer.default_nozzle, 0.35);
  assert.equal(printer.filament_diameter_mm, 2.85);
  assert.equal(printer.firmware, 'sailfish');
  assert.equal(printer.output_format, 'x3g');
  assert.equal(printer.postprocess.engine, 'gpx');
  assert.equal(printer.postprocess.machine, 't6');
  assert.deepEqual(printer.materials, ['pla', 'abs', 'petg', 'tpu']);
});

for (const materialId of ['pla', 'abs', 'petg', 'tpu']) {
  test(`Thing-O-Matic genera un profilo cautelativo per ${materialId.toUpperCase()}`, () => {
    const profile = resolvePrintProfile({
      printerId: 'thing-o-matic',
      nozzleMm: 0.35,
      materialId,
      qualityId: 'standard',
      strengthId: 'standard'
    });
    assert.equal(profile.output_format, 'x3g');
    assert.equal(profile.postprocess.engine, 'gpx');
    assert.equal(profile.filament_diameter_mm, 2.85);
    assert.ok(profile.print_speed_mm_s <= (materialId === 'tpu' ? 15 : materialId === 'pla' ? 30 : 25));
    assert.ok(profile.temperature_c <= 240);
    assert.ok(profile.warnings.some((warning) => warning.toLowerCase().includes('sperimentale')));
  });
}

test('GPX usa il preset t6, G-code RepRap e filamento 2.85 mm', () => {
  const args = buildGpxArgs({
    install: { prefix: [] },
    inputPath: 'input.gcode',
    outputPath: 'output.x3g',
    postprocess: {
      machine: 't6',
      gcode_flavor: 'reprap',
      filament_diameter_mm: 2.85
    }
  });
  assert.deepEqual(args, ['-r', '-p', '-m', 't6', '-f', '2.85', 'input.gcode', 'output.x3g']);
});
