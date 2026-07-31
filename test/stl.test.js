import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { analyzeStl } from '../src/stl.js';
import { ROOT } from '../src/config.js';

test('analizza un cubo STL da 20 mm', () => {
  const stats = analyzeStl(fs.readFileSync(`${ROOT}/samples/cube20.stl`));
  assert.equal(stats.triangles, 12);
  assert.deepEqual(stats.bounds_mm.size, [20, 20, 20]);
  assert.ok(Math.abs(stats.volume_mm3 - 8000) < 0.01);
  assert.ok(Math.abs(stats.surface_area_mm2 - 2400) < 0.01);
});

test('dispone più copie STL su un unico piano', async () => {
  const { arrangeStlCopies } = await import('../src/stl.js');
  const source = fs.readFileSync(new URL('../samples/cube20.stl', import.meta.url));
  const arranged = arrangeStlCopies(source, 4, [100, 100, 100], { spacingMm: 5 });
  assert.equal(arranged.layout.quantity, 4);
  assert.equal(arranged.layout.columns, 2);
  assert.equal(arranged.layout.rows, 2);
  assert.deepEqual(arranged.analysis.bounds_mm.size, [45, 45, 20]);
  assert.equal(arranged.analysis.triangles, 48);
});

test('rifiuta una quantità che non entra sul piano', async () => {
  const { arrangeStlCopies } = await import('../src/stl.js');
  const source = fs.readFileSync(new URL('../samples/cube20.stl', import.meta.url));
  assert.throws(
    () => arrangeStlCopies(source, 10, [50, 50, 100], { spacingMm: 5 }),
    (error) => error.code === 'quantity_does_not_fit' && error.statusCode === 422
  );
});

test('parser STL del viewer legge il file caricato dal browser', async () => {
  const { parseStl } = await import('../public/viewer.js');
  const source = fs.readFileSync(new URL('../samples/cube20.stl', import.meta.url));
  const buffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
  const parsed = parseStl(buffer);
  assert.equal(parsed.triangleCount, 12);
  assert.equal(parsed.vertices.length, 108);
});

test('parser STL del viewer riconosce anche uno STL binario', async () => {
  const { parseStl } = await import('../public/viewer.js');
  const binary = Buffer.alloc(84 + 50);
  binary.write('Affetta binary STL', 0, 'ascii');
  binary.writeUInt32LE(1, 80);
  // normale + tre vertici
  binary.writeFloatLE(0, 84); binary.writeFloatLE(0, 88); binary.writeFloatLE(1, 92);
  const vertices = [[0,0,0],[20,0,0],[0,20,0]];
  vertices.forEach((vertex, index) => vertex.forEach((value, axis) => binary.writeFloatLE(value, 96 + index * 12 + axis * 4)));
  const buffer = binary.buffer.slice(binary.byteOffset, binary.byteOffset + binary.byteLength);
  const parsed = parseStl(buffer);
  assert.equal(parsed.triangleCount, 1);
  assert.equal(parsed.vertices.length, 9);
});
