import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { listFilesRecursive, runProcess } from '../engine-utils.js';

const indexCache = new Map();

function allProfileObjects(value, file, out) {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value) && typeof value.name === 'string' && (value.type || value.printer_model || value.filament_type || value.print_settings_id)) out.push({ file, value });
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') allProfileObjects(child, file, out);
  }
}

function buildIndex(root) {
  if (indexCache.has(root)) return indexCache.get(root);
  const entries = [];
  for (const file of listFilesRecursive(root, (_, name) => name.toLowerCase().endsWith('.json'))) {
    try { allProfileObjects(JSON.parse(fs.readFileSync(file, 'utf8')), file, entries); } catch {}
  }
  const byName = new Map();
  for (const entry of entries) {
    const name = String(entry.value.name).toLowerCase();
    const list = byName.get(name) || [];
    list.push(entry);
    byName.set(name, list);
  }
  const index = { entries, byName };
  indexCache.set(root, index);
  return index;
}

function includesAny(text, patterns = []) {
  const lower = String(text || '').toLowerCase();
  return patterns.some((pattern) => lower.includes(String(pattern).toLowerCase()));
}

function nozzleMatches(value, nozzle) {
  const values = Array.isArray(value) ? value : [value];
  return values.some((item) => Math.abs(Number(item) - nozzle) < 0.001);
}

function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

function compatibilityScore(value, machineName) {
  const target = normalized(machineName);
  const compat = Array.isArray(value.compatible_printers) ? value.compatible_printers.map(normalized).filter(Boolean) : [];
  if (!compat.length) return 0;
  if (compat.includes(target)) return 300;
  if (compat.some((item) => item.includes(target) || target.includes(item))) return 180;
  return -1000;
}

function profileAffinity(entry, machine) {
  return directoryAffinity(entry.file, machine.file) * 8;
}

function findMachine(index, printer, profile) {
  const patterns = printer.orca?.machine_patterns || [printer.label];
  const matches = index.entries.filter(({ value }) => {
    const name = value.name || '';
    const typeOk = value.type === 'machine' || value.printer_model || value.nozzle_diameter;
    return typeOk && includesAny(`${name} ${value.printer_model || ''}`, patterns) && nozzleMatches(value.nozzle_diameter || profile.nozzle_mm, profile.nozzle_mm);
  });
  return matches.sort((a, b) => {
    const score = (entry) => {
      const text = `${entry.value.name || ''} ${entry.value.printer_model || ''}`;
      const longestPattern = Math.max(0, ...patterns.filter((pattern) => normalized(text).includes(normalized(pattern))).map((pattern) => String(pattern).length));
      const buildToken = String(profile.build_mm[0]);
      const buildMatch = normalized(text).includes(buildToken) ? 120 : 0;
      const labelMatch = normalized(text).includes(normalized(printer.label)) ? 80 : 0;
      const realProfile = entry.value.type === 'machine' ? 80 : 0;
      return longestPattern * 4 + buildMatch + labelMatch + realProfile - String(entry.value.name || '').length * 0.01;
    };
    return score(b) - score(a);
  })[0] || null;
}

function findProcess(index, printer, machine, profile) {
  const layerToken = profile.layer_height_mm.toFixed(2);
  const machineName = String(machine.value.name || '');
  const candidates = index.entries.filter(({ value }) => {
    const name = String(value.name || '');
    const typeOk = value.type === 'process' || value.print_settings_id != null || value.layer_height != null;
    const layerMatch = name.includes(`${layerToken}mm`) || name.includes(`${layerToken} `) || Number(value.layer_height) === profile.layer_height_mm;
    return typeOk && (layerMatch || includesAny(name, printer.orca?.process_patterns || []));
  });
  return candidates.sort((a, b) => {
    const score = (entry) => {
      const value = entry.value;
      const name = String(value.name || '');
      const compat = compatibilityScore(value, machineName);
      const exactLayer = name.includes(`${layerToken}mm`) || name.includes(`${layerToken} `) || Number(value.layer_height) === profile.layer_height_mm ? 100 : 0;
      const printerName = normalized(name).includes(normalized(printer.label)) || normalized(name).includes(normalized(machine.value.printer_model)) ? 70 : 0;
      const standard = /standard|quality|fine|draft|strength/i.test(name) ? 30 : 0;
      const instantiated = String(value.instantiation || '').toLowerCase() === 'true' ? 260 : String(value.instantiation || '').toLowerCase() === 'false' ? -220 : 0;
      const internalPenalty = /(?:^|[_ ])(?:common|base)(?:$|[_ ])/i.test(name) ? -180 : 0;
      return compat + profileAffinity(entry, machine) + exactLayer + printerName + standard + instantiated + internalPenalty;
    };
    return score(b) - score(a);
  }).find((entry) => compatibilityScore(entry.value, machineName) > -1000) || null;
}

function findFilament(index, machine, profile) {
  const type = profile.material_id.toUpperCase();
  const machineName = String(machine.value.name || '');
  const materialPattern = new RegExp(`(^|[^A-Z])${type}([^A-Z]|$)`);
  const candidates = index.entries.filter((entry) => {
    const value = entry.value;
    const name = String(value.name || '').toUpperCase();
    const directType = String(value.filament_type || '').toUpperCase();
    const likelyMaterial = directType === type || materialPattern.test(name);
    if (!likelyMaterial) return false;
    const isFilament = value.type === 'filament' || value.filament_settings_id != null || directType || /filament/i.test(entry.file);
    return Boolean(isFilament) && compatibilityScore(value, machineName) > -1000;
  });
  return candidates.sort((a, b) => {
    const score = (entry) => {
      const value = entry.value;
      const name = String(value.name || '');
      const compat = compatibilityScore(value, machineName);
      const machineHint = normalized(name).includes(normalized(machine.value.printer_model)) || normalized(name).includes(normalized(machineName)) ? 80 : 0;
      const isGeneric = /generic/i.test(name);
      const generic = isGeneric ? 180 : -260;
      const exactGeneric = normalized(name) === normalized(`Generic ${type}`) ? 260 : /^generic\s+[^@]+\s+@base/i.test(name) ? 170 : 0;
      // I profili @System della Orca Filament Library sono generici e compatibili
      // con stampanti vendor diverse. Devono precedere profili branded anche se questi
      // dichiarano compatibilità con la macchina.
      const systemGeneric = /@system\b/i.test(name) || /OrcaFilamentLibrary[\\/]filament/i.test(entry.file) ? 560 : 0;
      const unrelatedSuffix = compat === 0 && /@/.test(name) && !/@base/i.test(name) && !/@system/i.test(name) && !machineHint ? -120 : 0;
      const basePenalty = /\bbase\b/i.test(name) && !machineHint ? -80 : 0;
      return compat + profileAffinity(entry, machine) + machineHint + generic + exactGeneric + systemGeneric + unrelatedSuffix + basePenalty;
    };
    return score(b) - score(a);
  })[0] || null;
}

function directoryAffinity(a, b) {
  const aParts = path.resolve(a).split(path.sep);
  const bParts = path.resolve(b).split(path.sep);
  let common = 0;
  while (common < aParts.length && common < bParts.length && aParts[common].toLowerCase() === bParts[common].toLowerCase()) common++;
  return common;
}

function findParent(entry, parentName, index) {
  const candidates = index.byName.get(parentName) || [];
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) => directoryAffinity(entry.file, b.file) - directoryAffinity(entry.file, a.file))[0];
}

function flatten(entry, index, seen = new Set()) {
  if (!entry) return {};
  const identity = `${entry.file}::${String(entry.value.name || '').toLowerCase()}`;
  if (seen.has(identity)) return { ...entry.value };
  seen.add(identity);
  const parentName = String(entry.value.inherits || '').toLowerCase();
  const parent = parentName ? findParent(entry, parentName, index) : null;
  return { ...(parent ? flatten(parent, index, seen) : {}), ...entry.value, inherits: '' };
}

export function resolveOrcaPresetSelection({ profilesRoot, printer, profile }) {
  if (!profilesRoot) throw Object.assign(new Error('Radice profili OrcaSlicer mancante.'), { code: 'orca_resources_missing' });
  const index = buildIndex(profilesRoot);
  const machineEntry = findMachine(index, printer, profile);
  if (!machineEntry) throw Object.assign(new Error(`Preset OrcaSlicer non trovato per ${printer.label} con ugello ${profile.nozzle_mm} mm.`), { code: 'orca_machine_profile_missing' });
  const processEntry = findProcess(index, printer, machineEntry, profile);
  const filamentEntry = findFilament(index, machineEntry, profile);
  if (!processEntry || !filamentEntry) throw Object.assign(new Error(`Preset processo/materiale OrcaSlicer non trovato per ${printer.label}.`), { code: 'orca_process_profile_missing' });
  return {
    index,
    machineEntry,
    processEntry,
    filamentEntry,
    machine: flatten(machineEntry, index),
    process: flatten(processEntry, index),
    filament: flatten(filamentEntry, index)
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function extractGcodeFromZip(zipPath) {
  const data = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
    if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Archivio 3MF non valido.');
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(offset) !== 0x02014b50) break;
    const method = data.readUInt16LE(offset + 10);
    const compressedSize = data.readUInt32LE(offset + 20);
    const uncompressedSize = data.readUInt32LE(offset + 24);
    const nameLen = data.readUInt16LE(offset + 28);
    const extraLen = data.readUInt16LE(offset + 30);
    const commentLen = data.readUInt16LE(offset + 32);
    const localOffset = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, uncompressedSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  const entry = entries.find((item) => /(?:^|\/)plate_\d+\.gcode$/i.test(item.name)) || entries.find((item) => item.name.toLowerCase().endsWith('.gcode'));
  if (!entry) throw new Error('G-code non trovato nel file 3MF prodotto da OrcaSlicer.');
  const local = entry.localOffset;
  if (data.readUInt32LE(local) !== 0x04034b50) throw new Error('Voce ZIP non valida.');
  const nameLen = data.readUInt16LE(local + 26);
  const extraLen = data.readUInt16LE(local + 28);
  const start = local + 30 + nameLen + extraLen;
  const compressed = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(compressed);
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Metodo ZIP ${entry.method} non supportato.`);
}

function preservePresetIdentity(target, source) {
  for (const key of [
    'name', 'type', 'inherits', 'from', 'setting_id', 'instantiation',
    'printer_settings_id', 'print_settings_id', 'filament_settings_id',
    'compatible_printers', 'printer_model', 'printer_variant'
  ]) {
    if (source[key] !== undefined) target[key] = source[key];
  }
  return target;
}

function writeOrcaDiagnostic({ engine, args, temp, selection, error }) {
  try {
    const dir = path.resolve(process.env.AFFETTA_DATA_DIR || 'data', 'engine-debug');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `${stamp}-${engine || 'orca'}.json`);
    const resultJson = listFilesRecursive(temp, (filePath, name) => name.toLowerCase() === 'result.json')[0];
    const payload = {
      generated_at: new Date().toISOString(),
      engine,
      command: args,
      presets: {
        machine: selection.machineEntry.value.name,
        process: selection.processEntry.value.name,
        filament: selection.filamentEntry.value.name
      },
      error: {
        message: error?.message || String(error),
        code: error?.code || null,
        exit_code: error?.exitCode ?? null,
        stdout: error?.stdout || '',
        stderr: error?.stderr || '',
        stdout_path: error?.stdoutPath || null,
        stderr_path: error?.stderrPath || null,
        child_pid: error?.pid || null,
        duration_ms: error?.durationMs || null,
        signal: error?.signal || null
      },
      result: resultJson && fs.existsSync(resultJson)
        ? (() => { try { return JSON.parse(fs.readFileSync(resultJson, 'utf8')); } catch { return fs.readFileSync(resultJson, 'utf8'); } })()
        : null
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    return file;
  } catch {
    return null;
  }
}

const bedTemperatureKeys = {
  'Cool Plate': 'cool_plate',
  'Engineering Plate': 'eng_plate',
  'High Temp Plate': 'hot_plate',
  'Textured PEI Plate': 'textured_plate'
};

function safeSupportGeometry(profile) {
  const supportWidth = Math.max(Number(profile.line_width_mm) || 0, Number(profile.nozzle_mm) || 0.4);
  const tipDiameter = Math.max(0.8, supportWidth + 0.02);
  const branchDiameter = Math.max(2, tipDiameter * 2.2);
  return {
    supportWidth: Number(supportWidth.toFixed(2)),
    tipDiameter: Number(tipDiameter.toFixed(2)),
    branchDiameter: Number(branchDiameter.toFixed(2))
  };
}

export function prepareOrcaProfiles(selection, printer, profile) {
  const machine = preservePresetIdentity({ ...selection.machine }, selection.machineEntry.value);
  const processProfile = preservePresetIdentity({ ...selection.process }, selection.processEntry.value);
  const filament = preservePresetIdentity({ ...selection.filament }, selection.filamentEntry.value);

  // Non rinominare i preset: Orca verifica la compatibilità tramite i nomi originali.
  machine.nozzle_diameter = [String(profile.nozzle_mm)];
  machine.printable_height = String(profile.build_mm[2]);
  machine.retraction_length = [String(profile.retract_length_mm)];
  machine.retraction_speed = [String(profile.retract_speed_mm_s)];
  machine.z_hop = [String(profile.z_hop_mm)];

  processProfile.layer_height = String(profile.layer_height_mm);
  processProfile.initial_layer_print_height = String(profile.first_layer_height_mm);
  processProfile.line_width = String(profile.line_width_mm);
  processProfile.wall_loops = String(profile.walls);
  processProfile.sparse_infill_density = `${profile.infill_percent}%`;
  processProfile.sparse_infill_pattern = profile.engine_specific.orca_pattern;
  processProfile.top_shell_layers = String(profile.top_layers);
  processProfile.bottom_shell_layers = String(profile.bottom_layers);
  processProfile.outer_wall_speed = String(profile.outer_wall_speed_mm_s);
  processProfile.inner_wall_speed = String(profile.inner_wall_speed_mm_s);
  processProfile.sparse_infill_speed = String(profile.infill_speed_mm_s);
  processProfile.top_surface_speed = String(profile.top_speed_mm_s);
  processProfile.travel_speed = String(profile.travel_speed_mm_s);
  processProfile.initial_layer_speed = String(profile.first_layer_speed_mm_s);
  processProfile.enable_support = profile.supports.enabled ? '1' : '0';
  processProfile.support_threshold_angle = String(profile.supports.threshold_deg);
  processProfile.support_on_build_plate_only = profile.supports.buildplate_only ? '1' : '0';
  processProfile.support_type = profile.supports.type || (profile.nozzle_mm >= 0.8 ? 'normal(auto)' : 'tree(auto)');
  const supportGeometry = safeSupportGeometry(profile);
  processProfile.support_line_width = String(supportGeometry.supportWidth);
  processProfile.tree_support_tip_diameter = String(supportGeometry.tipDiameter);
  processProfile.tree_support_branch_diameter = String(supportGeometry.branchDiameter);
  processProfile.tree_support_branch_diameter_organic = String(supportGeometry.branchDiameter);
  processProfile.brim_width = profile.adhesion === 'brim' ? String(Math.max(4, profile.nozzle_mm * 8)) : '0';

  if (profile.build_plate) processProfile.curr_bed_type = profile.build_plate;

  // I valori filamento di Orca sono array di stringhe, anche con un solo estrusore.
  filament.filament_type = [profile.material_id.toUpperCase()];
  filament.filament_density = [String(profile.density_g_cm3)];
  filament.nozzle_temperature = [String(profile.temperature_c)];
  filament.nozzle_temperature_initial_layer = [String(profile.first_layer_temperature_c)];
  const plateTemperaturePrefix = bedTemperatureKeys[profile.build_plate] || 'hot_plate';
  const plateTempKey = `${plateTemperaturePrefix}_temp`;
  const plateInitialTempKey = `${plateTemperaturePrefix}_temp_initial_layer`;
  const existingPlateTemp = Number(Array.isArray(filament[plateTempKey]) ? filament[plateTempKey][0] : filament[plateTempKey]);
  const existingInitialPlateTemp = Number(Array.isArray(filament[plateInitialTempKey]) ? filament[plateInitialTempKey][0] : filament[plateInitialTempKey]);
  if (!(existingPlateTemp > 0)) filament[plateTempKey] = [String(profile.bed_temperature_c)];
  if (!(existingInitialPlateTemp > 0)) filament[plateInitialTempKey] = [String(profile.first_layer_bed_temperature_c)];
  filament.filament_max_volumetric_speed = [String(profile.max_volumetric_mm3_s)];
  filament.fan_max_speed = [String(profile.fan_percent)];
  filament.fan_min_speed = [String(Math.min(profile.fan_percent, 20))];

  return { machine, processProfile, filament };
}

export async function sliceWithOrca({ install, inputPath, outputPath, printer, profile, diagnosticContext = {} }) {
  const profilesRoot = install.resources.profiles;
  if (!profilesRoot) throw Object.assign(new Error('Profili OrcaSlicer non trovati vicino all’eseguibile. Usa la build ufficiale completa/portatile.'), { code: 'orca_resources_missing' });
  const selection = resolveOrcaPresetSelection({ profilesRoot, printer, profile });
  const { machineEntry, processEntry, filamentEntry } = selection;

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-orca-'));
  let keepTemp = false;
  try {
    const { machine, processProfile, filament } = prepareOrcaProfiles(selection, printer, profile);
    const machinePath = path.join(temp, 'machine.json');
    const processPath = path.join(temp, 'process.json');
    const filamentPath = path.join(temp, 'filament.json');
    const outDir = path.join(temp, 'out');
    fs.mkdirSync(outDir, { recursive: true });
    writeJson(machinePath, machine);
    writeJson(processPath, processProfile);
    writeJson(filamentPath, filament);

    // La CLI ufficiale genera direttamente il G-code/Gcode.3MF dentro outputdir.
    // --allow-newer-file e --ensure-on-bed sono flag booleani: non accettano il valore "1".
    // Non usare un datadir vuoto: alcuni fork non riescono a risolvere i preset di sistema.
    const args = [
      ...install.prefix,
      '--load-settings', `${machinePath};${processPath}`,
      '--load-filaments', filamentPath,
      '--allow-newer-file',
      '--arrange', '1',
      '--ensure-on-bed',
      '--slice', '0',
      '--outputdir', outDir,
      inputPath
    ];

    try {
      await runProcess(install.command, args, { cwd: temp, diagnosticMetadata: { ...diagnosticContext, temp_path: temp } });
    } catch (error) {
      const diagnostic = writeOrcaDiagnostic({
        engine: install.engine,
        args: [install.command, ...args],
        temp,
        selection,
        error
      });
      if (diagnostic) {
        error.message += ` Diagnostica salvata in ${diagnostic}.`;
      }
      keepTemp = process.env.AFFETTA_KEEP_ENGINE_TEMP === 'true';
      throw error;
    }

    const directGcode = listFilesRecursive(outDir, (filePath) => filePath.toLowerCase().endsWith('.gcode'))[0];
    if (directGcode) {
      fs.copyFileSync(directGcode, outputPath);
    } else {
      const archive = listFilesRecursive(outDir, (filePath) => /\.gcode\.3mf$|\.3mf$/i.test(filePath))[0];
      if (!archive) {
        const resultJson = listFilesRecursive(outDir, (filePath, name) => name.toLowerCase() === 'result.json')[0];
        const detail = resultJson ? fs.readFileSync(resultJson, 'utf8').slice(0, 1800) : '';
        throw new Error(`OrcaSlicer non ha prodotto G-code o Gcode.3MF.${detail ? ` result.json: ${detail}` : ''}`);
      }
      fs.writeFileSync(outputPath, extractGcodeFromZip(archive));
    }
    return { profile_files: [machineEntry.file, processEntry.file, filamentEntry.file] };
  } finally {
    if (!keepTemp) fs.rmSync(temp, { recursive: true, force: true });
  }
}
