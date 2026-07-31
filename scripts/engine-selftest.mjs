import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadEnvFile } from '../src/env.js';

loadEnvFile(path.resolve('.env'));
const { catalogs, config } = await import('../src/config.js');
const { probeEngine, getEngineInstall } = await import('../src/providers/engine-registry.js');
const { CommandSlicerProvider, resolvePrinter } = await import('../src/providers/command-slicer.js');
const { analyzeGcode } = await import('../src/gcode.js');
const { validateGcode } = await import('../src/gcode-validator.js');
const { resolvePrintProfile } = await import('../src/providers/profile-resolver.js');
const { resolveOrcaPresetSelection } = await import('../src/providers/engines/orca.js');

const sample = path.resolve('samples/cube20.stl');
const mandatoryCases = {
  prusa: { printer_id:'prusa-mk4', nozzle_mm:0.4, material_id:'pla', quality_id:'standard', strength_id:'standard', expected:'prusa' },
  marlin: { printer_id:'creality-ender3', nozzle_mm:0.4, material_id:'pla', quality_id:'standard', strength_id:'standard', expected:'prusa' },
  orca: { printer_id:'bambu-x1c', nozzle_mm:0.4, material_id:'pla', quality_id:'standard', strength_id:'standard', expected:'orca' },
  snapmaker: { printer_id:'snapmaker-u1', nozzle_mm:0.4, material_id:'pla', quality_id:'standard', strength_id:'standard', expected:'snapmaker_orca' }
};
const report = { version:config.version, generated_at:new Date().toISOString(), production_routes:{}, optional_engines:{} };
let failed = 0;

async function testRoute(name, options) {
  const engine = options.expected;
  const runtimeEngine = engine === 'snapmaker_orca' ? 'orca' : engine;
  const probe = await probeEngine(runtimeEngine, { refresh:true });
  const result = {
    expected_provider:engine,
    runtime_engine:runtimeEngine,
    detected:probe.available,
    resources_ready:probe.resources_ready,
    detail:probe.detail?.split('\n')[0] || ''
  };
  report.production_routes[name] = result;
  if (!probe.available || probe.resources_ready === false) { result.ok=false; result.error='Motore o risorse non disponibili.'; failed++; return; }
  if (engine === 'orca' || engine === 'snapmaker_orca') {
    const printer = resolvePrinter(options.printer_id);
    const profile = resolvePrintProfile({ printerId:options.printer_id, nozzleMm:options.nozzle_mm, materialId:options.material_id, qualityId:options.quality_id, strengthId:options.strength_id });
    const install = getEngineInstall(runtimeEngine, { refresh:true });
    const selected = resolveOrcaPresetSelection({ profilesRoot:install.resources.profiles, printer, profile });
    result.profile_source = runtimeEngine === 'orca' && engine === 'snapmaker_orca'
      ? 'OrcaSlicer 2.4.2 / profili Snapmaker U1 inclusi'
      : runtimeEngine;
    result.presets = { machine:selected.machineEntry.value.name, process:selected.processEntry.value.name, filament:selected.filamentEntry.value.name };
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),`affetta-selftest-${name}-`));
  const output = path.join(temp,'cube20.gcode');
  try {
    const printer = resolvePrinter(options.printer_id);
    const routed = await new CommandSlicerProvider().slice({ inputPath:sample, outputPath:output, printer, options });
    const text = fs.readFileSync(output,'utf8');
    const stats = analyzeGcode(text, { densityGcm3:catalogs.materials[options.material_id].density_g_cm3 });
    const validation = validateGcode(text, { buildMm:printer.build_mm, material:catalogs.materials[options.material_id], motionBoundsMm:printer.validation?.motion_bounds_mm });
    result.actual_provider = routed.provider;
    result.attempts = routed.attempts || [];
    result.ok = routed.provider === engine && validation.valid;
    result.gcode_bytes = fs.statSync(output).size;
    result.motion_lines = validation.observed?.motion_lines || 0;
    result.filament_g = stats.filament_g;
    result.validation_errors = validation.errors;
    result.validation_warnings = validation.warnings;
    if (!result.ok) failed++;
  } catch (error) {
    result.ok=false; result.error=error.message; result.attempts=error.attempts || []; failed++;
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}

for (const [name, options] of Object.entries(mandatoryCases)) await testRoute(name, options);

// CuraEngine CLI resta disponibile come motore opzionale/diagnostico. La GUI Cura usa
// il protocollo Arcus/Protobuf, non questa CLI; un suo errore non blocca Affetta perché
// le stampanti Marlin vengono servite da PrusaSlicer, già verificato.
{
  const engine='cura';
  const options={printer_id:'creality-ender3',nozzle_mm:0.4,material_id:'pla',quality_id:'standard',strength_id:'standard'};
  const probe=await probeEngine(engine,{refresh:true});
  const result={detected:probe.available,resources_ready:probe.resources_ready,blocking:false,detail:probe.detail?.split('\n')[0]||''};
  report.optional_engines.cura=result;
  if (probe.available && probe.resources_ready !== false) {
    const temp=fs.mkdtempSync(path.join(os.tmpdir(),'affetta-selftest-cura-'));
    const output=path.join(temp,'cube20.gcode');
    try {
      const printer=resolvePrinter(options.printer_id);
      const routed=await new CommandSlicerProvider().slice({inputPath:sample,outputPath:output,printer,options,engineCandidates:['cura']});
      result.ok=routed.provider==='cura';
      result.gcode_bytes=fs.statSync(output).size;
    } catch(error) { result.ok=false; result.warning=error.message; }
    finally { fs.rmSync(temp,{recursive:true,force:true}); }
  }
}

report.summary = {
  passed: Object.values(report.production_routes).filter((item) => item.ok).length,
  failed,
  ok: failed === 0
};
console.log(JSON.stringify(report,null,2));
if (failed) process.exitCode=1;
