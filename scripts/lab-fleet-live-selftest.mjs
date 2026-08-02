import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from '../src/env.js';

loadEnvFile(path.resolve('.env'));
const { catalogs, config } = await import('../src/config.js');
const { CommandSlicerProvider, resolvePrinter } = await import('../src/providers/command-slicer.js');
const { analyzeGcode } = await import('../src/gcode.js');
const { validateGcode } = await import('../src/gcode-validator.js');

const sample = path.resolve('samples/cube20.stl');
const report = {
  version: config.version,
  fleet_id: catalogs.fleet.id,
  generated_at: new Date().toISOString(),
  sample: path.basename(sample),
  units: [],
  summary: { passed: 0, failed: 0, manual: 0 }
};

function firstAllowed(unit, values, fallback) {
  return Array.isArray(values) && values.length ? values[0] : fallback;
}

for (const unit of catalogs.fleet.units) {
  if (!unit.enabled || (unit.pool && Number(unit.configured_units || 0) <= 0)) continue;
  const printer = resolvePrinter(unit.printer_id);
  if (!printer) {
    report.units.push({ unit_id: unit.id, ok: false, error: 'printer_missing' });
    report.summary.failed++;
    continue;
  }
  if ((printer.technology || 'fff') !== 'fff') {
    report.units.push({
      unit_id: unit.id,
      unit_label: unit.label,
      printer_id: printer.id,
      technology: printer.technology,
      mode: 'manual',
      slicer: printer.resin?.slicer || printer.engines[0],
      output_format: printer.output_format || printer.resin?.output_format || null
    });
    report.summary.manual++;
    continue;
  }

  const materialId = firstAllowed(unit, unit.material_ids || unit.preferred_materials, printer.materials[0]);
  const qualityId = unit.quality_ids?.includes('standard') ? 'standard' : firstAllowed(unit, unit.quality_ids, 'standard');
  const strengthId = unit.strength_ids?.includes('standard') ? 'standard' : firstAllowed(unit, unit.strength_ids, 'standard');
  const options = {
    printer_id: printer.id,
    nozzle_mm: Number(unit.default_nozzle_mm || printer.default_nozzle),
    material_id: materialId,
    quality_id: qualityId,
    strength_id: strengthId,
    quantity: 1,
    color_id: 'random',
    source: 'lab-fleet-live-selftest'
  };
  const result = {
    unit_id: unit.id,
    unit_label: unit.label,
    printer_id: printer.id,
    printer_label: printer.label,
    options,
    expected_engines: printer.engines
  };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `affetta-lab-${unit.id}-`));
  const output = path.join(temp, 'cube20.gcode');
  try {
    const sliced = await new CommandSlicerProvider().slice({
      inputPath: sample,
      outputPath: output,
      printer,
      options,
      diagnosticContext: { stage: 'lab_fleet_live_selftest', fleet_unit_id: unit.id }
    });
    const text = fs.readFileSync(output, 'utf8');
    const stats = analyzeGcode(text, { densityGcm3: catalogs.materials[materialId].density_g_cm3 });
    const validation = validateGcode(text, {
      buildMm: printer.build_mm,
      material: catalogs.materials[materialId],
      motionBoundsMm: printer.validation?.motion_bounds_mm
    });
    result.actual_engine = sliced.provider;
    result.fallback_attempts = sliced.attempts || [];
    result.gcode_bytes = fs.statSync(output).size;
    result.time_seconds = stats.time_seconds;
    result.filament_g = stats.filament_g;
    result.validation = validation;
    result.ok = validation.valid && result.gcode_bytes >= 100;
    if (result.ok) report.summary.passed++;
    else report.summary.failed++;
  } catch (error) {
    result.ok = false;
    result.error = error.message;
    result.code = error.code || null;
    result.attempts = error.attempts || [];
    report.summary.failed++;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
  report.units.push(result);
}

report.summary.ok = report.summary.failed === 0;
const outputPath = path.join(config.dataDir, 'lab-fleet-live-selftest.json');
fs.mkdirSync(config.dataDir, { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report.summary, output: outputPath }, null, 2));
if (report.summary.failed) process.exitCode = 1;
