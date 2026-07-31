import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildCuraArgs } from '../src/providers/engines/cura.js';

const orca = fs.readFileSync(new URL('../src/providers/engines/orca.js', import.meta.url), 'utf8');
const selftest = fs.readFileSync(new URL('../scripts/engine-selftest.mjs', import.meta.url), 'utf8');

test('Orca usa allow-newer-file come flag senza valore', () => {
  assert.match(orca, /'--allow-newer-file',\s*\n\s*'--arrange'/);
  assert.doesNotMatch(orca, /'--allow-newer-file',\s*'1'/);
});

test('Cura include ricerca extruders, centratura e impostazioni CLI 5.x', () => {
  const profile={build_mm:[220,220,250],origin_center:false,bed_temperature_c:60,nozzle_mm:0.4,filament_diameter_mm:1.75,layer_height_mm:0.2,first_layer_height_mm:0.2,line_width_mm:0.42,walls:3,infill_percent:22,engine_specific:{cura_pattern:'gyroid'},top_layers:5,bottom_layers:4,temperature_c:210,first_layer_temperature_c:215,first_layer_bed_temperature_c:65,print_speed_mm_s:60,inner_wall_speed_mm_s:45,outer_wall_speed_mm_s:30,infill_speed_mm_s:60,top_speed_mm_s:30,travel_speed_mm_s:150,first_layer_speed_mm_s:20,max_acceleration_mm_s2:500,retract_length_mm:5,retract_speed_mm_s:40,z_hop_mm:0.2,fan_percent:100,supports:{enabled:true,buildplate_only:true,threshold_deg:50},adhesion:'skirt',start_gcode:'G28',end_gcode:'M84'};
  const args=buildCuraArgs({install:{prefix:[]},inputPath:'in.stl',outputPath:'out.gcode',profile,definitions:'defs',extruders:'extruders',machineDef:'machine.json',extruderDef:'extruder.json'});
  assert.equal(args[args.indexOf('-d')+1], ['defs','extruders'].join(process.platform==='win32'?';':':'));
  assert.ok(args.includes('center_object=true'));
  assert.ok(args.includes('mesh_position_x=110'));
  assert.ok(args.includes('roofing_layer_count=1'));
  assert.ok(args.indexOf('-l') > args.indexOf('mesh_position_x=110'));
});

test('self-test rende Cura opzionale e verifica i percorsi produttivi', () => {
  assert.match(selftest, /production_routes/);
  assert.match(selftest, /optional_engines\.cura/);
  assert.match(selftest, /blocking:false/);
});
