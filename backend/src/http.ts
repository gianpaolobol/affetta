import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { BackendError, asBackendError } from './errors.js';
import { openApiDocument } from './openapi.js';
import type { BackendService } from './service.js';
import type { ApiPrincipal, AgentPrincipal, Principal } from './types.js';
import type { MetricsRegistry } from './metrics.js';

export interface InjectRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface InjectResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
}

function bearer(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match?.[1];
}

function matchPath(pathname: string, pattern: RegExp): string[] | null {
  const match = pattern.exec(pathname);
  return match ? match.slice(1).map(decodeURIComponent) : null;
}

export class BackendHttpApi {
  constructor(private readonly service: BackendService, private readonly metrics: MetricsRegistry) {}

  async inject(request: InjectRequest): Promise<InjectResponse> {
    const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
    const correlationId = headers['x-correlation-id'] || `corr_${randomUUID().replaceAll('-', '')}`;
    try {
      const response = await this.dispatch(request.method.toUpperCase(), request.path.split('?')[0]!, headers, request.body, correlationId);
      this.metrics.increment('http_requests_total');
      this.metrics.increment(`http_status_${response.statusCode}_total`);
      return {
        statusCode: response.statusCode,
        headers: { 'content-type': 'application/json; charset=utf-8', 'x-correlation-id': correlationId, ...response.headers },
        body: response.body
      };
    } catch (error) {
      const normalized = asBackendError(error);
      this.metrics.increment('http_requests_total');
      this.metrics.increment(`http_status_${normalized.statusCode}_total`);
      return {
        statusCode: normalized.statusCode,
        headers: { 'content-type': 'application/json; charset=utf-8', 'x-correlation-id': correlationId },
        body: {
          error: {
            code: normalized.code,
            message: normalized.message,
            stage: 'backend',
            retryable: normalized.retryable,
            details: normalized.details,
            correlation_id: correlationId
          }
        }
      };
    }
  }

  private async dispatch(method: string, path: string, headers: Record<string, string>, body: unknown, correlationId: string): Promise<{ statusCode: number; headers: Record<string, string>; body: unknown }> {
    if (method === 'GET' && path === '/healthz') {
      return { statusCode: 200, headers: {}, body: { ok: true, service: 'affetta-backend', version: '0.1.0' } };
    }
    if (method === 'GET' && path === '/readyz') {
      const health = await this.service.health();
      return { statusCode: health.ok ? 200 : 503, headers: {}, body: health };
    }
    if (method === 'GET' && path === '/metrics') {
      return { statusCode: 200, headers: { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' }, body: this.metrics.prometheus() };
    }
    if (method === 'GET' && path === '/openapi.json') {
      return { statusCode: 200, headers: {}, body: openApiDocument };
    }

    if (method === 'POST' && path === '/v1/pairing-codes') {
      const principal = await this.apiPrincipal(headers);
      return { statusCode: 201, headers: {}, body: await this.service.createPairingCode(principal, body) };
    }
    if (method === 'POST' && path === '/v1/agents/pair') {
      return { statusCode: 200, headers: {}, body: await this.service.pairAgent(body) };
    }
    const heartbeat = matchPath(path, /^\/v1\/agents\/([^/]+)\/heartbeat$/);
    if (method === 'POST' && heartbeat) {
      const principal = await this.agentPrincipal(headers, heartbeat[0]);
      return { statusCode: 200, headers: {}, body: await this.service.heartbeat(principal, body) };
    }
    const lease = matchPath(path, /^\/v1\/agents\/([^/]+)\/lease$/);
    if (method === 'POST' && lease) {
      const principal = await this.agentPrincipal(headers, lease[0]);
      return { statusCode: 200, headers: {}, body: await this.service.lease(principal, body, correlationId) };
    }
    const revoke = matchPath(path, /^\/v1\/agents\/([^/]+)\/revoke$/);
    if (method === 'POST' && revoke) {
      const principal = await this.apiPrincipal(headers);
      return { statusCode: 200, headers: {}, body: await this.service.revokeAgent(principal, revoke[0]!) };
    }

    if (method === 'POST' && path === '/v1/artifacts/prepare-upload') {
      const principal = await this.apiPrincipal(headers);
      return { statusCode: 201, headers: {}, body: await this.service.prepareArtifactUpload(principal, body) };
    }
    const artifactComplete = matchPath(path, /^\/v1\/artifacts\/([^/]+)\/upload-complete$/);
    if (method === 'POST' && artifactComplete) {
      const principal = await this.artifactPrincipal(headers);
      return { statusCode: 200, headers: {}, body: await this.service.completeArtifactUpload(principal, artifactComplete[0]!, body) };
    }

    if (method === 'POST' && path === '/v1/jobs') {
      const principal = await this.apiPrincipal(headers);
      const result = await this.service.createJob(principal, body, correlationId);
      return { statusCode: result.created ? 201 : 200, headers: { 'idempotency-replayed': result.created ? 'false' : 'true' }, body: result };
    }
    const getJob = matchPath(path, /^\/v1\/jobs\/([^/]+)$/);
    if (method === 'GET' && getJob) {
      const principal = await this.apiPrincipal(headers);
      return { statusCode: 200, headers: {}, body: await this.service.getJob(principal, getJob[0]!) };
    }
    const cancel = matchPath(path, /^\/v1\/jobs\/([^/]+)\/cancel$/);
    if (method === 'POST' && cancel) {
      const principal = await this.apiPrincipal(headers);
      return { statusCode: 200, headers: {}, body: await this.service.cancelJob(principal, cancel[0]!, correlationId) };
    }
    const ack = matchPath(path, /^\/v1\/jobs\/([^/]+)\/ack$/);
    if (method === 'POST' && ack) {
      const principal = await this.agentPrincipal(headers);
      return { statusCode: 200, headers: {}, body: await this.service.ack(principal, ack[0]!, body, correlationId) };
    }
    const progress = matchPath(path, /^\/v1\/jobs\/([^/]+)\/progress$/);
    if (method === 'POST' && progress) {
      const principal = await this.agentPrincipal(headers);
      return { statusCode: 200, headers: {}, body: await this.service.progress(principal, progress[0]!, body, correlationId) };
    }
    const complete = matchPath(path, /^\/v1\/jobs\/([^/]+)\/complete$/);
    if (method === 'POST' && complete) {
      const principal = await this.agentPrincipal(headers);
      return { statusCode: 200, headers: {}, body: await this.service.complete(principal, complete[0]!, body, correlationId) };
    }
    const fail = matchPath(path, /^\/v1\/jobs\/([^/]+)\/fail$/);
    if (method === 'POST' && fail) {
      const principal = await this.agentPrincipal(headers);
      return { statusCode: 200, headers: {}, body: await this.service.fail(principal, fail[0]!, body, correlationId) };
    }

    throw new BackendError('route_not_found', 'Endpoint non trovato.', { statusCode: 404, details: { method, path } });
  }

  private apiPrincipal(headers: Record<string, string>): Promise<ApiPrincipal> {
    return this.service.authenticateApiKey(headers['x-api-key']);
  }

  private agentPrincipal(headers: Record<string, string>, expectedAgentId?: string): Promise<AgentPrincipal> {
    return this.service.authenticateAgent(bearer(headers.authorization), expectedAgentId);
  }

  private async artifactPrincipal(headers: Record<string, string>): Promise<Principal> {
    if (headers.authorization) return this.agentPrincipal(headers);
    return this.apiPrincipal(headers);
  }
}

export function createNodeServer(api: BackendHttpApi, maxJsonBytes: number): Server {
  return createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    try {
      for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxJsonBytes) throw new BackendError('request_too_large', 'Body JSON oltre il limite.', { statusCode: 413 });
        chunks.push(buffer);
      }
      let body: unknown = undefined;
      if (chunks.length > 0) {
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw new BackendError('invalid_json', 'Body JSON non valido.', { statusCode: 400 }); }
      }
      const result = await api.inject({
        method: request.method || 'GET',
        path: request.url || '/',
        headers: Object.fromEntries(Object.entries(request.headers).flatMap(([key, value]) => {
          if (typeof value === 'string') return [[key, value]];
          if (Array.isArray(value)) return [[key, value.join(',')]];
          return [];
        })),
        body
      });
      response.writeHead(result.statusCode, result.headers);
      const contentType = result.headers['content-type'] || '';
      response.end(contentType.startsWith('text/plain') && typeof result.body === 'string' ? result.body : JSON.stringify(result.body));
    } catch (error) {
      const normalized = asBackendError(error);
      response.writeHead(normalized.statusCode, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { code: normalized.code, message: normalized.message, retryable: normalized.retryable, details: normalized.details } }));
    }
  });
}
