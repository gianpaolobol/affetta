import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

function json(response, status, body) {
  const payload = JSON.stringify(body, null, 2);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    'x-content-type-options': 'nosniff'
  });
  response.end(payload);
}

async function bodyJson(request, maxBytes = 1_000_000) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBytes) throw Object.assign(new Error('Body troppo grande.'), { statusCode: 413, code: 'request_too_large' });
    chunks.push(buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON non valido.'), { statusCode: 400, code: 'invalid_json' }); }
}

function writeAllowed(request, config) {
  if (!config.api_token) return true;
  return request.headers['x-affetta-local-token'] === config.api_token;
}

function serveFile(response, file, contentType) {
  const payload = fs.readFileSync(file);
  response.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-store',
    'content-length': payload.length,
    'x-content-type-options': 'nosniff'
  });
  response.end(payload);
}

export function createServerLiteHttp({ service, config }) {
  return createServer(async (request, response) => {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const pathName = url.pathname;
    try {
      if (request.method === 'GET' && pathName === '/') {
        return serveFile(response, path.join(publicDir, 'index.html'), 'text/html; charset=utf-8');
      }
      if (request.method === 'GET' && pathName === '/app.js') {
        return serveFile(response, path.join(publicDir, 'app.js'), 'text/javascript; charset=utf-8');
      }
      if (request.method === 'GET' && pathName === '/styles.css') {
        return serveFile(response, path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8');
      }
      if (request.method === 'GET' && pathName === '/health') return json(response, 200, await service.health());
      if (request.method === 'GET' && pathName === '/api/v1/server-lite/summary') return json(response, 200, service.summary());
      if (request.method === 'GET' && pathName === '/api/v1/server-lite/printers') return json(response, 200, { printers: service.listPrinters() });
      if (request.method === 'GET' && pathName === '/api/v1/server-lite/jobs') return json(response, 200, { jobs: service.listJobs() });
      if (request.method === 'GET' && pathName === '/api/v1/server-lite/shutdown-readiness') return json(response, 200, service.shutdownReadiness());

      const printerMatch = /^\/api\/v1\/server-lite\/printers\/([^/]+)$/.exec(pathName);
      if (request.method === 'GET' && printerMatch) return json(response, 200, service.getPrinter(decodeURIComponent(printerMatch[1])));

      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method || '') && !writeAllowed(request, config)) {
        return json(response, 401, { error: { code: 'local_token_required', message: 'Token locale mancante o non valido.' } });
      }

      if (request.method === 'POST' && pathName === '/api/v1/server-lite/reconcile') {
        return json(response, 200, await service.reconcileAll('manual'));
      }
      const reconcileMatch = /^\/api\/v1\/server-lite\/printers\/([^/]+)\/reconcile$/.exec(pathName);
      if (request.method === 'POST' && reconcileMatch) {
        return json(response, 200, await service.reconcilePrinter(decodeURIComponent(reconcileMatch[1]), 'manual'));
      }
      if (request.method === 'POST' && pathName === '/api/v1/server-lite/jobs/register-delivery') {
        return json(response, 201, { job: service.registerDelivery(await bodyJson(request)) });
      }
      const jobMatch = /^\/api\/v1\/server-lite\/jobs\/([^/]+)$/.exec(pathName);
      if (request.method === 'GET' && jobMatch) return json(response, 200, { job: service.getJob(decodeURIComponent(jobMatch[1])) });

      return json(response, 404, { error: { code: 'route_not_found', message: 'Endpoint non trovato.' } });
    } catch (error) {
      const statusCode = Number(error?.statusCode) || 500;
      return json(response, statusCode, {
        error: {
          code: error?.code || 'server_error',
          message: statusCode >= 500 ? 'Errore interno Affetta Server Lite.' : error.message
        }
      });
    }
  });
}
