import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogs } from '../src/config.js';
import { resolvePrintProfile } from '../src/providers/profile-resolver.js';

test('ogni stampante genera profili coerenti per ugelli, materiali, qualità e resistenza', () => {
  let count = 0;
  for (const [printerId, printer] of Object.entries(catalogs.printers)) {
    for (const nozzleMm of printer.nozzles) {
      for (const materialId of printer.materials) {
        for (const qualityId of Object.keys(catalogs.qualities)) {
          for (const strengthId of Object.keys(catalogs.strengths)) {
            const profile = resolvePrintProfile({ printerId, nozzleMm, materialId, qualityId, strengthId });
            assert.equal(profile.printer_id, printerId);
            assert.equal(profile.nozzle_mm, nozzleMm);
            assert.ok(profile.layer_height_mm >= 0.05 && profile.layer_height_mm <= nozzleMm * 0.75 + 1e-9);
            assert.ok(profile.line_width_mm >= nozzleMm);
            assert.ok(profile.temperature_c <= printer.machine.max_hotend_c);
            assert.ok(profile.bed_temperature_c <= printer.machine.max_bed_c);
            assert.ok(profile.print_speed_mm_s <= printer.machine.max_print_speed);
            assert.ok(profile.travel_speed_mm_s <= printer.machine.travel_speed);
            assert.equal(profile.infill_percent, catalogs.strengths[strengthId].infill_percent);
            assert.equal(profile.walls, catalogs.strengths[strengthId].walls);
            assert.ok(profile.engines.length >= 1);
            count++;
          }
        }
      }
    }
  }
  assert.ok(count > 2000);
});

test('la stampante modifica realmente i parametri automatici', () => {
  const common = { nozzleMm:0.4, materialId:'pla', qualityId:'standard', strengthId:'standard' };
  const ender = resolvePrintProfile({ printerId:'creality-ender3', ...common });
  const bambu = resolvePrintProfile({ printerId:'bambu-x1c', ...common });
  const tpu = resolvePrintProfile({ printerId:'bambu-x1c', ...common, materialId:'tpu' });
  assert.ok(bambu.print_speed_mm_s > ender.print_speed_mm_s);
  assert.ok(tpu.print_speed_mm_s < bambu.print_speed_mm_s);
  assert.ok(tpu.retract_speed_mm_s <= 20);
});
