import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { catalogs } from '../src/config.js';
import { resolvePrintProfile } from '../src/providers/profile-resolver.js';
import { arrangeStlCopies } from '../src/stl.js';
import { routeProductionJob } from '../src/fleet-router.js';

const cube20 = fs.readFileSync(new URL('../samples/cube20.stl', import.meta.url));

function boxStl(x, y, z) {
  const p = [
    [0,0,0],[x,0,0],[x,y,0],[0,y,0],
    [0,0,z],[x,0,z],[x,y,z],[0,y,z]
  ];
  const faces = [
    [0,2,1],[0,3,2],[4,5,6],[4,6,7],
    [0,1,5],[0,5,4],[1,2,6],[1,6,5],
    [2,3,7],[2,7,6],[3,0,4],[3,4,7]
  ];
  return Buffer.from(`solid box\n${faces.map(([a,b,c]) => `facet normal 0 0 0\nouter loop\nvertex ${p[a].join(' ')}\nvertex ${p[b].join(' ')}\nvertex ${p[c].join(' ')}\nendloop\nendfacet`).join('\n')}\nendsolid box\n`);
}

function options(overrides={}) {
  return {
    material_id:'pla', quality_id:'standard', strength_id:'standard',
    color_id:'random', custom_color:null, quantity:1,
    source:'test', external_ref:null, metadata:{}, ...overrides
  };
}

test('LulzBot e Thing-O-Matic usano filamento 2,85 mm', () => {
  for (const [id, printer] of Object.entries(catalogs.printers)) {
    if ((printer.technology || 'fff') !== 'fff') continue;
    const expected = id.startsWith('lulzbot-taz') || id.startsWith('lulzbot-mini') || id === 'thing-o-matic' ? 2.85 : 1.75;
    assert.equal(printer.filament_diameter_mm, expected, id);
  }
  const taz = resolvePrintProfile({ printerId:'lulzbot-taz4', nozzleMm:0.5, materialId:'pla', qualityId:'standard', strengthId:'standard' });
  assert.equal(taz.filament_diameter_mm, 2.85);
  const wasp = resolvePrintProfile({ printerId:'deltawasp-2040', nozzleMm:0.4, materialId:'pla', qualityId:'standard', strengthId:'standard' });
  assert.equal(wasp.filament_diameter_mm, 1.75);
});

test('catalogo LulzBot distingue modelli pubblici e unità fisiche del laboratorio', () => {
  assert.deepEqual(catalogs.printers['lulzbot-taz4'].build_mm, [298,275,250]);
  assert.deepEqual(catalogs.printers['lulzbot-taz5'].build_mm, [298,275,250]);
  assert.deepEqual(catalogs.printers['lulzbot-taz6'].build_mm, [280,280,250]);
  assert.deepEqual(catalogs.printers['lulzbot-mini'].build_mm, [152,152,158]);
  assert.equal(catalogs.printers['lulzbot-taz-legacy'], undefined);
  assert.equal(catalogs.printers['lulzbot-mini-legacy'], undefined);
  assert.equal(catalogs.fleet.units.find((unit) => unit.id === 'taz-01').printer_id, 'lulzbot-taz4');
  assert.equal(catalogs.fleet.units.find((unit) => unit.id === 'taz-02').printer_id, 'lulzbot-taz5');
  assert.equal(catalogs.fleet.units.find((unit) => unit.id === 'taz-03').printer_id, 'lulzbot-taz6');
  assert.equal(catalogs.fleet.units.find((unit) => unit.id === 'mini-01').printer_id, 'lulzbot-mini');
  assert.equal(catalogs.fleet.units.find((unit) => unit.id === 'mini-02').printer_id, 'lulzbot-mini');
});

test('profili automatici interni sono presenti ma non sono stampanti pubbliche', () => {
  assert.equal(catalogs.internalProfiles['laboratory-auto'].label, 'Profilo automatico laboratorio');
  assert.equal(catalogs.internalProfiles['kiri-quick-estimate'].label, 'Profilo stima rapida Kiri:Moto');
  assert.equal(catalogs.internalProfiles['laboratory-auto'].visibility, 'internal');
  assert.equal(catalogs.internalProfiles['kiri-quick-estimate'].public, false);
  assert.equal(catalogs.printers['auto-lab'], undefined);
  assert.equal(catalogs.printers['kiri-quick-estimate'], undefined);
});

test('tutti i modelli delta usano piano circolare con diametro coerente', () => {
  const expected = {
    'anycubic-predator': [370,455],
    'flsun-v400': [300,410],
    'deltawasp-2040': [200,400],
    'deltawasp-2040-pro': [200,400],
    'deltawasp-2040-turbo': [200,400]
  };
  for (const [id, [diameter, height]] of Object.entries(expected)) {
    const printer = catalogs.printers[id];
    assert.equal(printer.bed_shape, 'circular', id);
    assert.equal(printer.build_diameter_mm, diameter, id);
    assert.deepEqual(printer.build_mm, [diameter, diameter, height], id);
    assert.equal(printer.origin_center, true, id);
  }
});

test('Prusa i3 autocostruita non espone più la dicitura profilo base', () => {
  assert.equal(catalogs.printers['prusa-i3-custom'].label, 'Prusa i3 autocostruita');
});

test('piano circolare controlla gli angoli dell’ingombro', () => {
  const printer = catalogs.printers['deltawasp-2040'];
  assert.throws(
    () => arrangeStlCopies(boxStl(190,190,20), 1, printer),
    (error) => error.code === 'model_too_large'
  );
  const ok = arrangeStlCopies(boxStl(120,120,20), 1, printer);
  assert.equal(ok.layout.bed_shape, 'circular');
});

test('router laboratorio assegna TPU, ABS e grande formato ai reparti coerenti', () => {
  const tpu = routeProductionJob({ modelBuffer:cube20, productionOnly:false, options:options({material_id:'tpu'}) });
  assert.ok(['taz-02','mini-02'].includes(tpu.selected.unit_id), tpu.selected.unit_id);

  const abs = routeProductionJob({ modelBuffer:cube20, productionOnly:false, options:options({material_id:'abs', quality_id:'high', color_id:'black'}) });
  assert.ok(['x1c-01','wasp-turbo-01'].includes(abs.selected.unit_id), abs.selected.unit_id);

  const large = routeProductionJob({ modelBuffer:boxStl(300,80,100), productionOnly:false, options:options({quality_id:'draft', strength_id:'strong'}) });
  assert.ok(large.selected.unit_id.startsWith('predator-'), large.selected.unit_id);
});

test('profilo resina è censito ma non viene trattato come G-code FDM', () => {
  const resin = catalogs.printers['phrozen-sonic-mini-4k'];
  assert.equal(resin.technology, 'msla');
  assert.equal(resin.resin.output_format, 'CTB');
  assert.equal(resin.resin.slicer, 'CHITUBOX');
});

test('router produttivo usa solo unità fisicamente validate', () => {
  const route = routeProductionJob({ modelBuffer:cube20, options:options({material_id:'pla'}) });
  assert.equal(route.selected.production_ready, true);
  assert.ok(['x1c-01','snapmaker-u1-01'].includes(route.selected.unit_id));
  assert.ok(route.rejected.some((item) => item.unit_id === 'taz-01') === false, 'le unità non pronte vengono escluse prima della graduatoria');
});
