import fs from 'node:fs';
import { getEngineInstall } from '../engine-registry.js';
import { runProcess } from '../engine-utils.js';

export function buildGpxArgs({ install, inputPath, outputPath, postprocess }) {
  const machine = postprocess?.machine || 't6';
  const filament = Number(postprocess?.filament_diameter_mm || 2.85);
  const flavorFlag = postprocess?.gcode_flavor === 'makerbot' ? '-g' : '-r';
  return [
    ...install.prefix,
    flavorFlag,
    '-p',
    '-m', machine,
    '-f', String(filament),
    inputPath,
    outputPath
  ];
}

export async function convertGcodeToX3g({ inputPath, outputPath, postprocess, diagnosticContext = {} }) {
  const install = getEngineInstall('gpx');
  if (!install.command) {
    throw Object.assign(
      new Error('GPX non configurato. Copia gpx.exe in C:\\AFFETTA_RUNTIME\\engines\\gpx e imposta GPX_BIN nel file .env.'),
      { code: 'gpx_not_configured', stage: 'postprocess_gpx' }
    );
  }

  const args = buildGpxArgs({ install, inputPath, outputPath, postprocess });
  const execution = await runProcess(install.command, args, {
    timeoutMs: 180_000,
    diagnosticMetadata: { ...diagnosticContext, engine: 'gpx', input_path: inputPath, output_path: outputPath }
  });

  if (!fs.existsSync(outputPath)) {
    throw Object.assign(new Error('GPX non ha prodotto il file X3G.'), { code: 'gpx_output_missing', stage: 'postprocess_gpx' });
  }
  const stat = fs.statSync(outputPath);
  if (stat.size < 64) {
    throw Object.assign(new Error('Il file X3G prodotto da GPX è vuoto o incompleto.'), { code: 'gpx_output_invalid', stage: 'postprocess_gpx' });
  }

  return {
    engine: 'gpx',
    command: install.command,
    machine: postprocess?.machine || 't6',
    output_format: 'x3g',
    bytes: stat.size,
    execution
  };
}
