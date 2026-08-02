import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cube = path.join(root, 'samples', 'cube20.stl');

function executable(file, source) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/usr/bin/env node\n${source}`);
  fs.chmodSync(file, 0o755);
  return file;
}

function gcode(marker) {
  const lines = [`;${marker}`, ';TIME:120', 'G90', 'M82', 'M104 S210', 'M140 S55', 'G92 E0', 'G1 X0 Y0 Z0.2 F1200'];
  let e = 0;
  for (let layer = 0; layer < 6; layer++) {
    for (const [x, y] of [[20,0],[20,20],[0,20],[0,0]]) {
      e += 0.8;
      lines.push(`G1 X${x} Y${y} Z${(0.2 + layer * 0.2).toFixed(2)} E${e.toFixed(3)} F900`);
    }
  }
  lines.push('M104 S0', 'M140 S0', 'M84', '');
  return lines.join('\n');
}

function setupEngines(temp) {
  const prusa = executable(path.join(temp, 'prusa', 'prusa-slicer'), `
const fs=require('fs'); const a=process.argv.slice(2);
if(a.includes('--version')||a.includes('--help')){console.log('PrusaSlicer 2.9.5');process.exit(0)}
const out=a[a.indexOf('--output')+1], cfg=a[a.indexOf('--load')+1];
const t=fs.readFileSync(cfg,'utf8');
const get=k=>(t.match(new RegExp('^'+k+'\\\\s*=\\\\s*(.+)$','m'))||[])[1];
fs.writeFileSync(out, ${JSON.stringify(gcode('ENGINE=prusa'))}.replace(';ENGINE=prusa',';ENGINE=prusa;LAYER='+get('layer_height')+';INFILL='+get('fill_density')+';NOZZLE='+get('nozzle_diameter')));`);

  const curaRoot = path.join(temp, 'cura');
  const cura = executable(path.join(curaRoot, 'bin', 'CuraEngine'), `
const fs=require('fs'); const a=process.argv.slice(2);
if(a.includes('--version')||a.includes('--help')){console.log('CuraEngine 5.10.0');process.exit(0)}
const out=a[a.indexOf('-o')+1]; const settings={}; for(let i=0;i<a.length;i++)if(a[i]==='-s'){const [k,...v]=a[++i].split('=');settings[k]=v.join('=')}
fs.writeFileSync(out, ${JSON.stringify(gcode('ENGINE=cura'))}.replace(';ENGINE=cura',';ENGINE=cura;LAYER='+settings.layer_height+';INFILL='+settings.infill_sparse_density+';NOZZLE='+settings.machine_nozzle_size));`);
  const defs = path.join(curaRoot, 'share', 'cura', 'resources', 'definitions');
  fs.mkdirSync(defs, { recursive: true });
  for (const name of ['fdmprinter.def.json','fdmextruder.def.json','creality_ender3.def.json','creality_base_extruder_0.def.json','lulzbot_taz6.def.json','lulzbot_taz6_extruder_0.def.json','anycubic_i3_mega.def.json','anycubic_i3_mega_extruder_0.def.json']) fs.writeFileSync(path.join(defs,name),'{}');

  const orcaRoot = path.join(temp, 'orca');
  const orca = executable(path.join(orcaRoot, 'orca-slicer'), `
const fs=require('fs'),path=require('path'); const a=process.argv.slice(2);
if(a.includes('--version')||a.includes('--help')){console.log('OrcaSlicer 2.4.1');process.exit(0)}
if(a[a.indexOf('--ensure-on-bed')+1]==='1'||a[a.indexOf('--allow-newer-file')+1]==='1'){console.error('No such file: 1');process.exit(253)}
const outdir=a[a.indexOf('--outputdir')+1]; const settings=a[a.indexOf('--load-settings')+1].split(';'); const fil=a[a.indexOf('--load-filaments')+1];
const proc=JSON.parse(fs.readFileSync(settings[1],'utf8')); const mach=JSON.parse(fs.readFileSync(settings[0],'utf8')); const filament=JSON.parse(fs.readFileSync(fil,'utf8'));
if(JSON.stringify(mach).includes('chamber_cooling_mode')){console.error('invalid custom g-code: chamber_cooling_mode');process.exit(156)}
const material=String((filament.filament_type||[])[0]||'').toUpperCase();
if(proc.curr_bed_type==='Cool Plate' && material && material!=='PLA'){console.error('Plate 1: Cool Plate does not support filament 1');process.exit(195)}
const nozzle=Number((mach.nozzle_diameter||[])[0]); const supportWidth=Number(proc.support_line_width||0); const tip=Number(proc.tree_support_tip_diameter||0);
if(nozzle>=0.8 && proc.support_type==='tree(auto)' && tip<supportWidth){console.error('Organic support tree tip diameter must not be smaller than support material extrusion width.');process.exit(205)}
fs.mkdirSync(outdir,{recursive:true}); fs.writeFileSync(path.join(outdir,'output.gcode'), ${JSON.stringify(gcode('ENGINE=orca'))}.replace(';ENGINE=orca',';ENGINE=orca;LAYER='+proc.layer_height+';INFILL='+proc.sparse_infill_density+';NOZZLE='+(mach.nozzle_diameter||[])[0]));`);
  const profiles = path.join(orcaRoot, 'resources', 'profiles');
  fs.mkdirSync(profiles, { recursive: true });
  const machines = [
    {name:'Bambu Lab X1 Carbon 0.4 nozzle',type:'machine',printer_model:'Bambu Lab X1 Carbon',nozzle_diameter:['0.4']},
    {name:'Bambu Lab X1 Carbon 0.8 nozzle',type:'machine',printer_model:'Bambu Lab X1 Carbon',nozzle_diameter:['0.8']},
    {name:'Snapmaker U1 0.4 nozzle',type:'machine',printer_model:'Snapmaker U1',nozzle_diameter:['0.4'],machine_start_gcode:'PRINT_START'},
    {name:'Snapmaker U1 0.8 nozzle',type:'machine',printer_model:'Snapmaker U1',nozzle_diameter:['0.8'],machine_start_gcode:'PRINT_START'},
    {name:'Voron 2.4 0.4 nozzle',type:'machine',printer_model:'Voron 2.4',nozzle_diameter:['0.4']}
  ];
  const processes = machines.map(m=>({name:`0.20mm Standard @${m.name}`,type:'process',compatible_printers:[m.name],layer_height:'0.2'}));
  const filaments = machines.flatMap(m=>['PLA','PETG','ABS','ASA','TPU'].map(mat=>({name:`Generic ${mat} @${m.name}`,type:'filament',filament_type:mat,compatible_printers:[m.name]})));
  fs.writeFileSync(path.join(profiles,'affetta-test.json'),JSON.stringify({machines,processes,filaments}));

  const snapRoot = path.join(temp, 'snapmaker_orca');
  const snap = executable(path.join(snapRoot, 'snapmaker-orca'), `
const fs=require('fs'),path=require('path'); const a=process.argv.slice(2);
if(a.includes('--version')||a.includes('--help')){console.log('Snapmaker Orca 2.3.5');process.exit(0)}
if(a[a.indexOf('--ensure-on-bed')+1]==='1'||a[a.indexOf('--allow-newer-file')+1]==='1'){console.error('No such file: 1');process.exit(253)}
const outdir=a[a.indexOf('--outputdir')+1]; const settings=a[a.indexOf('--load-settings')+1].split(';');
const proc=JSON.parse(fs.readFileSync(settings[1],'utf8')); const mach=JSON.parse(fs.readFileSync(settings[0],'utf8'));
const nozzle=Number((mach.nozzle_diameter||[])[0]); const supportWidth=Number(proc.support_line_width||0); const tip=Number(proc.tree_support_tip_diameter||0);
if(nozzle>=0.8 && proc.support_type==='tree(auto)' && tip<supportWidth){console.error('Organic support tree tip diameter must not be smaller than support material extrusion width.');process.exit(205)}
fs.mkdirSync(outdir,{recursive:true}); fs.writeFileSync(path.join(outdir,'output.gcode'), ${JSON.stringify(gcode('ENGINE=snapmaker_orca'))}.replace(';ENGINE=snapmaker_orca',';ENGINE=snapmaker_orca;LAYER='+proc.layer_height+';INFILL='+proc.sparse_infill_density+';NOZZLE='+(mach.nozzle_diameter||[])[0]));`);
  const snapProfiles = path.join(snapRoot, 'resources', 'profiles');
  fs.mkdirSync(snapProfiles, { recursive:true });
  const snapMachines = [0.4,0.8].map(nozzle=>({name:`Snapmaker U1 (${nozzle} nozzle)`,type:'machine',printer_model:'Snapmaker U1',nozzle_diameter:[String(nozzle)],machine_start_gcode:'{if chamber_cooling_mode==0}'}));
  const snapProcesses = snapMachines.map(machine=>({name:`0.20 Standard @${machine.name}`,type:'process',compatible_printers:[machine.name],layer_height:'0.2',instantiation:'true'}));
  const snapFilaments = snapMachines.flatMap(machine=>['PLA','PETG','ABS','ASA','TPU'].map(material=>({name:`Generic ${material} @${machine.name}`,type:'filament',filament_type:material,compatible_printers:[machine.name]})));
  fs.writeFileSync(path.join(snapProfiles,'snapmaker-test.json'),JSON.stringify({machines:snapMachines,processes:snapProcesses,filaments:snapFilaments}));
  return { prusa, cura, orca, snap };
}

async function runCase({ provider, resolvePrinter, printerId, nozzleMm, materialId='pla', qualityId='standard', strengthId='standard' }) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(),'affetta-engine-case-'));
  const output = path.join(temp,'output.gcode');
  try {
    const printer = resolvePrinter(printerId);
    const result = await provider.slice({ inputPath:cube, outputPath:output, printer, options:{printer_id:printerId,nozzle_mm:nozzleMm,material_id:materialId,quality_id:qualityId,strength_id:strengthId} });
    return { result, text:fs.readFileSync(output,'utf8') };
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
}

test('router seleziona i tre motori e trasferisce i parametri automatici', async (t) => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'affetta-engines-'));
  const e=setupEngines(temp);
  process.env.PRUSA_SLICER_BIN=e.prusa;
  process.env.CURA_ENGINE_BIN=e.cura;
  process.env.ORCA_SLICER_BIN=e.orca;
  process.env.SNAPMAKER_ORCA_BIN=e.snap;
  try {
    const { CommandSlicerProvider, resolvePrinter } = await import(`${pathToFileURL(path.join(root,'src/providers/command-slicer.js')).href}?routing`);
    const provider = new CommandSlicerProvider();
    await t.test('Prusa MK4 -> PrusaSlicer', async () => {
      const {result,text}=await runCase({provider,resolvePrinter,printerId:'prusa-mk4',nozzleMm:0.4,qualityId:'high',strengthId:'strong'});
      assert.equal(result.provider,'prusa'); assert.match(text,/ENGINE=prusa/); assert.match(text,/LAYER=0.12/); assert.match(text,/INFILL=45%/); assert.match(text,/NOZZLE=0.4/);
    });
    await t.test('Creality Ender-3 -> PrusaSlicer affidabile', async () => {
      const {result,text}=await runCase({provider,resolvePrinter,printerId:'creality-ender3',nozzleMm:0.6,materialId:'petg',qualityId:'draft',strengthId:'light'});
      assert.equal(result.provider,'prusa'); assert.match(text,/ENGINE=prusa/); assert.match(text,/LAYER=0.42/); assert.match(text,/INFILL=12/); assert.match(text,/NOZZLE=0.6/);
    });
    await t.test('Bambu X1C -> OrcaSlicer', async () => {
      const {result,text}=await runCase({provider,resolvePrinter,printerId:'bambu-x1c',nozzleMm:0.4,materialId:'pla',qualityId:'standard',strengthId:'solid'});
      assert.equal(result.provider,'orca'); assert.match(text,/ENGINE=orca/); assert.match(text,/LAYER=0.2/); assert.match(text,/INFILL=100%/); assert.match(text,/NOZZLE=0.4/);
    });
    await t.test('Snapmaker U1 -> Snapmaker Orca', async () => {
      const {result,text}=await runCase({provider,resolvePrinter,printerId:'snapmaker-u1',nozzleMm:0.4,materialId:'pla',qualityId:'standard',strengthId:'standard'});
      assert.equal(result.provider,'snapmaker_orca'); assert.match(text,/ENGINE=orca/); assert.match(text,/LAYER=0.2/); assert.match(text,/INFILL=22%/); assert.match(text,/NOZZLE=0.4/);
    });
    await t.test('Bambu X1C ABS seleziona un piatto compatibile', async () => {
      const {result,text}=await runCase({provider,resolvePrinter,printerId:'bambu-x1c',nozzleMm:0.4,materialId:'abs',qualityId:'standard',strengthId:'standard'});
      assert.equal(result.provider,'orca'); assert.match(text,/ENGINE=orca/);
    });
    await t.test('Snapmaker U1 0.8 evita il supporto organico incompatibile', async () => {
      const {result,text}=await runCase({provider,resolvePrinter,printerId:'snapmaker-u1',nozzleMm:0.8,materialId:'petg',qualityId:'standard',strengthId:'strong'});
      assert.equal(result.provider,'snapmaker_orca'); assert.match(text,/NOZZLE=0.8/);
    });
  } finally {fs.rmSync(temp,{recursive:true,force:true});}
});


test('catalogo instrada ogni stampante sulla famiglia prevista', async () => {
  const { resolvePrinter } = await import(`${pathToFileURL(path.join(root,'src/providers/command-slicer.js')).href}?catalog-routes`);
  const expected = {
    'generic-reprap-marlin':['prusa','cura'],
    'prusa-mk3s':['prusa'],
    'prusa-mk4':['prusa'],
    'lulzbot-taz4':['cura','prusa'],
    'lulzbot-taz5':['cura','prusa'],
    'lulzbot-taz6':['cura','prusa'],
    'lulzbot-mini':['cura','prusa'],
    'lulzbot-mini2':['prusa','cura'],
    'creality-ender3':['prusa','cura'],
    'anycubic-i3-mega':['prusa','cura'],
    'voron-24':['orca','prusa'],
    'bambu-x1c':['orca'],
    'snapmaker-u1':['snapmaker_orca','orca']
  };
  for (const [id, engines] of Object.entries(expected)) assert.deepEqual(resolvePrinter(id).engines, engines, id);
});

test('router usa Prusa come percorso primario per Marlin anche se Cura non è disponibile', async () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'affetta-fallback-'));
  const e=setupEngines(temp);
  process.env.PRUSA_SLICER_BIN=e.prusa;
  process.env.CURA_ENGINE_BIN=path.join(temp,'missing','CuraEngine');
  process.env.ORCA_SLICER_BIN=e.orca;
  try {
    const moduleUrl = `${pathToFileURL(path.join(root,'src/providers/command-slicer.js')).href}?fallback=${Date.now()}`;
    const { CommandSlicerProvider, resolvePrinter } = await import(moduleUrl);
    const provider = new CommandSlicerProvider();
    const {result,text}=await runCase({provider,resolvePrinter,printerId:'creality-ender3',nozzleMm:0.4});
    assert.equal(result.provider,'prusa');
    assert.equal(result.attempts.length,0);
    assert.match(text,/ENGINE=prusa/);
  } finally { fs.rmSync(temp,{recursive:true,force:true}); }
});
