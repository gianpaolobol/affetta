function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function mapFlags(state, completion) {
  const flags = state?.flags || {};
  if (flags.error || flags.closedOrError) return { machine_status: 'error', job_status: 'failed' };
  if (flags.cancelling) return { machine_status: 'printing', job_status: 'cancelled' };
  if (flags.paused || flags.pausing) return { machine_status: 'paused', job_status: 'paused' };
  if (flags.printing || flags.resuming || flags.finishing) return { machine_status: 'printing', job_status: 'printing' };
  if (flags.operational || flags.ready) {
    return completion !== null && completion >= 99.9
      ? { machine_status: 'ready', job_status: 'completed' }
      : { machine_status: 'ready', job_status: 'none' };
  }
  return { machine_status: 'offline', job_status: 'none' };
}

export class OctoPrintAdapter {
  constructor({ fetchImpl = fetch, timeoutMs = 5000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async request(printer, pathname) {
    if (!printer.endpoint) throw Object.assign(new Error('Endpoint OctoPrint mancante.'), { code: 'invalid_printer_configuration' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      if (printer.api_key) headers['X-Api-Key'] = printer.api_key;
      const response = await this.fetchImpl(`${printer.endpoint}${pathname}`, { headers, signal: controller.signal });
      if (!response.ok) {
        const code = [401, 403].includes(response.status) ? 'authentication_failed' : 'protocol_error';
        throw Object.assign(new Error(`OctoPrint HTTP ${response.status}.`), { code });
      }
      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') throw Object.assign(new Error('Timeout collegamento OctoPrint.'), { code: 'printer_unreachable' });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(printer) {
    const [job, printerState] = await Promise.all([
      this.request(printer, '/api/job'),
      this.request(printer, '/api/printer?exclude=sd')
    ]);
    const completion = numberOrNull(job?.progress?.completion);
    const mapped = mapFlags(printerState?.state, completion);
    const file = job?.job?.file || {};
    const elapsed = numberOrNull(job?.progress?.printTime);
    const remaining = numberOrNull(job?.progress?.printTimeLeft);
    const layer = job?.progress?.printTimeOrigin ? null : null;
    const temperatures = {};
    for (const [key, value] of Object.entries(printerState?.temperature || {})) {
      temperatures[key] = { actual: value?.actual ?? null, target: value?.target ?? null, offset: value?.offset ?? null };
    }
    return {
      connection_status: mapped.machine_status === 'offline' ? 'disconnected' : 'connected',
      ...mapped,
      progress_percent: completion,
      phase: printerState?.state?.text || job?.state || null,
      elapsed_seconds: elapsed,
      remaining_seconds: remaining,
      layer_current: layer,
      layer_total: null,
      active_file: file.display || file.name || file.path || null,
      remote_job_id: file.path || file.name || null,
      temperatures,
      alerts: mapped.job_status === 'failed' ? [{ code: 'octoprint_printer_error', severity: 'error', message: printerState?.state?.text || 'Errore OctoPrint.' }] : [],
      server_dependency: ['printing', 'paused', 'completed', 'failed', 'cancelled'].includes(mapped.job_status) ? 'device_autonomous' : 'not_applicable',
      raw: { job_state: job?.state || null, printer_flags: printerState?.state?.flags || {} }
    };
  }
}
