import fs from 'node:fs';
import path from 'node:path';

const [unitId, readyText] = process.argv.slice(2);
if (!unitId || !['true','false'].includes(String(readyText).toLowerCase())) {
  console.error('Uso: node scripts/set-fleet-unit-ready.mjs <unit_id> <true|false>');
  process.exit(2);
}
const ready = String(readyText).toLowerCase() === 'true';
const file = path.resolve('config/fleet.json');
const fleet = JSON.parse(fs.readFileSync(file, 'utf8'));
const unit = fleet.units.find((item) => item.id === unitId);
if (!unit) {
  console.error(`Unità non trovata: ${unitId}`);
  process.exit(3);
}
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = `${file}.bak-${timestamp}`;
fs.copyFileSync(file, backup);
unit.production_ready = ready;
unit.calibration_status = ready ? 'physical-validated' : 'pending-physical-calibration';
unit.calibration_updated_at = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(fleet, null, 2) + '\n');
console.log(JSON.stringify({ success:true, unit_id:unitId, production_ready:ready, calibration_status:unit.calibration_status, backup }, null, 2));
