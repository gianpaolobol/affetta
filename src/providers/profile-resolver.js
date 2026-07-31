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
  const volumetricLimitSpeed = material.max_volumetric_mm3_s / Math.max(0.01, lineWidth * layerHeight);
  const nozzleSpeedFactor = Math.sqrt(nozzle / 0.4);
  const requestedSpeed = machine.max_print_speed * quality.speed_factor * material.speed_factor * nozzleSpeedFactor;
  const printSpeed = round(clamp(Math.min(requestedSpeed, volumetricLimitSpeed), 12, machine.max_print_speed), 1);
  const outerWallSpeed = round(Math.max(10, printSpeed * 0.55), 1);
  const innerWallSpeed = round(Math.max(12, printSpeed * 0.82), 1);
  const infillSpeed = round(Math.min(machine.max_print_speed, printSpeed * 1.08), 1);
  const topSpeed = round(Math.max(10, printSpeed * 0.55), 1);
  const firstLayerSpeed = round(Math.min(machine.first_layer_speed, Math.max(10, printSpeed * 0.42)), 1);
  const travelSpeed = round(machine.travel_speed, 1);
  const temperature = clamp(material.nozzle_c + (nozzle >= 0.8 ? 5 : 0), 150, machine.max_hotend_c);
  const firstLayerTemperature = clamp(temperature + (materialId === 'tpu' ? 0 : 5), 150, machine.max_hotend_c);
  const bedTemperature = clamp(material.bed_c, 0, machine.max_bed_c);
  const firstLayerBedTemperature = clamp(bedTemperature + (materialId === 'pla' ? 5 : 0), 0, machine.max_bed_c);
  const retractLength = materialId === 'tpu' ? round(Math.min(machine.retract_length, 1.2), 2) : machine.retract_length;
  const retractSpeed = materialId === 'tpu' ? round(Math.min(machine.retract_speed, 20), 1) : machine.retract_speed;
  const warnings = [];
  const buildPlate = resolveBuildPlate(printer, materialId);
  if (material.enclosure === 'recommended' && ['creality-ender3', 'anycubic-i3-mega', 'generic-reprap-marlin'].includes(printerId)) {
    warnings.push(`${material.label}: per ridurre deformazioni è consigliata una camera chiusa.`);
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
    firmware: printer.firmware,
    gcode_flavor: gcodeFlavor(printer.firmware),
    origin_center: Boolean(printer.origin_center),
    nozzle_mm: nozzle,
    filament_diameter_mm: 1.75,
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
    fan_percent: material.fan_percent,
    max_volumetric_mm3_s: material.max_volumetric_mm3_s,
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
