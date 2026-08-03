export const CONNECTION_STATUSES = Object.freeze([
  'unknown', 'connecting', 'connected', 'degraded', 'disconnected', 'unreachable',
  'authentication_failed', 'protocol_error', 'disabled'
]);

export const MACHINE_STATUSES = Object.freeze([
  'unknown', 'offline', 'initializing', 'ready', 'idle', 'preparing', 'heating',
  'calibrating', 'printing', 'paused', 'cooling', 'maintenance_required', 'error'
]);

export const PRINT_JOB_STATUSES = Object.freeze([
  'none', 'queued', 'transferring', 'transferred', 'starting', 'printing', 'paused',
  'completed', 'failed', 'cancelled', 'interrupted', 'outcome_unknown'
]);

export const SERVER_DEPENDENCIES = Object.freeze([
  'server_required', 'device_autonomous', 'not_applicable', 'unknown'
]);

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function optionalNumber(value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(min, Math.min(max, number));
}

function optionalInteger(value, options) {
  const number = optionalNumber(value, options);
  return number === null ? null : Math.round(number);
}

function optionalString(value, maxLength = 512) {
  if (value === null || value === undefined) return null;
  const string = String(value).trim();
  return string ? string.slice(0, maxLength) : null;
}

function normalizeAlerts(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 32).map((item) => {
    if (typeof item === 'string') return { code: 'device_notice', severity: 'info', message: item.slice(0, 500) };
    if (!item || typeof item !== 'object') return null;
    return {
      code: optionalString(item.code, 96) || 'device_notice',
      severity: ['info', 'warning', 'error', 'critical'].includes(item.severity) ? item.severity : 'warning',
      message: optionalString(item.message, 500) || 'Segnalazione della stampante.'
    };
  }).filter(Boolean);
}

export function normalizePrinterSnapshot(printer, input = {}, observedAt = new Date().toISOString()) {
  const connectionStatus = enumValue(input.connection_status, CONNECTION_STATUSES, 'unknown');
  const machineStatus = enumValue(input.machine_status, MACHINE_STATUSES,
    connectionStatus === 'connected' ? 'unknown' : 'offline');
  const jobStatus = enumValue(input.job_status, PRINT_JOB_STATUSES, 'none');
  const progress = optionalNumber(input.progress_percent, { min: 0, max: 100 });

  return {
    schema_version: 'affetta.printer-status.v1',
    printer_id: printer.id,
    printer_name: printer.name,
    printer_model: printer.model,
    adapter: printer.adapter,
    observed_at: optionalString(input.observed_at, 64) || observedAt,
    connection_status: connectionStatus,
    machine_status: machineStatus,
    job_status: jobStatus,
    progress_percent: progress,
    phase: optionalString(input.phase, 160),
    elapsed_seconds: optionalInteger(input.elapsed_seconds, { min: 0 }),
    remaining_seconds: optionalInteger(input.remaining_seconds, { min: 0 }),
    layer_current: optionalInteger(input.layer_current, { min: 0 }),
    layer_total: optionalInteger(input.layer_total, { min: 0 }),
    active_file: optionalString(input.active_file, 512),
    remote_job_id: optionalString(input.remote_job_id, 256),
    temperatures: input.temperatures && typeof input.temperatures === 'object' ? input.temperatures : {},
    alerts: normalizeAlerts(input.alerts),
    server_dependency: enumValue(input.server_dependency, SERVER_DEPENDENCIES,
      ['printing', 'paused', 'completed', 'failed', 'cancelled', 'interrupted'].includes(jobStatus)
        ? 'device_autonomous' : 'not_applicable'),
    error: input.error && typeof input.error === 'object' ? {
      code: optionalString(input.error.code, 96) || 'device_error',
      message: optionalString(input.error.message, 500) || 'Errore della stampante.',
      retryable: Boolean(input.error.retryable)
    } : null,
    raw: input.raw && typeof input.raw === 'object' ? input.raw : {}
  };
}

export function unreachableSnapshot(printer, error, previous = null, observedAt = new Date().toISOString()) {
  const code = optionalString(error?.code, 96) || 'printer_unreachable';
  const message = optionalString(error?.message, 500) || 'Stampante non raggiungibile.';
  return normalizePrinterSnapshot(printer, {
    observed_at: observedAt,
    connection_status: code === 'authentication_failed' ? 'authentication_failed' : 'unreachable',
    machine_status: 'offline',
    job_status: previous?.job_status && previous.job_status !== 'none' ? previous.job_status : 'none',
    progress_percent: previous?.progress_percent ?? null,
    phase: previous ? 'Ultimo stato noto; connessione non disponibile.' : null,
    elapsed_seconds: previous?.elapsed_seconds ?? null,
    remaining_seconds: previous?.remaining_seconds ?? null,
    layer_current: previous?.layer_current ?? null,
    layer_total: previous?.layer_total ?? null,
    active_file: previous?.active_file ?? null,
    remote_job_id: previous?.remote_job_id ?? null,
    temperatures: previous?.temperatures ?? {},
    server_dependency: previous?.server_dependency ?? 'unknown',
    alerts: [{ code, severity: 'error', message }],
    error: { code, message, retryable: true }
  }, observedAt);
}

export function stateChanged(previous, current) {
  if (!previous) return true;
  const keys = [
    'connection_status', 'machine_status', 'job_status', 'progress_percent', 'phase',
    'remaining_seconds', 'layer_current', 'layer_total', 'active_file', 'remote_job_id',
    'server_dependency'
  ];
  return keys.some((key) => previous[key] !== current[key]) ||
    JSON.stringify(previous.alerts || []) !== JSON.stringify(current.alerts || []) ||
    JSON.stringify(previous.error || null) !== JSON.stringify(current.error || null);
}

export function isTerminalPrintStatus(status) {
  return ['completed', 'failed', 'cancelled', 'interrupted', 'outcome_unknown'].includes(status);
}

export function serverCanShutdown(snapshots, jobs = []) {
  const blockingSnapshot = snapshots.find((snapshot) => snapshot.server_dependency === 'server_required');
  const blockingJob = jobs.find((job) => ['queued', 'transferring', 'transferred', 'starting'].includes(job.status) && !job.autonomous);
  return {
    can_shutdown: !blockingSnapshot && !blockingJob,
    reason: blockingSnapshot
      ? `La stampante ${blockingSnapshot.printer_name} dipende ancora dal server.`
      : blockingJob
        ? `Il lavoro ${blockingJob.filename} non è ancora autonomo dalla stampante.`
        : 'Tutti i lavori attivi sono autonomi oppure non ci sono trasferimenti in corso.',
    blocking_printer_id: blockingSnapshot?.printer_id || null,
    blocking_job_id: blockingJob?.id || null
  };
}
