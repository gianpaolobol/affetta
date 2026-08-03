function seconds(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function mapState(state, progress) {
  switch (String(state || '').toLowerCase()) {
    case 'printing': return { machine_status: 'printing', job_status: 'printing' };
    case 'paused': return { machine_status: 'paused', job_status: 'paused' };
    case 'complete': return { machine_status: 'ready', job_status: 'completed' };
    case 'cancelled': return { machine_status: 'ready', job_status: 'cancelled' };
    case 'error': return { machine_status: 'error', job_status: 'failed' };
    case 'standby':
    default:
      return progress >= 99.9
        ? { machine_status: 'ready', job_status: 'completed' }
        : { machine_status: 'ready', job_status: 'none' };
  }
}

export class MoonrakerAdapter {
  constructor({ fetchImpl = fetch, timeoutMs = 5000 } = {}) {
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async probe(printer) {
    if (!printer.endpoint) throw Object.assign(new Error('Endpoint Moonraker mancante.'), { code: 'invalid_printer_configuration' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${printer.endpoint}/printer/objects/query?print_stats&display_status&extruder&heater_bed&webhooks`;
      const response = await this.fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw Object.assign(new Error(`Moonraker HTTP ${response.status}.`), { code: response.status === 401 ? 'authentication_failed' : 'protocol_error' });
      const payload = await response.json();
      const status = payload?.result?.status || {};
      const printStats = status.print_stats || {};
      const display = status.display_status || {};
      const progress = Number.isFinite(Number(display.progress)) ? Number(display.progress) * 100 : null;
      const mapped = mapState(printStats.state, progress);
      const total = seconds(printStats.total_duration);
      const elapsed = seconds(printStats.print_duration ?? printStats.total_duration);
      const remaining = progress && progress > 0 && elapsed !== null ? Math.max(0, Math.round(elapsed * (100 - progress) / progress)) : null;
      const info = printStats.info || {};
      return {
        connection_status: 'connected',
        ...mapped,
        progress_percent: progress,
        phase: printStats.message || printStats.state || null,
        elapsed_seconds: elapsed,
        remaining_seconds: remaining,
        layer_current: info.current_layer ?? null,
        layer_total: info.total_layer ?? null,
        active_file: printStats.filename || null,
        remote_job_id: printStats.filename || null,
        temperatures: {
          tool0: { actual: status.extruder?.temperature ?? null, target: status.extruder?.target ?? null },
          bed: { actual: status.heater_bed?.temperature ?? null, target: status.heater_bed?.target ?? null }
        },
        alerts: mapped.job_status === 'failed' ? [{ code: 'moonraker_print_error', severity: 'error', message: printStats.message || 'Stampa Klipper fallita.' }] : [],
        server_dependency: ['printing', 'paused', 'completed', 'failed', 'cancelled'].includes(mapped.job_status) ? 'device_autonomous' : 'not_applicable',
        raw: { state: printStats.state, webhooks: status.webhooks || null, total_duration: total }
      };
    } catch (error) {
      if (error?.name === 'AbortError') throw Object.assign(new Error('Timeout collegamento Moonraker.'), { code: 'printer_unreachable' });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
