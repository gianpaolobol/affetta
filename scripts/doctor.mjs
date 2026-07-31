import path from 'node:path';
import { loadEnvFile } from '../src/env.js';
loadEnvFile(path.resolve('.env'));
const { catalogs, config } = await import('../src/config.js');
const { systemCapabilities } = await import('../src/providers/engine-registry.js');
const report = await systemCapabilities(catalogs.printers, { refresh:true });
console.log(`Affetta ${config.version}`);
console.log(`Preventivazione: ${report.estimate.ready ? 'PRONTA' : 'NON PRONTA'}${report.estimate.slicer_available ? ' (Kiri:Moto)' : report.estimate.geometry_fallback ? ' (stima geometrica)' : ''}`);
console.log('\nMotori:');
for (const [engine, status] of Object.entries(report.engines)) {
  const resources = status.resources_ready === false ? ' — risorse mancanti' : '';
  console.log(`${engine.padEnd(6)} ${status.available ? 'OK' : '--'}  ${status.version || ''} ${status.detail.split('\n')[0]}${resources}`.trimEnd());
}
console.log(`\nProfili G-code disponibili: ${report.slicing.ready_printers}/${report.slicing.total_printers}`);
for (const [id, item] of Object.entries(report.slicing.printers)) {
  console.log(`${item.slice_available ? 'OK' : '--'} ${catalogs.printers[id].label}`);
}
if (!report.slicing.ready_printers) console.log('\nInstalla PrusaSlicer e OrcaSlicer, poi esegui VERIFICA_MOTORI_AFFETTA.cmd.');
