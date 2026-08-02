import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runProcess } from '../engine-utils.js';

function encodeIni(value) {
  if (Array.isArray(value)) return value.join(',');
  return String(value ?? '').replace(/\r?\n/g, '\\n');
}

function bedShape(profile) {
  const [x, y] = profile.build_mm;
  if (profile.bed_shape === 'circular') {
    const radius = Number(profile.build_diameter_mm || Math.min(x, y)) / 2;
    return Array.from({ length: 32 }, (_, index) => {
      const angle = (Math.PI * 2 * index) / 32;
      return `${(Math.cos(angle) * radius).toFixed(3)}x${(Math.sin(angle) * radius).toFixed(3)}`;
    }).join(',');
  }
  if (profile.origin_center) return `${-x / 2}x${-y / 2},${x / 2}x${-y / 2},${x / 2}x${y / 2},${-x / 2}x${y / 2}`;
  return `0x0,${x}x0,${x}x${y},0x${y}`;
}

function configValues(profile) {
  return {
    printer_technology: 'FFF',
    gcode_flavor: profile.gcode_flavor,
    bed_shape: bedShape(profile),
    max_print_height: profile.build_mm[2],
    nozzle_diameter: profile.nozzle_mm,
    min_layer_height: Math.max(0.04, profile.nozzle_mm * 0.15),
    max_layer_height: profile.nozzle_mm * 0.75,
    filament_diameter: profile.filament_diameter_mm,
    layer_height: profile.layer_height_mm,
    first_layer_height: profile.first_layer_height_mm,
    extrusion_width: profile.line_width_mm,
    first_layer_extrusion_width: profile.line_width_mm,
    perimeters: profile.walls,
    fill_density: `${profile.infill_percent}%`,
    fill_pattern: profile.engine_specific.prusa_pattern,
    top_solid_layers: profile.top_layers,
    bottom_solid_layers: profile.bottom_layers,
    temperature: profile.temperature_c,
    first_layer_temperature: profile.first_layer_temperature_c,
    bed_temperature: profile.bed_temperature_c,
    first_layer_bed_temperature: profile.first_layer_bed_temperature_c,
    max_volumetric_speed: profile.max_volumetric_mm3_s,
    perimeter_speed: profile.inner_wall_speed_mm_s,
    external_perimeter_speed: profile.outer_wall_speed_mm_s,
    infill_speed: profile.infill_speed_mm_s,
    solid_infill_speed: profile.inner_wall_speed_mm_s,
    top_solid_infill_speed: profile.top_speed_mm_s,
    travel_speed: profile.travel_speed_mm_s,
    first_layer_speed: profile.first_layer_speed_mm_s,
    default_acceleration: profile.max_acceleration_mm_s2,
    retract_length: profile.retract_length_mm,
    retract_speed: profile.retract_speed_mm_s,
    retract_lift: profile.z_hop_mm,
    retract_layer_change: 1,
    cooling: 1,
    fan_always_on: profile.fan_percent > 0 ? 1 : 0,
    min_fan_speed: profile.fan_percent,
    max_fan_speed: profile.fan_percent,
    disable_fan_first_layers: profile.material_id === 'pla' ? 2 : 3,
    support_material: profile.supports.enabled ? 1 : 0,
    support_material_auto: profile.supports.automatic ? 1 : 0,
    support_material_buildplate_only: profile.supports.buildplate_only ? 1 : 0,
    support_material_threshold: profile.supports.threshold_deg,
    support_material_pattern: 'rectilinear',
    brim_width: profile.adhesion === 'brim' ? Math.max(4, profile.nozzle_mm * 8) : 0,
    skirts: profile.adhesion === 'skirt' ? 1 : 0,
    skirt_distance: 4,
    start_gcode: profile.start_gcode,
    end_gcode: profile.end_gcode,
    gcode_comments: 1,
    output_filename_format: '[input_filename_base].gcode'
  };
}

export async function sliceWithPrusa({ install, inputPath, outputPath, profile, diagnosticContext = {} }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-prusa-'));
  try {
    const configPath = path.join(temp, 'affetta-profile.ini');
    const values = configValues(profile);
    fs.writeFileSync(configPath, Object.entries(values).map(([key, value]) => `${key} = ${encodeIni(value)}`).join('\n') + '\n');
    const args = [
      ...install.prefix,
      '--load', configPath,
      '--export-gcode',
      '--output', outputPath,
      inputPath
    ];
    await runProcess(install.command, args, { cwd: temp, diagnosticMetadata: diagnosticContext });
    return { profile_files: [configPath] };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
