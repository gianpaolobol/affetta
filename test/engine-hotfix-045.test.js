import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCuraArgs } from '../src/providers/engines/cura.js';

const orca = fs.readFileSync(new URL('../src/providers/engines/orca.js', import.meta.url), 'utf8');

test('Orca usa outputdir senza datadir vuoto o export-3mf obbligatorio', () => {
  assert.match(orca, /'--outputdir', outDir/);
  assert.doesNotMatch(orca, /'--datadir', dataDir/);
  assert.doesNotMatch(orca, /'--export-3mf', threeMf/);
});

test('Orca conserva identità e compatibilità dei preset ufficiali', () => {
  assert.match(orca, /preservePresetIdentity/);
  assert.doesNotMatch(orca, /machine\.name = `Affetta/);
  assert.doesNotMatch(orca, /processProfile\.name = `Affetta/);
  assert.match(orca, /filament\.filament_type = \[profile\.material_id\.toUpperCase\(\)\]/);
});

test('Cura applica tutte le impostazioni dopo la selezione estrusore e prima del caricamento', () => {
  const profile = {
    build_mm:[220,220,250], origin_center:false, bed_temperature_c:60,
    layer_height_mm:0.2, first_layer_height_mm:0.2, line_width_mm:0.42,
    walls:3, infill_percent:22, engine_specific:{cura_pattern:'gyroid'},
    top_layers:5, bottom_layers:4, print_speed_mm_s:70,
    inner_wall_speed_mm_s:50, outer_wall_speed_mm_s:35,
    infill_speed_mm_s:70, top_speed_mm_s:35, travel_speed_mm_s:150,
    first_layer_speed_mm_s:20, max_acceleration_mm_s2:500,
    supports:{enabled:false,buildplate_only:true,threshold_deg:55}, adhesion:'skirt',
    start_gcode:'G28', end_gcode:'M84', nozzle_mm:0.4,
    filament_diameter_mm:1.75, temperature_c:210, first_layer_temperature_c:215,
    first_layer_bed_temperature_c:60, retract_length_mm:5,
    retract_speed_mm_s:40, z_hop_mm:0.2, fan_percent:100
  };
  const args = buildCuraArgs({
    install:{prefix:[]}, inputPath:'input.stl', outputPath:'output.gcode',
    printer:{}, profile, definitions:'defs', baseDef:'base.json',
    machineDef:'machine.json', extruderDef:'extruder.json'
  });
  const e0 = args.indexOf('-e0');
  const layer = args.indexOf('layer_height=0.2');
  const temp = args.indexOf('material_print_temperature=210');
  const mesh = args.indexOf('mesh_position_x=110');
  const load = args.indexOf('-l');
  assert.ok(layer > e0);
  assert.ok(temp > e0);
  assert.ok(mesh > e0 && mesh < load);
});
