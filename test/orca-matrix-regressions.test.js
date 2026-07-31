import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogs } from '../src/config.js';
import { resolvePrintProfile } from '../src/providers/profile-resolver.js';
import { prepareOrcaProfiles } from '../src/providers/engines/orca.js';

function fakeSelection(profile) {
  const machineName = `${profile.printer_label} ${profile.nozzle_mm} nozzle`;
  return {
    machine: { name: machineName, type: 'machine', nozzle_diameter: [String(profile.nozzle_mm)] },
    process: { name: `Process ${profile.layer_height_mm}`, type: 'process' },
    filament: { name: `Generic ${profile.material_id.toUpperCase()}`, type: 'filament' },
    machineEntry: { value: { name: machineName, type: 'machine' } },
    processEntry: { value: { name: `Process ${profile.layer_height_mm}`, type: 'process' } },
    filamentEntry: { value: { name: `Generic ${profile.material_id.toUpperCase()}`, type: 'filament' } }
  };
}

const platePrefix = {
  'Cool Plate': 'cool_plate',
  'High Temp Plate': 'hot_plate',
  'Textured PEI Plate': 'textured_plate',
  'Engineering Plate': 'eng_plate'
};

test('tutte le 640 combinazioni Orca generano profili coerenti', () => {
  let checked = 0;
  for (const printerId of ['bambu-x1c', 'snapmaker-u1']) {
    const printer = catalogs.printers[printerId];
    for (const nozzleMm of printer.nozzles) {
      for (const materialId of printer.materials) {
        for (const qualityId of Object.keys(catalogs.qualities)) {
          for (const strengthId of Object.keys(catalogs.strengths)) {
            const profile = resolvePrintProfile({ printerId, nozzleMm, materialId, qualityId, strengthId });
            const { processProfile, filament } = prepareOrcaProfiles(fakeSelection(profile), printer, profile);
            const supportWidth = Number(processProfile.support_line_width);
            const tipDiameter = Number(processProfile.tree_support_tip_diameter);
            assert.ok(Number.isFinite(supportWidth) && supportWidth >= nozzleMm, `${printerId}/${nozzleMm}: support width`);
            assert.ok(Number.isFinite(tipDiameter) && tipDiameter >= supportWidth, `${printerId}/${nozzleMm}: tree tip`);
            assert.equal(processProfile.support_type, nozzleMm >= 0.8 ? 'normal(auto)' : 'tree(auto)');

            if (printerId === 'bambu-x1c') {
              const expectedPlate = printer.orca.bed_type_by_material[materialId];
              assert.equal(processProfile.curr_bed_type, expectedPlate);
              const prefix = platePrefix[expectedPlate];
              assert.ok(prefix, `plate non mappato: ${expectedPlate}`);
              assert.ok(Number(filament[`${prefix}_temp`]?.[0]) > 0, `${materialId}: temperatura piatto`);
              assert.ok(Number(filament[`${prefix}_temp_initial_layer`]?.[0]) > 0, `${materialId}: temperatura primo layer`);
            }
            checked += 1;
          }
        }
      }
    }
  }
  assert.equal(checked, 640);
});
