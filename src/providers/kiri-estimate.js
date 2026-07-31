import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.js';
import { analyzeGcode } from '../gcode.js';
import { splitCommand } from '../utils.js';

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`Kiri:Moto CLI terminato con codice ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

export class KiriEstimateProvider {
  constructor() { this.id = 'kiri-moto'; }
  isConfigured() { return Boolean(config.kiriCliCommand.trim()); }

  async estimate({ modelBuffer, filename, material, quality, strength }) {
    if (!this.isConfigured()) throw new Error('KIRI_CLI_COMMAND non configurato.');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-kiri-'));
    try {
      const modelPath = path.join(tmp, filename);
      const outputPath = path.join(tmp, 'estimate.gcode');
      const devicePath = path.join(tmp, 'device.json');
      const processPath = path.join(tmp, 'process.json');
      const controllerPath = path.join(tmp, 'controller.json');
      fs.writeFileSync(modelPath, modelBuffer);
      fs.writeFileSync(devicePath, JSON.stringify({
        bedWidth: 300, bedDepth: 300, bedHeight: 2.5, maxHeight: 300,
        nozzleSize: 0.4, filamentSize: 1.75, originCenter: false,
        extrudeAbs: true,
        gcodePre: ['G90', 'M82', `M104 S${material.nozzle_c}`, `M140 S${material.bed_c}`, 'G28', 'G92 E0'],
        gcodePost: ['M104 S0', 'M140 S0', 'M107', 'M84']
      }, null, 2));
      fs.writeFileSync(processPath, JSON.stringify({
        sliceHeight: quality.layer_height_mm,
        sliceShells: strength.walls,
        sliceFillSparse: strength.infill_percent / 100,
        sliceFillType: strength.pattern,
        sliceTopLayers: quality.top_layers,
        sliceBottomLayers: quality.bottom_layers,
        outputFeedrate: quality.speed_mm_s,
        outputSeekrate: Math.max(80, quality.speed_mm_s * 2.2),
        outputTemp: material.nozzle_c,
        outputBedTemp: material.bed_c,
        sliceSupportEnable: true,
        sliceSupportDensity: 0.15
      }, null, 2));
      fs.writeFileSync(controllerPath, JSON.stringify({ threaded: true }, null, 2));

      const parts = splitCommand(config.kiriCliCommand);
      if (!parts.length) throw new Error('Comando Kiri:Moto vuoto.');
      await run(parts[0], [
        ...parts.slice(1),
        `--model=${modelPath}`,
        `--device=${devicePath}`,
        `--process=${processPath}`,
        `--controller=${controllerPath}`,
        `--output=${outputPath}`
      ], { cwd: tmp });
      if (!fs.existsSync(outputPath)) throw new Error('Kiri:Moto non ha prodotto il G-code di stima.');
      const gcode = fs.readFileSync(outputPath, 'utf8');
      const stats = analyzeGcode(gcode, { densityGcm3: material.density_g_cm3 });
      return { provider: this.id, estimate_quality: 'slicer', ...stats, warnings: [] };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}
