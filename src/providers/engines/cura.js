import fs from 'node:fs';
import path from 'node:path';
import { findFileRecursive, runProcess } from '../engine-utils.js';

function setting(key, value) {
  return ['-s', `${key}=${String(value).replace(/\r?\n/g, '\\n')}`];
}

function motionCount(text) {
  return (String(text || '').match(/^(?:G0|G1)\b.*(?:X|Y|E)/gmi) || []).length;
}

function findInRoots(roots, names) {
  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    const found = findFileRecursive(root, names);
    if (found) return found;
  }
  return null;
}

export function buildCuraArgs({ install, inputPath, outputPath, profile, definitions, extruders, machineDef, extruderDef }) {
  const searchRoots = [...new Set([definitions, extruders].filter(Boolean))];
  const definitionSearchPath = searchRoots.join(path.delimiter);
  const centerX = profile.origin_center ? 0 : profile.build_mm[0] / 2;
  const centerY = profile.origin_center ? 0 : profile.build_mm[1] / 2;

  // CuraEngine CLI 5.x: carichiamo una definizione macchina che eredita fdmprinter,
  // selezioniamo l'estrusore e poi applichiamo un set completo di override prima della mesh.
  return [
    ...install.prefix,
    'slice', '-v', '-p', '-d', definitionSearchPath,
    '-j', machineDef,
    '-e0', '-j', extruderDef,
    ...setting('extruder_nr', 0),
    ...setting('center_object', 'true'),
    ...setting('mesh_position_x', centerX),
    ...setting('mesh_position_y', centerY),
    ...setting('mesh_position_z', 0),
    ...setting('machine_width', profile.build_mm[0]),
    ...setting('machine_depth', profile.build_mm[1]),
    ...setting('machine_height', profile.build_mm[2]),
    ...setting('machine_shape', profile.bed_shape === 'circular' ? 'elliptic' : 'rectangular'),
    ...setting('machine_center_is_zero', profile.origin_center ? 'true' : 'false'),
    ...setting('machine_extruder_count', 1),
    ...setting('machine_heated_bed', profile.bed_temperature_c > 0 ? 'true' : 'false'),
    ...setting('machine_gcode_flavor', 'RepRap (Marlin/Sprinter)'),
    ...setting('machine_nozzle_size', profile.nozzle_mm),
    ...setting('material_diameter', profile.filament_diameter_mm),
    ...setting('layer_height', profile.layer_height_mm),
    ...setting('layer_height_0', profile.first_layer_height_mm),
    ...setting('line_width', profile.line_width_mm),
    ...setting('wall_line_width_0', profile.line_width_mm),
    ...setting('wall_line_width_x', profile.line_width_mm),
    ...setting('wall_line_count', profile.walls),
    ...setting('infill_sparse_density', profile.infill_percent),
    ...setting('infill_pattern', profile.engine_specific.cura_pattern),
    ...setting('top_layers', profile.top_layers),
    ...setting('bottom_layers', profile.bottom_layers),
    ...setting('roofing_layer_count', Math.min(1, profile.top_layers)),
    ...setting('flooring_layer_count', Math.min(1, profile.bottom_layers)),
    ...setting('material_print_temperature', profile.temperature_c),
    ...setting('material_print_temperature_layer_0', profile.first_layer_temperature_c),
    ...setting('material_bed_temperature', profile.bed_temperature_c),
    ...setting('material_bed_temperature_layer_0', profile.first_layer_bed_temperature_c),
    ...setting('material_flow', 100),
    ...setting('speed_print', profile.print_speed_mm_s),
    ...setting('speed_wall', profile.inner_wall_speed_mm_s),
    ...setting('speed_wall_0', profile.outer_wall_speed_mm_s),
    ...setting('speed_wall_x', profile.inner_wall_speed_mm_s),
    ...setting('speed_infill', profile.infill_speed_mm_s),
    ...setting('speed_topbottom', profile.top_speed_mm_s),
    ...setting('speed_travel', profile.travel_speed_mm_s),
    ...setting('speed_layer_0', profile.first_layer_speed_mm_s),
    ...setting('acceleration_enabled', 'true'),
    ...setting('acceleration_print', profile.max_acceleration_mm_s2),
    ...setting('retraction_enable', 'true'),
    ...setting('retraction_amount', profile.retract_length_mm),
    ...setting('retraction_speed', profile.retract_speed_mm_s),
    ...setting('retraction_hop', profile.z_hop_mm),
    ...setting('cool_fan_enabled', profile.fan_percent > 0 ? 'true' : 'false'),
    ...setting('cool_fan_speed', profile.fan_percent),
    ...setting('support_enable', profile.supports.enabled ? 'true' : 'false'),
    ...setting('support_type', profile.supports.buildplate_only ? 'buildplate' : 'everywhere'),
    ...setting('support_angle', profile.supports.threshold_deg),
    ...setting('support_z_seam_away_from_model', 1),
    ...setting('support_z_seam_min_distance', 1.0),
    ...setting('lightning_infill_support_angle', 40),
    ...setting('scarf_joint_seam_end_height_ratio', 0),
    ...setting('reset_flow_duration', 2.0),
    ...setting('adhesion_type', profile.adhesion),
    ...setting('wall_0_extruder_nr', 0),
    ...setting('wall_x_extruder_nr', 0),
    ...setting('infill_extruder_nr', 0),
    ...setting('top_bottom_extruder_nr', 0),
    ...setting('support_extruder_nr', 0),
    ...setting('support_infill_extruder_nr', 0),
    ...setting('support_interface_extruder_nr', 0),
    ...setting('adhesion_extruder_nr', 0),
    ...setting('machine_start_gcode', profile.start_gcode),
    ...setting('machine_end_gcode', profile.end_gcode),
    '-l', inputPath,
    '-o', outputPath
  ];
}

export async function sliceWithCura({ install, inputPath, outputPath, printer, profile, diagnosticContext = {} }) {
  const definitions = install.resources.definitions;
  if (!definitions) throw Object.assign(new Error('Cartella definitions di Cura non trovata.'), { code: 'cura_resources_missing' });
  const resourceRoot = path.dirname(definitions);
  const extruders = fs.existsSync(path.join(resourceRoot, 'extruders')) ? path.join(resourceRoot, 'extruders') : definitions;
  const roots = [definitions, extruders];
  const baseDef = findInRoots(roots, ['fdmprinter.def.json']);
  const machineDef = findInRoots(roots, printer.cura?.definitions || []) || baseDef;
  const extruderDef = findInRoots(roots, printer.cura?.extruders || ['fdmextruder.def.json']);
  if (!machineDef || !extruderDef) throw Object.assign(new Error(`Definizione Cura non trovata per ${printer.label}.`), { code: 'cura_profile_missing' });

  const args = buildCuraArgs({ install, inputPath, outputPath, profile, definitions, extruders, machineDef, extruderDef });
  let processError = null;
  try {
    await runProcess(install.command, args, { cwd: path.dirname(outputPath), diagnosticMetadata: diagnosticContext });
  } catch (error) {
    processError = error;
  }

  let text = '';
  try { text = fs.readFileSync(outputPath, 'utf8'); } catch {}
  const hasToolpath = motionCount(text) >= 20 && /^(?:G0|G1)\b.*\bE-?\d+(?:\.\d+)?/gmi.test(text);
  if (!hasToolpath) {
    const detail = processError ? ` ${String(processError.stderr || processError.stdout || processError.message).slice(0, 1200)}` : '';
    throw Object.assign(new Error(`CuraEngine non ha prodotto percorsi di estrusione validi.${detail}`), { code: 'cura_empty_toolpath' });
  }
  return {
    profile_files: [machineDef, extruderDef],
    warning: processError ? `CuraEngine ha restituito il codice ${processError.exitCode ?? 'non zero'}, ma il G-code completo è stato verificato.` : null
  };
}
