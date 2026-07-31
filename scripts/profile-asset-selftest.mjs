import path from 'node:path';
import { getEngineInstall } from '../src/providers/engine-registry.js';
import { resolvePrinter } from '../src/providers/command-slicer.js';
import { resolvePrintProfile } from '../src/providers/profile-resolver.js';
import { resolveOrcaPresetSelection } from '../src/providers/engines/orca.js';

const cases = [
  { engine:'orca', printer_id:'bambu-x1c', nozzles:[0.2,0.4,0.6,0.8], materials:['pla','petg','abs','asa','tpu'] },
  { engine:'orca', printer_id:'voron-24', nozzles:[0.4,0.6,0.8], materials:['pla','petg','abs','asa','tpu'] },
  { engine:'snapmaker_orca', printer_id:'snapmaker-u1', nozzles:[0.2,0.4,0.6,0.8], materials:['pla','petg','abs','asa','tpu'] }
];
const qualities = ['draft','standard','high','ultra'];
const report = { generated_at:new Date().toISOString(), cases:[], totals:{ok:0,failed:0} };

for (const item of cases) {
  const runtimeEngine = item.engine === 'snapmaker_orca' ? 'orca' : item.engine;
  const install = getEngineInstall(runtimeEngine, { refresh:true });
  const profilesRoot = install.resources?.profiles;
  if (!profilesRoot) {
    report.cases.push({ engine:item.engine, printer_id:item.printer_id, ok:false, error:'profiles_missing' });
    report.totals.failed++;
    continue;
  }
  for (const nozzle of item.nozzles) for (const material of item.materials) for (const quality of qualities) {
    try {
      const printer = resolvePrinter(item.printer_id);
      const profile = resolvePrintProfile({ printerId:item.printer_id, nozzleMm:nozzle, materialId:material, qualityId:quality, strengthId:'standard' });
      const selected = resolveOrcaPresetSelection({ profilesRoot, printer, profile });
      report.cases.push({
        engine:item.engine,
        runtime_engine:runtimeEngine,
        printer_id:item.printer_id,
        nozzle_mm:nozzle,
        material,
        quality,
        ok:true,
        machine:selected.machineEntry.value.name,
        process:selected.processEntry.value.name,
        filament:selected.filamentEntry.value.name,
        files:[selected.machineEntry.file,selected.processEntry.file,selected.filamentEntry.file].map((f)=>path.relative(profilesRoot,f).replaceAll('\\','/'))
      });
      report.totals.ok++;
    } catch (error) {
      report.cases.push({ engine:item.engine, printer_id:item.printer_id, nozzle_mm:nozzle, material, quality, ok:false, code:error.code, error:error.message });
      report.totals.failed++;
    }
  }
}
console.log(JSON.stringify(report,null,2));
if (report.totals.failed) process.exitCode=1;
