import assert from 'node:assert/strict';
import test from 'node:test';
import { AffettaClient } from '../integration/js/affetta-client.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('client ripete soltanto errori di trasporto durante il polling', async () => {
  let calls = 0;
  const client = new AffettaClient({
    baseUrl: 'http://affetta.test',
    fetchImpl: async () => {
      calls++;
      if (calls < 3) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
      return jsonResponse({ success: true, job: { id: 'slice_test', status: 'running' } });
    }
  });
  const result = await client.getSliceJob('slice_test');
  assert.equal(result.job.status, 'running');
  assert.equal(calls, 3);
});

test('client non ripete errori HTTP applicativi e conserva il JSON diagnostico', async () => {
  let calls = 0;
  const client = new AffettaClient({
    baseUrl: 'http://affetta.test',
    fetchImpl: async () => {
      calls++;
      return jsonResponse({
        success: false,
        error: { code: 'all_engines_failed', message: 'Motore fallito', stage: 'slice_engine' },
        job: { id: 'slice_failed', status: 'failed', phase: 'failed' }
      }, 422);
    }
  });
  await assert.rejects(client.getSliceJob('slice_failed'), (error) => {
    assert.equal(error.status, 422);
    assert.equal(error.code, 'all_engines_failed');
    assert.equal(error.stage, 'slice_engine');
    assert.equal(error.job.status, 'failed');
    return true;
  });
  assert.equal(calls, 1);
});
