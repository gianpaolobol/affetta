import { catalogs } from '../config.js';
import { clamp, round } from '../utils.js';

const patternMap = {
  grid: { prusa: 'grid', cura: 'grid', orca: 'grid' },
  gyroid: { prusa: 'gyroid', cura: 'gyroid', orca: 'gyroid' },
  rectilinear: { prusa: 'rectilinear', cura: 'lines', orca: 'rectilinear' }
};

function gcodeFlavor(firmware) {
  if (firmware === 'klipper') return 'klipper';
  if (firmware === 'bambu') return 'marlin';
  if (firmware === 'prusa-firmware-buddy') return 'marlin2';
  if (firmware === 'marlin2') return 'marlin2';
  return 'marlin';
}

function replaceGcodeTokens(text = '', values) {
  return String(text).replace(/\[([a-z_]+)\]/g, (_, key) => values[key] ?? `[${key}]`);
}

function resolveBuildPlate(printer, materialId) {
  return printer.orca?.bed_type_by_material?.[materialId] || null;
}

export function resolvePrintProfile({ printerId, nozzleMm, materialId, qualityId, strengthId }) {
  const printer = catalogs.printers[printerId];
  const material = catalogs.materials[materialId];
  const quality = catalogs.qualities[qualityId];
  const strength = catalogs.strengths[strengthId];
  if (!printer || !material || !quality || !strength) throw new Error('Impossibile comporre il profilo di stampa.');
  if ((printer.technology || 'fff') !== 'fff' || (material.technology || 'fff') !== 'fff') {
    throw Object.assign(new Error('Questo profilo usa un processo resina/manuale e non può produrre G-code FDM.'), { code: 'non_fff_profile', statusCode: 409 });
  }
  if (!printer.nozzles.includes(nozzleMm)) throw new Error('Ugello non compatibile con la stampante selezionata.');
  if (printer.materials && !printer.materials.includes(materialId)) {
    throw Object.assign(new Error(`${material.label} non è abilitato per ${printer.label}.`), { code: 'material_not_supported', statusCode: 400 });
  }

  const nozzle = Number(nozzleMm);
  const minLayer = Math.max(0.05, nozzle * 0.18);
  const maxLayer = nozzle * 0.75;
  const layerHeight = round(clamp(nozzle * quality.layer_ratio, minLayer, maxLayer), 2);
  const firstLayerHeight = round(clamp(Math.max(layerHeight, nozzle * 0.55), layerHeight, nozzle * 0.75), 2);
  const lineWidth = round(nozzle * (nozzle >= 0.8 ? 1.08 : 1.05), 2);
  const machine = printer.machine;
  const materialProfile = printer.material_profiles?.[materialId] || {};
  const materialSpeedFactor = Number(materialProfile.speed_factor ?? material.speed_factor);
  const materialVolumetricLimit = Number(materialProfile.max_volumetric_mm3_s ?? material.max_volumetric_mm3_s);
  const profileMaxPrintSpeed = Math.min(machine.max_print_speed, Number(materialProfile.max_print_speed_mm_s ?? machine.max_print_speed));
  const volumetricLimitSpeed = materialVolumetricLimit / Math.max(0.01, lineWidth * layerHeight);
  const nozzleSpeedFactor = Math.sqrt(nozzle / 0.4);
  const requestedSpeed = profileMaxPrintSpeed * quality.speed_factor * materialSpeedFactor * nozzleSpeedFactor;
  const printSpeed = round(clamp(Math.min(requestedSpeed, volumetricLimitSpeed), 8, profileMaxPrintSpeed), 1);
  const outerWallSpeed = round(Math.max(10, printSpeed * 0.55), 1);
  const innerWallSpeed = round(Math.max(12, printSpeed * 0.82), 1);
  const infillSpeed = round(Math.min(profileMaxPrintSpeed, printSpeed * 1.08), 1);
  const topSpeed = round(Math.max(8, printSpeed * 0.55), 1);
  const requestedFirstLayerSpeed = Number(materialProfile.first_layer_speed_mm_s ?? machine.first_layer_speed);
  const firstLayerSpeed = round(Math.min(requestedFirstLayerSpeed, Math.max(8, printSpeed * 0.42)), 1);
  const travelSpeed = round(machine.travel_speed, 1);
  const baseNozzleTemperature = Number(materialProfile.nozzle_c ?? material.nozzle_c);
  const temperature = clamp(baseNozzleTemperature + (nozzle >= 0.8 ? 5 : 0), 150, machine.max_hotend_c);
  const firstLayerTemperature = clamp(temperature + (materialId === 'tpu' ? 0 : 5), 150, machine.max_hotend_c);
  const bedTemperature = clamp(Number(materialProfile.bed_c ?? material.bed_c), 0, machine.max_bed_c);
  const firstLayerBedTemperature = clamp(bedTemperature + (materialId === 'pla' ? 5 : 0), 0, machine.max_bed_c);
  const retractLength = Number(materialProfile.retract_length_mm ?? (materialId === 'tpu' ? round(Math.min(machine.retract_length, 1.2), 2) : machine.retract_length));
  const retractSpeed = Number(materialProfile.retract_speed_mm_s ?? (materialId === 'tpu' ? round(Math.min(machine.retract_speed, 20), 1) : machine.retract_speed));
  const fanPercent = Number(materialProfile.fan_percent ?? material.fan_percent);
  const flowPercent = Number(materialProfile.flow_percent ?? 100);
  const warnings = [];
  const buildPlate = resolveBuildPlate(printer, materialId);
  if (material.enclosure === 'recommended' && !printer.enclosed) {
    warnings.push(`${material.label}: per ridurre deformazioni è consigliata una macchina con camera chiusa.`);
  }
  if (materialProfile.experimental) {
    warnings.push(`${material.label}: profilo sperimentale e cautelativo per ${printer.label}; sorveglia il primo strato e verifica temperature ed estrusione.`);
  }
  if (printer.status !== 'validated') {
    const bundled = ['vendor-profile-bundled', 'profile-assets-verified'].includes(printer.status);
    warnings.push(bundled
      ? 'I preset del produttore sono presenti e la composizione automatica è stata verificata; prima dell’uso produttivo esegui il collaudo CLI sul computer Windows e una stampa fisica.'
      : 'Il profilo automatico è predisposto nel backend; prima dell’uso produttivo esegui il collaudo del motore reale e una stampa fisica.');
  }
  if (buildPlate) warnings.push(`Piatto selezionato automaticamente: ${buildPlate}. Verifica che il piatto montato sulla stampante corrisponda.`);

  const tokenValues = {
    first_layer_temperature: firstLayerTemperature,
    temperature,
    first_layer_bed_temperature: firstLayerBedTemperature,
    bed_temperature: bedTemperature
  };

  return {
    printer_id: printerId,
    printer_label: printer.label,
    engines: [...printer.engines],
    build_mm: printer.build_mm,
    bed_shape: printer.bed_shape || 'rectangular',
    build_diameter_mm: printer.build_diameter_mm || null,
    technology: printer.technology || 'fff',
    firmware: printer.firmware,
    gcode_flavor: gcodeFlavor(printer.firmware),
    origin_center: Boolean(printer.origin_center),
    nozzle_mm: nozzle,
    filament_diameter_mm: Number(printer.filament_diameter_mm || 1.75),
    material_id: materialId,
    material_label: material.label,
    density_g_cm3: material.density_g_cm3,
    quality_id: qualityId,
    strength_id: strengthId,
    layer_height_mm: layerHeight,
    first_layer_height_mm: firstLayerHeight,
    line_width_mm: lineWidth,
    infill_percent: strength.infill_percent,
    infill_pattern: strength.pattern,
    walls: strength.walls,
    top_layers: quality.top_layers,
    bottom_layers: quality.bottom_layers,
    temperature_c: temperature,
    first_layer_temperature_c: firstLayerTemperature,
    bed_temperature_c: bedTemperature,
    first_layer_bed_temperature_c: firstLayerBedTemperature,
    fan_percent: fanPercent,
    flow_percent: flowPercent,
    max_volumetric_mm3_s: materialVolumetricLimit,
    print_speed_mm_s: printSpeed,
    outer_wall_speed_mm_s: outerWallSpeed,
    inner_wall_speed_mm_s: innerWallSpeed,
    infill_speed_mm_s: infillSpeed,
    top_speed_mm_s: topSpeed,
    first_layer_speed_mm_s: firstLayerSpeed,
    travel_speed_mm_s: travelSpeed,
    max_acceleration_mm_s2: machine.max_acceleration,
    retract_length_mm: retractLength,
    retract_speed_mm_s: retractSpeed,
    z_hop_mm: machine.z_hop,
    output_format: printer.output_format || 'gcode',
    postprocess: printer.postprocess || null,
    supports: {
      enabled: true,
      automatic: true,
      threshold_deg: 50,
      buildplate_only: true,
      type: nozzle >= 0.8 ? 'normal(auto)' : 'tree(auto)'
    },
    build_plate: buildPlate,
    adhesion: nozzle >= 0.8 || materialId === 'abs' || materialId === 'asa' ? 'brim' : 'skirt',
    start_gcode: replaceGcodeTokens(machine.start_gcode || '', tokenValues),
    end_gcode: replaceGcodeTokens(machine.end_gcode || '', tokenValues),
    engine_specific: { prusa_pattern: patternMap[strength.pattern]?.prusa || 'gyroid', cura_pattern: patternMap[strength.pattern]?.cura || 'gyroid', orca_pattern: patternMap[strength.pattern]?.orca || 'gyroid' },
    warnings
  };
}

export function publicProfile(profile) {
  return {
    printer_id: profile.printer_id,
    printer_label: profile.printer_label,
    build_mm: profile.build_mm,
    bed_shape: profile.bed_shape,
    build_diameter_mm: profile.build_diameter_mm,
    output_format: profile.output_format || 'gcode',
    filament_diameter_mm: profile.filament_diameter_mm,
    nozzle_mm: profile.nozzle_mm,
    material: profile.material_label,
    layer_height_mm: profile.layer_height_mm,
    first_layer_height_mm: profile.first_layer_height_mm,
    line_width_mm: profile.line_width_mm,
    infill_percent: profile.infill_percent,
    walls: profile.walls,
    top_layers: profile.top_layers,
    bottom_layers: profile.bottom_layers,
    temperature_c: profile.temperature_c,
    bed_temperature_c: profile.bed_temperature_c,
    print_speed_mm_s: profile.print_speed_mm_s,
    travel_speed_mm_s: profile.travel_speed_mm_s,
    retract_length_mm: profile.retract_length_mm,
    retract_speed_mm_s: profile.retract_speed_mm_s,
    fan_percent: profile.fan_percent,
    supports: profile.supports,
    build_plate: profile.build_plate,
    adhesion: profile.adhesion,
    warnings: profile.warnings
  };
}
