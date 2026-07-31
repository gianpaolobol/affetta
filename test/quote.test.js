import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { ROOT } from '../src/config.js';
import { createQuote } from '../src/quote-service.js';

test('crea un preventivo con fallback geometrico', async () => {
  const quote = await createQuote({
    tenant: 'public',
    modelBuffer: fs.readFileSync(`${ROOT}/samples/cube20.stl`),
    filename: 'cube20.stl',
    options: { material_id:'pla', quality_id:'standard', strength_id:'standard', color_id:'random', quantity:2, pricing_mode:null, source:'test', external_ref:'T-1' }
  });
  assert.equal(quote.success, true);
  assert.equal(quote.selections.quantity, 2);
  assert.ok(quote.price.total_eur >= quote.price.unit_eur * 2 - 0.01);
  assert.ok(quote.estimate.filament_g > 0);
});
