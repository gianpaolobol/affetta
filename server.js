import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import { catalogs, config } from './src/config.js';
import { openApiDocument } from './src/openapi.js';
import { createQuote, createUserQuote, getQuote } from './src/quote-service.js';
import { createSliceJob, getArtifact, getSliceJob } from './src/slice-service.js';
import { systemCapabilities } from './src/providers/engine-registry.js';
import { publicProfile, resolvePrintProfile } from './src/providers/profile-resolver.js';
import { decodeModelPayload, validateQuoteOptions, validateSliceOptions } from './src/validation.js';
import { id } from './src/utils.js';
import { getPricingProfile, loginUser, logoutSession, registerUser, sessionUser, updatePricingProfile, verifyEmailToken } from './src/auth-service.js';
import { appendDiagnostic, normalizeError } from './src/runtime-diagnostics.js';

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const rate = new Map();
let capabilityCache = null;
let capabilityCacheAt = 0;
const sessionCookieName = 'affetta_session';

function routeContext(method, pathname) {
  const artifact = pathname.match(/^\/api\/v1\/slice-jobs\/([^/]+)\/artifact$/);
  if (artifact) return { phase: 'download_artifact', job_id: artifact[1] };
  const job = pathname.match(/^\/api\/v1\/slice-jobs\/([^/]+)$/);
  if (job) return { phase: 'poll_job', job_id: job[1] };
  if (method === 'POST' && (pathname === '/api/v1/affetta-jobs' || pathname === '/api/v1/slice-jobs')) return { phase: 'create_job', job_id: null };
  if (pathname === '/api/v1/health') return { phase: 'health', job_id: null };
  return { phase: pathname.startsWith('/api/') ? 'api' : 'static', job_id: null };
}

function attachRequestDiagnostics(req, res, { requestId, pathname }) {
  const startedAt = Date.now();
  const context = routeContext(req.method, pathname);
  let finished = false;
  appendDiagnostic('http_request_started', {
    request_id: requestId,
    method: req.method,
    route: pathname,
    phase: context.phase,
    job_id: context.job_id,
    remote_address: req.socket.remoteAddress || null
  });
  req.once('aborted', () => {
    appendDiagnostic('http_request_aborted', {
      request_id: requestId, method: req.method, route: pathname, phase: context.phase, job_id: context.job_id,
      duration_ms: Date.now() - startedAt
    });
  });
  res.once('error', (error) => {
    appendDiagnostic('http_response_error', {
      request_id: requestId, method: req.method, route: pathname, phase: context.phase, job_id: context.job_id,
      duration_ms: Date.now() - startedAt, error: normalizeError(error)
    });
  });
  res.once('finish', () => {
    finished = true;
    appendDiagnostic('http_request_completed', {
      request_id: requestId, method: req.method, route: pathname, phase: context.phase, job_id: context.job_id,
      status: res.statusCode, duration_ms: Date.now() - startedAt
    });
  });
  res.once('close', () => {
    if (!finished) {
      appendDiagnostic('http_response_closed_early', {
        request_id: requestId, method: req.method, route: pathname, phase: context.phase, job_id: context.job_id,
        status: res.statusCode, duration_ms: Date.now() - startedAt, writable_ended: res.writableEnded
      });
    }
  });
  return context;
}

function rateLimit(key, limit = 60, windowMs = 60_000) {
  const now = Date.now();
  const current = rate.get(key);
  if (!current || current.reset < now) {
    rate.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  current.count++;
  return current.count <= limit;
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const allowed = !origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin);
  return allowed && origin ? {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Affetta-Client, Idempotency-Key',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
  } : {};
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  };
}

function sendJson(req, res, status, value, extra = {}) {
  if (res.destroyed || res.writableEnded) {
    appendDiagnostic('http_json_response_unavailable', { request_url: req.url, status, destroyed: res.destroyed, writable_ended: res.writableEnded });
    return false;
  }
  try {
    const payload = JSON.stringify(value, null, 2);
    if (!res.headersSent) {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        ...securityHeaders(),
        ...corsHeaders(req),
        ...extra
      });
    }
    res.end(payload);
    return true;
  } catch (error) {
    appendDiagnostic('http_json_response_failed', { request_url: req.url, status, error: normalizeError(error) });
    if (!res.destroyed) res.destroy(error);
    return false;
  }
}


function pipeFile(req, res, file, headers, context = {}) {
  const stream = fs.createReadStream(file);
  let opened = false;
  let streamError = false;
  stream.once('open', () => {
    opened = true;
    if (res.destroyed || res.writableEnded) return stream.destroy();
    try {
      res.writeHead(200, headers);
      stream.pipe(res);
    } catch (error) {
      appendDiagnostic('http_file_response_start_failed', { ...context, file, request_url: req.url, error: normalizeError(error) });
      stream.destroy();
      if (!res.destroyed) res.destroy(error);
    }
  });
  stream.once('error', (error) => {
    streamError = true;
    appendDiagnostic('http_file_stream_error', {
      ...context,
      file,
      request_url: req.url,
      opened,
      error: normalizeError(error)
    });
    if (!res.headersSent && !res.destroyed && !res.writableEnded) {
      sendJson(req, res, 500, { success: false, error: { code: 'artifact_stream_failed', message: 'Lettura artefatto non riuscita.' } });
    } else if (!res.destroyed) {
      res.destroy(error);
    }
  });
  res.once('close', () => {
    if (!res.writableEnded && !stream.destroyed) stream.destroy();
    if (!streamError && !res.writableEnded) {
      appendDiagnostic('http_file_stream_interrupted', { ...context, file, request_url: req.url, opened });
    }
  });
  return stream;
}

function redirect(res, location, extra = {}) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...securityHeaders(), ...extra });
  res.end();
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function sessionCookie(sessionId) {
  const secure = config.publicBaseUrl.startsWith('https://') ? '; Secure' : '';
  return `${sessionCookieName}=${encodeURIComponent(sessionId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(config.sessionDays * 86400)}${secure}`;
}

function clearSessionCookie() {
  const secure = config.publicBaseUrl.startsWith('https://') ? '; Secure' : '';
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function requestUser(req) {
  return sessionUser(parseCookies(req)[sessionCookieName]);
}

function bearerToken(req) {
  const auth = req.headers.authorization || '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function tenantFromRequest(req) {
  const token = bearerToken(req);
  if (token) {
    if (config.adminToken && token === config.adminToken) return 'admin';
    return config.apiKeys.get(token) || null;
  }
  if (config.publicMode && isSameOrigin(req)) return 'public';
  return null;
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  const max = Math.ceil(config.maxFileBytes * 1.45) + 1024 * 1024;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Payload troppo grande.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON non valido.'), { statusCode: 400 }); }
}

function publicCatalog() {
  const pick = (obj, fields) => Object.fromEntries(Object.entries(obj).map(([idValue, value]) => [idValue, Object.fromEntries(fields.filter((field) => value[field] != null).map((field) => [field, value[field]]))]));
  return {
    app: catalogs.app,
    materials: pick(catalogs.materials, ['label']),
    qualities: pick(catalogs.qualities, ['label', 'layer_ratio']),
    strengths: pick(catalogs.strengths, ['label', 'infill_percent', 'walls']),
    colors: pick(catalogs.colors, ['label', 'description']),
    printers: pick(catalogs.printers, ['label', 'build_mm', 'nozzles', 'default_nozzle', 'materials', 'status'])
  };
}

async function capabilities({ admin = false } = {}) {
  if (!capabilityCache || Date.now() - capabilityCacheAt > 60_000) {
    capabilityCache = await systemCapabilities(catalogs.printers);
    capabilityCacheAt = Date.now();
  }
  if (admin) return capabilityCache;
  const printers = Object.fromEntries(Object.entries(capabilityCache.slicing.printers).map(([id, item]) => [id, {
    slice_available: item.slice_available,
    profile_status: item.profile_status
  }]));
  return {
    estimate: { ready: capabilityCache.estimate.ready },
    slicing: {
      ready_printers: capabilityCache.slicing.ready_printers,
      total_printers: capabilityCache.slicing.total_printers,
      printers
    }
  };
}

async function serveStatic(req, res, pathname) {
  const appRoutes = new Set(['/', '/dashboard', '/login', '/register']);
  const relative = appRoutes.has(pathname) ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(config.publicDir, relative);
  if (!candidate.startsWith(config.publicDir) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return false;
  const ext = path.extname(candidate).toLowerCase();
  pipeFile(req, res, candidate, {
    'Content-Type': mime[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store, max-age=0',
    'Pragma': 'no-cache',
    'Expires': '0',
    ...securityHeaders()
  }, { kind: 'static' });
  return true;
}

function requireVerifiedUser(req) {
  const auth = requestUser(req);
  if (!auth?.user?.email_verified_at) throw Object.assign(new Error('Accedi con un account verificato.'), { statusCode: 401, code: 'login_required' });
  return auth;
}

const server = http.createServer(async (req, res) => {
  const requestId = id('req');
  let pathname = String(req.url || '');
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    pathname = url.pathname;
    attachRequestDiagnostics(req, res, { requestId, pathname });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...corsHeaders(req), ...securityHeaders() });
      return res.end();
    }
    const ip = req.socket.remoteAddress || 'unknown';

    if (req.method === 'GET' && pathname === '/api/v1/health') {
      return sendJson(req, res, 200, {
        success: true,
        service: 'affetta',
        version: config.version,
        api_version: config.apiVersion,
        instance_id: config.instanceId,
        build_id: config.buildId,
        time: new Date().toISOString(),
        public_mode: config.publicMode,
        mail_mode: config.mailMode,
        process_id: process.pid,
        uptime_seconds: Math.round(process.uptime()),
        memory_rss_bytes: process.memoryUsage().rss,
        cwd: process.cwd(),
        exec_path: process.execPath
      }, { 'X-Request-Id': requestId });
    }
    if (req.method === 'GET' && pathname === '/api/v1/catalog') return sendJson(req, res, 200, { success: true, api_version: config.apiVersion, ...publicCatalog() });
    if (req.method === 'GET' && pathname === '/api/v1/capabilities') return sendJson(req, res, 200, { success: true, api_version: config.apiVersion, ...(await capabilities()) });
    if (req.method === 'GET' && pathname === '/api/v1/profile-preview') {
      const printerId = url.searchParams.get('printer_id');
      const printer = catalogs.printers[printerId];
      const nozzleMm = Number(url.searchParams.get('nozzle_mm') || printer?.default_nozzle || 0.4);
      const profile = resolvePrintProfile({
        printerId,
        nozzleMm,
        materialId: url.searchParams.get('material_id') || 'pla',
        qualityId: url.searchParams.get('quality_id') || 'standard',
        strengthId: url.searchParams.get('strength_id') || 'standard'
      });
      const cap = (await capabilities()).slicing.printers[printerId];
      return sendJson(req, res, 200, { success: true, api_version: config.apiVersion, profile: publicProfile(profile), slice_available: Boolean(cap?.slice_available) });
    }
    if (req.method === 'GET' && pathname === '/api/v1/openapi.json') return sendJson(req, res, 200, openApiDocument());

    if (pathname.startsWith('/api/')) {
      const artifactMatchPublic = pathname.match(/^\/api\/v1\/slice-jobs\/([^/]+)\/artifact$/);
      if (req.method === 'GET' && artifactMatchPublic) {
        const artifact = getArtifact(artifactMatchPublic[1], url.searchParams.get('token'));
        if (!artifact || !fs.existsSync(artifact.path)) return sendJson(req, res, 404, { success: false, error: { code: 'artifact_not_found', message: 'Artefatto non disponibile o scaduto.' } });
        return pipeFile(req, res, artifact.path, {
          'Content-Type': 'text/x-gcode; charset=utf-8',
          'Content-Disposition': `attachment; filename="${artifact.filename}"`,
          'Cache-Control': 'private, no-store',
          'X-Affetta-Demo': artifact.demo ? '1' : '0',
          ...securityHeaders()
        }, { kind: 'artifact', job_id: artifactMatchPublic[1] });
      }

      if (req.method === 'GET' && pathname === '/api/v1/auth/verify') {
        const verified = verifyEmailToken(url.searchParams.get('token'));
        return redirect(res, `/?email_verified=${verified ? '1' : '0'}`);
      }

      const isJobPoll = req.method === 'GET' && /^\/api\/v1\/slice-jobs\/[^/]+$/.test(pathname);
      const authLimit = pathname.startsWith('/api/v1/auth/') ? 12 : isJobPoll ? 600 : 80;
      if (!rateLimit(`${ip}:${pathname}`, authLimit)) return sendJson(req, res, 429, { success: false, error: { code: 'rate_limited', message: 'Troppe richieste. Riprova tra poco.' } });

      if (req.method === 'POST' && pathname === '/api/v1/auth/register') {
        if (!isSameOrigin(req)) return sendJson(req, res, 403, { success: false, error: { code: 'forbidden_origin', message: 'Registrazione consentita solo dall’app Affetta.' } });
        const result = await registerUser(await readJson(req));
        return sendJson(req, res, 201, { success: true, ...result });
      }
      if (req.method === 'POST' && pathname === '/api/v1/auth/login') {
        if (!isSameOrigin(req)) return sendJson(req, res, 403, { success: false, error: { code: 'forbidden_origin', message: 'Accesso consentito solo dall’app Affetta.' } });
        const result = loginUser(await readJson(req));
        return sendJson(req, res, 200, { success: true, user: result.user }, { 'Set-Cookie': sessionCookie(result.session_id) });
      }
      if (req.method === 'POST' && pathname === '/api/v1/auth/logout') {
        const sessionId = parseCookies(req)[sessionCookieName];
        logoutSession(sessionId);
        return sendJson(req, res, 200, { success: true }, { 'Set-Cookie': clearSessionCookie() });
      }
      if (req.method === 'GET' && pathname === '/api/v1/auth/me') {
        const auth = requestUser(req);
        return sendJson(req, res, 200, { success: true, authenticated: Boolean(auth), user: auth?.public || null });
      }
      if (pathname === '/api/v1/user/pricing-profile') {
        const auth = requireVerifiedUser(req);
        if (req.method === 'GET') return sendJson(req, res, 200, { success: true, profile: getPricingProfile(auth.user.id), catalogs: publicCatalog() });
        if (req.method === 'PUT') return sendJson(req, res, 200, { success: true, profile: updatePricingProfile(auth.user.id, await readJson(req)) });
      }

      const tenant = tenantFromRequest(req);
      if (!tenant) return sendJson(req, res, 401, { success: false, error: { code: 'unauthorized', message: 'API key mancante o origine non autorizzata.' } });
      const auth = requestUser(req);

      if (req.method === 'GET' && pathname === '/api/v1/admin/diagnostics') {
        if (tenant !== 'admin') return sendJson(req, res, 403, { success: false, error: { code: 'forbidden', message: 'Accesso amministratore richiesto.' } });
        return sendJson(req, res, 200, { success: true, version: config.version, ...(await capabilities({ admin: true })) });
      }

      if (req.method === 'POST' && pathname === '/api/v1/affetta-jobs') {
        const body = await readJson(req);
        const { filename, buffer } = decodeModelPayload(body);
        const options = validateSliceOptions(body);
        const jobTenant = tenant === 'admin' ? 'public' : tenant;
        const job = createSliceJob({ tenant: jobTenant, modelBuffer: buffer, filename, options });
        let quote = null;
        if (auth?.user?.email_verified_at) {
          quote = await createUserQuote({ userId: auth.user.id, pricingProfile: getPricingProfile(auth.user.id), modelBuffer: buffer, filename, options });
        } else if (tenant !== 'public') {
          quote = await createQuote({ tenant: jobTenant, modelBuffer: buffer, filename, options });
        }
        return sendJson(req, res, 202, {
          success: true,
          api_version: config.apiVersion,
          job,
          quote,
          pricing_access: Boolean(quote),
          registration_required_for_price: tenant === 'public' && !auth
        }, { 'X-Request-Id': requestId });
      }

      if (req.method === 'POST' && pathname === '/api/v1/quotes') {
        const body = await readJson(req);
        const { filename, buffer } = decodeModelPayload(body);
        const options = validateQuoteOptions(body);
        let quote;
        if (tenant === 'public') {
          const verified = requireVerifiedUser(req);
          quote = await createUserQuote({
            userId: verified.user.id,
            pricingProfile: getPricingProfile(verified.user.id),
            modelBuffer: buffer,
            filename,
            options
          });
        } else {
          quote = await createQuote({ tenant: tenant === 'admin' ? 'public' : tenant, modelBuffer: buffer, filename, options });
        }
        return sendJson(req, res, 200, quote, { 'X-Request-Id': requestId });
      }

      const quoteMatch = pathname.match(/^\/api\/v1\/quotes\/([^/]+)$/);
      if (req.method === 'GET' && quoteMatch) {
        const quoteTenant = auth ? `user:${auth.user.id}` : tenant;
        const quote = getQuote(quoteMatch[1], quoteTenant);
        if (!quote) return sendJson(req, res, 404, { success: false, error: { code: 'not_found', message: 'Preventivo non trovato.' } });
        return sendJson(req, res, 200, quote);
      }

      if (req.method === 'POST' && pathname === '/api/v1/slice-jobs') {
        const body = await readJson(req);
        const { filename, buffer } = decodeModelPayload(body);
        const options = validateSliceOptions(body);
        const job = createSliceJob({ tenant: tenant === 'admin' ? 'public' : tenant, modelBuffer: buffer, filename, options });
        return sendJson(req, res, 202, { success: true, api_version: config.apiVersion, job }, { 'X-Request-Id': requestId });
      }

      const jobMatch = pathname.match(/^\/api\/v1\/slice-jobs\/([^/]+)$/);
      if (req.method === 'GET' && jobMatch) {
        const job = getSliceJob(jobMatch[1], tenant);
        if (!job) return sendJson(req, res, 404, { success: false, error: { code: 'not_found', message: 'Job non trovato.' } });
        if (job.status === 'failed') {
          return sendJson(req, res, 422, {
            success: false,
            api_version: config.apiVersion,
            error: {
              code: job.error?.code || 'slice_failed',
              message: job.error?.message || 'Slicing non riuscito.',
              stage: job.error?.stage || job.phase || 'unknown'
            },
            job
          }, { 'X-Request-Id': requestId });
        }
        return sendJson(req, res, 200, { success: true, api_version: config.apiVersion, job }, { 'X-Request-Id': requestId });
      }

      return sendJson(req, res, 404, { success: false, error: { code: 'not_found', message: 'Endpoint non trovato.' } });
    }

    if (await serveStatic(req, res, pathname)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders() });
    res.end('Non trovato');
  } catch (error) {
    const status = error.statusCode || 500;
    appendDiagnostic('http_request_handler_failed', {
      request_id: requestId,
      method: req.method,
      route: pathname,
      ...routeContext(req.method, pathname),
      status,
      error: normalizeError(error)
    });
    if (status >= 500) console.error(`[${requestId}]`, error);
    sendJson(req, res, status, {
      success: false,
      error: {
        code: error.code || 'server_error',
        message: status >= 500 ? 'Errore interno Affetta.' : error.message,
        ...(error.stage ? { stage: error.stage } : {})
      },
      request_id: requestId
    }, { 'X-Request-Id': requestId });
  }
});

server.on('clientError', (error, socket) => {
  appendDiagnostic('http_client_error', { error: normalizeError(error), remote_address: socket?.remoteAddress || null });
  if (socket?.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.on('error', (error) => {
  appendDiagnostic('http_server_error', { error: normalizeError(error) }, { file: 'process-crash.jsonl' });
});

server.listen(config.port, config.host, () => {
  appendDiagnostic('http_server_listening', { host: config.host, port: config.port, public_base_url: config.publicBaseUrl });
  console.log(`Affetta ${config.version} attivo su ${config.publicBaseUrl} (listen ${config.host}:${config.port})`);
});

export { server };
