import assert from 'node:assert/strict';
import test from 'node:test';
import { mapLocalState } from '../src/job-runner.js';
import type { LocalJob } from '../src/types.js';

function localJob(overrides: Partial<LocalJob>): LocalJob {
  return {
    id: 'slice_local_01',
    status: 'queued',
    phase: 'queued',
    progress: 0,
    ...overrides
  };
}

test('normalizza la coda locale come preparing senza regressione cloud a queued', () => {
  assert.deepEqual(
    mapLocalState(localJob({ status: 'queued', phase: 'queued', progress: 0 })),
    { status: 'preparing', stage: 'prepare', progress: 10 }
  );
});

test('mantiene slicing e postprocess nelle fasi cloud consentite', () => {
  assert.deepEqual(
    mapLocalState(localJob({ status: 'running', phase: 'slice_engine', progress: 42 })),
    { status: 'slicing', stage: 'slice', progress: 42 }
  );
  assert.deepEqual(
    mapLocalState(localJob({ status: 'running', phase: 'postprocess_gpx', progress: 92 })),
    { status: 'postprocessing', stage: 'postprocess', progress: 92 }
  );
});
