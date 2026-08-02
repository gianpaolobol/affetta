import fs from 'node:fs';
import path from 'node:path';
import { catalogs, config } from '../src/config.js';
import { resolvePrintProfile } from '../src/providers/profile-resolver.js';

const results = [];
const errors = [];
for (const unit of catalogs.fleet.units) {
  if (!unit.enabled) continue;
  if (unit.pool && Number(unit.configured_units || 0) <= 0) continue;
  const printer = catalogs.printers[unit.printer_id];
  if (!printer) {
    errors.push({ unit_id:unit.id, error:'printer_missing' });
    continue;
  }
  if ((printer.technology || 'fff') !== 'fff') {
    results.push({ unit_id:unit.id, printer_id:unit.printer_id, technology:printer.technology, mode:'manual', slicer:printer.resin?.slicer || printer.engines[0] });
    continue;
  }
  for (const materialId of unit.material_ids || printer.materials) {
    if ((catalogs.materials[materialId]?.technology || 'fff') !== 'fff') continue;
    for (const qualityId of unit.quality_ids || ['standard']) {
      for (const strengthId of unit.strength_ids || ['standard']) {
        try {
          const profile = resolvePrintProfile({
            printerId:unit.printer_id,
            nozzleMm:Number(unit.default_nozzle_mm),
            materialId, qualityId, strengthId
          });
          results.push({
            unit_id:unit.id, printer_id:unit.printer_id, material_id:materialId,
            quality_id:qualityId, strength_id:strengthId,
            nozzle_mm:profile.nozzle_mm, filament_diameter_mm:profile.filament_diameter_mm,
            layer_height_mm:profile.layer_height_mm, engine_candidates:profile.engines
          });
        } catch (error) {
          errors.push({ unit_id:unit.id, printer_id:unit.printer_id, material_id:materialId, quality_id:qualityId, strength_id:strengthId, error:error.message });
        }
      }
    }
  }
}
const payload = {
  success:errors.length === 0,
  version:config.version,
  fleet_id:catalogs.fleet.id,
  generated_at:new Date().toISOString(),
  profiles_checked:results.length,
  errors,
  results
};
const out = path.join(config.dataDir, 'fleet-profile-selftest.json');
fs.mkdirSync(config.dataDir, { recursive:true });
fs.writeFileSync(out, JSON.stringify(payload,null,2));
console.log(JSON.stringify({ success:payload.success, version:payload.version, profiles_checked:payload.profiles_checked, errors:errors.length, output:out },null,2));
if (errors.length) process.exitCode=1;
