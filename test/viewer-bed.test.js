import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlateSegments } from '../public/viewer.js';

test('viewer genera un piano circolare reale per le delta', () => {
  const diameter = 370;
  const radius = diameter / 2;
  const segments = buildPlateSegments({ build_mm:[370,370,455], bed_shape:'circular', build_diameter_mm:diameter });
  assert.ok(segments.length > 100);
  for (const segment of segments) {
    for (const [x,y,z] of segment) {
      assert.equal(z, 0);
      assert.ok(Math.hypot(x,y) <= radius + 1e-6, `${x},${y}`);
    }
  }
  assert.ok(segments.some(([a,b]) => Math.abs(Math.hypot(...a.slice(0,2)) - radius) < 1e-6 && Math.abs(Math.hypot(...b.slice(0,2)) - radius) < 1e-6));
});

test('viewer conserva il piano rettangolare per le cartesiane', () => {
  const segments = buildPlateSegments({ build_mm:[220,220,250], bed_shape:'rectangular' });
  assert.ok(segments.some(([a,b]) => a[0] === -110 && a[1] === -110 && b[0] === 110 && b[1] === -110));
});
