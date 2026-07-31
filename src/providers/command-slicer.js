import fs from 'node:fs';
import path from 'node:path';
import { catalogs } from '../config.js';
import { getEngineInstall } from './engine-registry.js';
import { replaceTokens, runProcess } from './engine-utils.js';
import { resolvePrintProfile } from './profile-resolver.js';
import { sliceWithPrusa } from './engines/prusa.js';
import { sliceWithCura } from './engines/cura.js';
import { sliceWithOrca } from './engines/orca.js';
import { appendDiagnostic, normalizeError } from '../runtime-diagnostics.js';

async function runCustom(install, input) {
  const tokens = {
    input: input.inputPath,
    output: input.outputPath,
    printer: input.printer.id || input.profile.printer_id,
    nozzle: input.profile.nozzle_mm,
    material: input.profile.material_id,
    layer_height: input.profile.layer_height_mm,
    infill: input.profile.infill_percent,
    walls: input.profile.walls
  };
  const parts = replaceTokens([install.command, ...install.prefix], tokens);
  await runProcess(parts[0], parts.slice(1), { cwd: path.dirname(input.outputPath), diagnosticMetadata: input.diagnosticContext });
}

async function runEngine(engine, input) {
  let install = getEngineInstall(engine, { refresh: true });
  // Snapmaker Orca 2.3.5 va in access violation in modalità headless su Windows.
  // Inoltre i suoi preset 2.3.5 contengono variabili custom (es. chamber_cooling_mode)
  // che OrcaSlicer 2.4.2 non può interpretare. Per U1 usiamo quindi l'intero bundle
  // OrcaSlicer 2.4.2: binario E profili Snapmaker U1 inclusi nella stessa release.
  // Il provider logico resta snapmaker_orca per non cambiare API e routing.
  if (engine === 'snapmaker_orca' && input.printer?.id === 'snapmaker-u1') {
    const standardOrca = getEngineInstall('orca', { refresh: true });
    if (standardOrca.command && standardOrca.resources?.profiles) {
      install = {
        ...standardOrca,
        engine: 'snapmaker_orca',
        source_engine: 'orca',
        execution_mode: 'orca-2.4.2-with-bundled-snapmaker-u1-profiles'
      };
    }
  }
  if (!install.command) throw Object.assign(new Error(`Motore ${engine} non configurato.`), { code: 'engine_not_configured' });
  if (install.custom) await runCustom(install, input);
  else if (engine === 'prusa') await sliceWithPrusa({ install, ...input });
  else if (engine === 'cura') await sliceWithCura({ install, ...input });
  else if (engine === 'orca' || engine === 'snapmaker_orca') await sliceWithOrca({ install, ...input });
  else throw new Error(`Motore ${engine} non supportato per il G-code.`);
  if (!fs.existsSync(input.outputPath) || fs.statSync(input.outputPath).size < 100) {
    throw Object.assign(new Error(`${engine} non ha prodotto un G-code valido.`), { code: 'empty_gcode' });
  }
}

export class CommandSlicerProvider {
  constructor() { this.id = 'affetta-router'; }

  async slice({ inputPath, outputPath, printer, options, engineCandidates = null, diagnosticContext = {} }) {
    const profile = resolvePrintProfile({
      printerId: options.printer_id,
      nozzleMm: options.nozzle_mm,
      materialId: options.material_id,
      qualityId: options.quality_id,
      strengthId: options.strength_id
    });
    const attempts = [];
    const engines = Array.isArray(engineCandidates) && engineCandidates.length ? engineCandidates : printer.engines;
    for (const engine of engines) {
      const attemptStartedAt = Date.now();
      appendDiagnostic('slice_engine_attempt_started', {
        engine,
        printer_id: printer.id,
        input_path: inputPath,
        output_path: outputPath,
        memory: process.memoryUsage()
      });
      try {
        fs.rmSync(outputPath, { force: true });
        await runEngine(engine, { inputPath, outputPath, printer, options, profile, diagnosticContext: { ...diagnosticContext, engine, printer_id: printer.id } });
        appendDiagnostic('slice_engine_attempt_completed', {
          engine,
          printer_id: printer.id,
          duration_ms: Date.now() - attemptStartedAt,
          output_bytes: fs.statSync(outputPath).size,
          memory: process.memoryUsage()
        });
        return { provider: engine, outputPath, profile, attempts };
      } catch (error) {
        appendDiagnostic('slice_engine_attempt_failed', {
          engine,
          printer_id: printer.id,
          duration_ms: Date.now() - attemptStartedAt,
          error: normalizeError(error),
          memory: process.memoryUsage()
        });
        attempts.push({ engine, code: error.code || 'engine_failed', message: error.message });
      }
    }
    const summary = attempts.map((attempt) => `${attempt.engine}: ${attempt.message}`).join(' | ');
    throw Object.assign(new Error(`Nessun motore compatibile ha completato lo slicing. ${summary}`), { code: 'all_engines_failed', attempts });
  }
}

export function resolvePrinter(id) {
  const printer = catalogs.printers[id];
  return printer ? { id, ...printer } : null;
}
