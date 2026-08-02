import http from 'node:http';
import { once } from 'node:events';
import { sha256Buffer } from '../../src/hash.js';
import type { JobRequestV1, LeaseEnvelope } from '../../src/types.js';

async function readBody(request: http.IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function json(response: http.ServerResponse, status: number, value: unknown): void {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': body.length });
  response.end(body);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateCompletedResultEnvelope(value: unknown, request: JobRequestV1): string | null {
  if (!isRecord(value) || typeof value.lease_id !== 'string' || !isRecord(value.result)) {
    return 'Envelope complete non valido.';
  }
  const result = value.result;
  const allowed = new Set([
    'schema_version', 'job_id', 'request_id', 'idempotency_key',
    'status', 'updated_at', 'result', 'extensions'
  ]);
  for (const key of Object.keys(result)) {
    if (!allowed.has(key)) return `Proprietà risultato non consentita: ${key}`;
  }
  if (result.schema_version !== 'affetta.result.v1' || result.status !== 'completed') {
    return 'Versione o stato risultato non valido.';
  }
  if (result.job_id !== 'job_mock_01' || result.request_id !== request.request_id ||
      result.idempotency_key !== request.idempotency_key) {
    return 'Identità o idempotenza risultato non coerente.';
  }
  if (typeof result.updated_at !== 'string' || Number.isNaN(Date.parse(result.updated_at))) {
    return 'updated_at risultato non valido.';
  }
  if ('completed_at' in result) return 'completed_at non appartiene ad affetta.result.v1.';
  if (!isRecord(result.result) || !Array.isArray(result.result.artifacts) || result.result.artifacts.length < 1) {
    return 'Corpo risultato o artefatti non validi.';
  }
  return null;
}

async function listen(server: http.Server): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server mock non avviato.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => { server.close(); await once(server, 'close'); }
  };
}

export interface MockLocal {
  baseUrl: string;
  output: Buffer;
  createCount: () => number;
  close: () => Promise<void>;
}

export async function startMockLocal(): Promise<MockLocal> {
  const output = Buffer.from([0x58, 0x33, 0x47, 0x00, 0x01, 0x02, 0x03, 0x04]);
  let created = 0;
  const polls = new Map<string, number>();
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url || '/', 'http://localhost');
    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      return json(response, 200, { success: true, service: 'affetta', version: '0.5.2', api_version: 'v1', instance_id: 'mock-local' });
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/catalog') {
      return json(response, 200, {
        success: true,
        printers: {
          'thing-o-matic': {
            label: 'Thing-O-Matic',
            nozzles: [0.35],
            default_nozzle: 0.35,
            materials: ['pla', 'abs', 'petg', 'tpu'],
            status: 'experimental'
          }
        }
      });
    }
    if (request.method === 'GET' && url.pathname === '/api/v1/fleet') {
      return json(response, 200, {
        success: true,
        fleet: {
          id: 'bologna-lab',
          units: [{
            id: 'thing-o-matic-01',
            printer_id: 'thing-o-matic',
            production_ready: false,
            calibration_status: 'physical-test-pending',
            material_ids: ['pla', 'abs', 'petg', 'tpu']
          }]
        }
      });
    }
    if (request.method === 'GET' && (url.pathname === '/api/v1/admin/diagnostics' || url.pathname === '/api/v1/capabilities')) {
      return json(response, 200, {
        success: true,
        slicing: {
          printers: {
            'thing-o-matic': {
              slice_available: true,
              profile_status: 'experimental',
              output_format: 'x3g',
              postprocessor: { engine: 'gpx', available: true },
              routes: [{ engine: 'cura', available: true, resources_ready: true }]
            }
          }
        },
        engines: {
          kiri: { available: false, version: null, detail: 'Non configurato.' },
          cura: { available: true, version: '5.13.0', detail: 'CuraEngine 5.13.0' },
          prusa: { available: false, version: null, detail: 'Non configurato.' },
          orca: { available: false, version: null, detail: 'Non configurato.' },
          snapmaker_orca: { available: false, version: null, detail: 'Non configurato.' },
          gpx: { available: true, version: '2.6.8', detail: 'GPX 2.6.8' }
        }
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/v1/slice-jobs') {
      const body = JSON.parse((await readBody(request)).toString('utf8')) as { file_base64?: string; printer_id?: string };
      if (!body.file_base64 || body.printer_id !== 'thing-o-matic') return json(response, 400, { error: { code: 'invalid_payload' } });
      created += 1;
      const id = 'slice_mock_01';
      polls.set(id, 0);
      return json(response, 202, { success: true, job: { id, status: 'queued', phase: 'queued', progress: 0 } });
    }
    const jobMatch = url.pathname.match(/^\/api\/v1\/slice-jobs\/([^/]+)$/);
    if (request.method === 'GET' && jobMatch) {
      const id = jobMatch[1] || '';
      const count = (polls.get(id) || 0) + 1;
      polls.set(id, count);
      if (count < 2) return json(response, 200, { success: true, job: { id, status: 'running', phase: 'slice_engine', progress: 50, message: 'CuraEngine' } });
      return json(response, 200, {
        success: true,
        job: {
          id,
          status: 'completed',
          phase: 'completed',
          progress: 100,
          artifact_url: `/api/v1/slice-jobs/${id}/artifact?token=mock`,
          output_format: 'x3g',
          printer: { id: 'thing-o-matic', profile_status: 'experimental', fleet_unit_id: 'thing-o-matic-01' },
          result: {
            provider: 'cura',
            output_format: 'x3g',
            postprocessor: { engine: 'gpx', machine: 't6' },
            time_seconds: 1800,
            filament_g: 12.5,
            filament_length_mm: 4210,
            validation: { valid: true, warnings: ['Collaudo fisico pendente.'], observed: { max_xyz: [20, 20, 20] } },
            profile_status: 'experimental',
            applied_profile: { printer_id: 'thing-o-matic', nozzle_mm: 0.35, material_id: 'pla' },
            print_ready: true,
            demo_only: false
          }
        }
      });
    }
    if (request.method === 'GET' && /^\/api\/v1\/slice-jobs\/[^/]+\/artifact$/.test(url.pathname)) {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': output.length });
      return response.end(output);
    }
    json(response, 404, { error: { code: 'not_found' } });
  });
  const started = await listen(server);
  return { ...started, output, createCount: () => created };
}

export interface MockCloud {
  baseUrl: string;
  input: Buffer;
  uploaded: () => Buffer;
  completedResult: () => unknown;
  failCount: () => number;
  heartbeatCount: () => number;
  uploadContentLength: () => string | undefined;
  close: () => Promise<void>;
}

export async function startMockCloud(options: { failFirstUpload?: boolean; revokeHeartbeat?: boolean } = {}): Promise<MockCloud> {
  const input = Buffer.from('solid mock\nendsolid mock\n', 'utf8');
  let uploaded = Buffer.alloc(0);
  let completed: unknown = null;
  let uploadAttempts = 0;
  let failures = 0;
  let heartbeats = 0;
  let uploadContentLength: string | undefined;
  const request: JobRequestV1 = {
    schema_version: 'affetta.job.v1',
    request_id: 'req_mock_01',
    idempotency_key: 'mock-idempotency-01',
    source: 'stampa3dbologna',
    operation: 'slice',
    input: {
      artifact_id: 'art_input_mock_01',
      filename: 'cubo.stl',
      format: 'stl',
      sha256: sha256Buffer(input),
      size_bytes: input.length,
      units: 'millimeter'
    },
    print_intent: {
      material_id: 'pla', quality_id: 'standard', strength_id: 'standard', color_id: 'black',
      quantity: 1, nozzle_mm: 0.35, requested_output_format: 'x3g'
    },
    routing: {
      mode: 'manual', require_production_ready: false, printer_profile_id: 'thing-o-matic', fleet_unit_id: 'thing-o-matic-01', preferred_engine: 'cura'
    }
  };
  let baseUrl = '';
  const lease = (): LeaseEnvelope => ({
    lease_id: 'lease_mock_01',
    lease_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    job_id: 'job_mock_01',
    request,
    input_download: { artifact_id: request.input.artifact_id, url: `${baseUrl}/storage/input`, method: 'GET' },
    output_upload: { artifact_id: 'art_output_mock_01', url: `${baseUrl}/storage/output`, method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' } }
  });
  const server = http.createServer(async (httpRequest, response) => {
    const url = new URL(httpRequest.url || '/', 'http://localhost');
    if (httpRequest.method === 'POST' && url.pathname === '/v1/agents/pair') {
      return json(response, 200, { agent_id: 'agt_mock_01', access_token: 'super-secret-agent-token', paired_at: new Date().toISOString() });
    }
    if (url.pathname.startsWith('/v1/') && httpRequest.headers.authorization !== 'Bearer super-secret-agent-token') {
      return json(response, 401, { error: { code: 'unauthorized', message: 'Token non valido.' } });
    }
    if (httpRequest.method === 'POST' && /\/heartbeat$/.test(url.pathname)) {
      heartbeats += 1;
      return json(response, 200, options.revokeHeartbeat ? { revoked: true } : {});
    }
    if (httpRequest.method === 'POST' && /\/lease$/.test(url.pathname)) {
      return json(response, 200, { lease: completed ? null : lease() });
    }
    if (httpRequest.method === 'POST' && /\/ack$/.test(url.pathname)) return json(response, 200, {});
    if (httpRequest.method === 'POST' && /\/progress$/.test(url.pathname)) {
      const body = JSON.parse((await readBody(httpRequest)).toString('utf8')) as { status?: string; stage?: string };
      const allowedStatuses = new Set([
        'assigned', 'downloading', 'preparing', 'slicing', 'validating',
        'postprocessing', 'uploading', 'cancel_requested'
      ]);
      const allowedStages = new Set([
        'lease', 'download', 'prepare', 'slice', 'validate',
        'postprocess', 'upload_result', 'cancel'
      ]);
      if (!allowedStatuses.has(String(body.status)) || !allowedStages.has(String(body.stage))) {
        return json(response, 422, {
          error: {
            code: 'invalid_progress_transition',
            message: 'Stato o stage di avanzamento non consentito.',
            details: { status: body.status, stage: body.stage }
          }
        });
      }
      return json(response, 200, { lease_expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
    }
    if (httpRequest.method === 'POST' && /\/upload-complete$/.test(url.pathname)) return json(response, 200, {});
    if (httpRequest.method === 'POST' && /\/complete$/.test(url.pathname)) {
      const body = JSON.parse((await readBody(httpRequest)).toString('utf8')) as unknown;
      const contractError = validateCompletedResultEnvelope(body, request);
      if (contractError) {
        return json(response, 422, {
          error: { code: 'invalid_job_result', message: contractError }
        });
      }
      completed = body;
      return json(response, 200, {});
    }
    if (httpRequest.method === 'POST' && /\/fail$/.test(url.pathname)) {
      failures += 1;
      return json(response, 200, {});
    }
    if (httpRequest.method === 'GET' && url.pathname === '/storage/input') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': input.length });
      return response.end(input);
    }
    if (httpRequest.method === 'PUT' && url.pathname === '/storage/output') {
      uploadAttempts += 1;
      uploadContentLength = httpRequest.headers['content-length'];
      if (!uploadContentLength) {
        return json(response, 411, { error: { code: 'length_required', message: 'Content-Length obbligatorio.' } });
      }
      const body = await readBody(httpRequest);
      if (Number(uploadContentLength) !== body.length) {
        return json(response, 400, { error: { code: 'length_mismatch', message: 'Content-Length non coerente.' } });
      }
      if (options.failFirstUpload && uploadAttempts === 1) return json(response, 503, { error: { code: 'storage_unavailable' } });
      uploaded = Buffer.from(body);
      response.writeHead(200);
      return response.end();
    }
    json(response, 404, { error: { code: 'not_found' } });
  });
  const started = await listen(server);
  baseUrl = started.baseUrl;
  return {
    ...started,
    input,
    uploaded: () => uploaded,
    completedResult: () => completed,
    failCount: () => failures,
    heartbeatCount: () => heartbeats,
    uploadContentLength: () => uploadContentLength
  };
}
