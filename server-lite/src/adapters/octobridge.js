import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

function endpointFor(printer) {
  const endpoint = String(printer?.endpoint || '').replace(/\/+$/, '');
  if (!endpoint) {
    throw Object.assign(new Error('Endpoint Affetta OctoBridge mancante.'), { code: 'invalid_printer_configuration' });
  }
  return endpoint;
}

function tokenFor(printer) {
  const token = String(printer?.api_token || printer?.bridge_token || printer?.api_key || printer?.options?.api_token || '').trim();
  if (!token) {
    throw Object.assign(new Error('Token Affetta OctoBridge mancante.'), { code: 'invalid_printer_configuration' });
  }
  return token;
}

function mapBridgeJobStatus(value) {
  if (value === 'cancel_requested') return 'printing';
  const allowed = new Set([
    'none', 'queued', 'transferring', 'transferred', 'starting', 'printing', 'paused',
    'completed', 'failed', 'cancelled', 'interrupted', 'outcome_unknown'
  ]);
  return allowed.has(value) ? value : 'none';
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  return hash.digest('hex');
}

export class OctoBridgeAdapter {
  constructor({ fetchImpl = fetch, timeoutMs = 8000, transferTimeoutMs = 900000, actionTimeoutMs = 60000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.transferTimeoutMs = transferTimeoutMs;
    this.actionTimeoutMs = actionTimeoutMs;
  }

  async request(printer, pathname, { method = 'GET', json, body, headers = {}, timeoutMs = this.timeoutMs } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const requestHeaders = {
        Accept: 'application/json',
        Authorization: `Bearer ${tokenFor(printer)}`,
        ...headers
      };
      let requestBody = body;
      if (json !== undefined) {
        requestHeaders['Content-Type'] = 'application/json';
        requestBody = JSON.stringify(json);
      }
      const options = { method, headers: requestHeaders, body: requestBody, signal: controller.signal };
      if (body && typeof body.pipe === 'function') options.duplex = 'half';
      const response = await this.fetchImpl(`${endpointFor(printer)}${pathname}`, options);
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        const code = [401, 403].includes(response.status) ? 'authentication_failed' : 'protocol_error';
        throw Object.assign(new Error(`OctoBridge HTTP ${response.status}: ${text.slice(0, 500)}`), { code });
      }
      const contentType = response.headers?.get?.('content-type') || '';
      return contentType.includes('application/json') ? await response.json() : response;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw Object.assign(new Error('Timeout collegamento Affetta OctoBridge.'), { code: 'printer_unreachable' });
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(printer) {
    const payload = await this.request(printer, '/v1/status');
    const snapshot = payload?.printer_snapshot || {};
    return {
      connection_status: snapshot.connection_status || 'unknown',
      machine_status: snapshot.machine_status || 'unknown',
      job_status: mapBridgeJobStatus(snapshot.job_status),
      progress_percent: snapshot.progress_percent ?? null,
      phase: snapshot.phase || null,
      elapsed_seconds: snapshot.elapsed_seconds ?? null,
      remaining_seconds: snapshot.remaining_seconds ?? null,
      layer_current: snapshot.layer_current ?? null,
      layer_total: snapshot.layer_total ?? null,
      active_file: snapshot.active_file || null,
      remote_job_id: payload?.active_job_id || null,
      temperatures: snapshot.temperatures || {},
      alerts: snapshot.alerts || [],
      server_dependency: snapshot.server_dependency || 'not_applicable',
      error: snapshot.error || null,
      raw: {
        ...(snapshot.raw || {}),
        bridge_id: payload?.bridge_id || null,
        bridge_release_channel: payload?.release_channel || null,
        bridge_production_ready: payload?.production_ready === true,
        serial_printing_enabled: payload?.serial_printing_enabled === true,
        pending_sync_count: payload?.pending_sync_count ?? null,
        bridge_job_status: snapshot.job_status || null
      }
    };
  }

  async stageJob(printer, job) {
    if (!job?.id || !job?.gcode_path || !job?.filename || !job?.printer_profile_id) {
      throw Object.assign(new Error('Job OctoBridge incompleto.'), { code: 'invalid_job' });
    }
    const fileStat = await stat(job.gcode_path);
    const digest = job.sha256 || await sha256File(job.gcode_path);
    if (job.size_bytes !== undefined && Number(job.size_bytes) !== fileStat.size) {
      throw Object.assign(new Error('Dimensione G-code differente da quella dichiarata.'), { code: 'gcode_integrity_error' });
    }
    if (job.sha256 && job.sha256.toLowerCase() !== digest.toLowerCase()) {
      throw Object.assign(new Error('SHA-256 G-code differente da quello dichiarato.'), { code: 'gcode_integrity_error' });
    }
    const metadata = {
      job_id: String(job.id),
      affetta_job_id: String(job.id),
      filename: String(job.filename),
      display_name: job.display_name || job.filename,
      size_bytes: fileStat.size,
      sha256: digest,
      printer_profile_id: String(job.printer_profile_id),
      source: job.source || {}
    };
    await this.request(printer, '/v1/jobs', { method: 'POST', json: metadata });
    await this.request(printer, `/v1/jobs/${encodeURIComponent(job.id)}/gcode`, {
      method: 'PUT',
      body: createReadStream(job.gcode_path),
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(fileStat.size)
      },
      timeoutMs: this.transferTimeoutMs
    });
    return await this.request(printer, `/v1/jobs/${encodeURIComponent(job.id)}/transfer`, { method: 'POST', json: {}, timeoutMs: this.transferTimeoutMs });
  }

  async startJob(printer, jobId) {
    return await this.request(printer, `/v1/jobs/${encodeURIComponent(jobId)}/start`, { method: 'POST', json: {}, timeoutMs: this.actionTimeoutMs });
  }

  async cancelJob(printer, jobId) {
    return await this.request(printer, `/v1/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST', json: {}, timeoutMs: this.actionTimeoutMs });
  }

  async pendingSync(printer) {
    return await this.request(printer, '/v1/sync/pending');
  }

  async acknowledgeSync(printer, jobId, { event_sequence = 0, files = [] } = {}) {
    return await this.request(printer, `/v1/jobs/${encodeURIComponent(jobId)}/sync-ack`, {
      method: 'POST',
      json: { event_sequence, files }
    });
  }
}
