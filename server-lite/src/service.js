import { normalizePrinterSnapshot, unreachableSnapshot, serverCanShutdown, isTerminalPrintStatus } from './state-model.js';

function nowIso() { return new Date().toISOString(); }
function sameJob(job, snapshot) {
  if (!job || !snapshot) return false;
  if (job.remote_job_id && snapshot.remote_job_id && job.remote_job_id === snapshot.remote_job_id) return true;
  const a = String(job.filename || '').toLowerCase();
  const b = String(snapshot.active_file || '').toLowerCase();
  return Boolean(a && b && (a === b || b.endsWith(`/${a}`) || a.endsWith(`/${b}`)));
}

export class ServerLiteService {
  constructor({ db, registry, printers = [], clock = { now: () => new Date() } }) {
    this.db = db;
    this.registry = registry;
    this.clock = clock;
    for (const printer of printers) this.db.upsertPrinter(printer, this.clock.now().toISOString());
  }

  async health() {
    return {
      ok: true,
      service: 'affetta-server-lite',
      mode: 'local-first',
      database_path: this.db.databasePath,
      printers: this.db.listPrinters().length,
      time: this.clock.now().toISOString()
    };
  }

  async reconcilePrinter(printerId, source = 'manual') {
    const printer = this.db.getPrinter(printerId);
    if (!printer) throw Object.assign(new Error('Stampante non configurata.'), { code: 'printer_not_found', statusCode: 404 });
    const previous = this.db.getSnapshot(printer.id);
    let snapshot;
    if (!printer.enabled) {
      snapshot = normalizePrinterSnapshot(printer, {
        connection_status: 'disabled', machine_status: 'offline', job_status: 'none',
        phase: 'Stampante disabilitata nella configurazione.', server_dependency: 'not_applicable'
      }, this.clock.now().toISOString());
    } else {
      try {
        const raw = await this.registry.get(printer.adapter).probe(printer);
        snapshot = normalizePrinterSnapshot(printer, raw, this.clock.now().toISOString());
      } catch (error) {
        snapshot = unreachableSnapshot(printer, error, previous, this.clock.now().toISOString());
      }
    }
    this.db.saveSnapshot(snapshot, source);
    const reconciliation = this.reconcileJob(printer, previous, snapshot, source);
    return { printer, snapshot, reconciliation };
  }

  reconcileJob(printer, previous, snapshot, source) {
    const activeJobs = this.db.listActiveJobs(printer.id);
    let job = activeJobs.find((candidate) => sameJob(candidate, snapshot)) || activeJobs[0] || null;
    if (!job) return { matched: false, job: null };

    const patch = {
      remote_job_id: snapshot.remote_job_id || job.remote_job_id,
      progress_percent: snapshot.progress_percent,
      autonomous: snapshot.server_dependency === 'device_autonomous',
      outcome_source: `adapter:${printer.adapter}`
    };

    if (['printing', 'paused'].includes(snapshot.job_status)) {
      patch.status = snapshot.job_status;
      patch.started_at = job.started_at || snapshot.observed_at;
    } else if (isTerminalPrintStatus(snapshot.job_status)) {
      patch.status = snapshot.job_status;
      patch.completed_at = snapshot.observed_at;
      patch.autonomous = true;
    } else if (
      previous && ['printing', 'paused'].includes(previous.job_status) &&
      snapshot.connection_status === 'connected' && snapshot.job_status === 'none'
    ) {
      patch.status = 'outcome_unknown';
      patch.completed_at = snapshot.observed_at;
      patch.autonomous = true;
      patch.outcome_source = `inference:${printer.adapter}:insufficient_history`;
    } else {
      return { matched: true, job };
    }

    job = this.db.updateJob(job.id, patch, source, snapshot.observed_at);
    return { matched: true, job };
  }

  async reconcileAll(source = 'manual') {
    const results = [];
    for (const printer of this.db.listPrinters()) {
      results.push(await this.reconcilePrinter(printer.id, source));
    }
    return {
      observed_at: this.clock.now().toISOString(),
      printers: results,
      summary: this.summary()
    };
  }

  summary() {
    const printers = this.db.listPrinters();
    const snapshots = printers.map((printer) => this.db.getSnapshot(printer.id) || normalizePrinterSnapshot(printer, {
      connection_status: printer.enabled ? 'unknown' : 'disabled',
      machine_status: 'offline',
      job_status: 'none',
      phase: 'In attesa della prima interrogazione.'
    }));
    const jobs = this.db.listJobs(200);
    const readiness = serverCanShutdown(snapshots, jobs);
    return {
      observed_at: nowIso(),
      totals: {
        configured: printers.length,
        connected: snapshots.filter((item) => item.connection_status === 'connected').length,
        printing: snapshots.filter((item) => item.job_status === 'printing').length,
        paused: snapshots.filter((item) => item.job_status === 'paused').length,
        errors: snapshots.filter((item) => item.machine_status === 'error' || item.error).length,
        unreachable: snapshots.filter((item) => ['unreachable', 'disconnected', 'authentication_failed', 'protocol_error'].includes(item.connection_status)).length
      },
      shutdown_readiness: readiness,
      printers: snapshots,
      active_jobs: jobs.filter((job) => !isTerminalPrintStatus(job.status))
    };
  }

  getPrinter(printerId) {
    const printer = this.db.getPrinter(printerId);
    if (!printer) throw Object.assign(new Error('Stampante non configurata.'), { code: 'printer_not_found', statusCode: 404 });
    return {
      printer,
      snapshot: this.db.getSnapshot(printerId),
      jobs: this.db.listJobs(200).filter((job) => job.printer_id === printerId),
      events: this.db.listEvents(printerId, 100)
    };
  }

  listPrinters() {
    return this.db.listPrinters().map((printer) => ({ printer, snapshot: this.db.getSnapshot(printer.id) }));
  }

  registerDelivery(body) {
    if (!body || typeof body !== 'object') throw Object.assign(new Error('Body non valido.'), { code: 'invalid_request', statusCode: 400 });
    const printer = this.db.getPrinter(String(body.printer_id || ''));
    if (!printer) throw Object.assign(new Error('Stampante non configurata.'), { code: 'printer_not_found', statusCode: 404 });
    const filename = String(body.filename || '').trim();
    if (!filename) throw Object.assign(new Error('filename obbligatorio.'), { code: 'invalid_request', statusCode: 400 });
    const allowed = ['queued', 'transferring', 'transferred', 'starting', 'printing', 'paused', 'completed', 'failed', 'cancelled', 'interrupted', 'outcome_unknown'];
    const status = allowed.includes(body.status) ? body.status : 'transferred';
    return this.db.registerDelivery({
      id: body.id ? String(body.id) : undefined,
      printer_id: printer.id,
      filename,
      sha256: body.sha256 ? String(body.sha256) : null,
      remote_job_id: body.remote_job_id ? String(body.remote_job_id) : null,
      status,
      progress_percent: body.progress_percent ?? null,
      autonomous: Boolean(body.autonomous),
      sent_at: body.sent_at || null,
      started_at: body.started_at || null,
      completed_at: body.completed_at || null,
      metadata: body.metadata || {}
    }, this.clock.now().toISOString());
  }

  listJobs() { return this.db.listJobs(200); }
  getJob(id) {
    const job = this.db.getJob(id);
    if (!job) throw Object.assign(new Error('Lavoro non trovato.'), { code: 'job_not_found', statusCode: 404 });
    return job;
  }

  shutdownReadiness() {
    return serverCanShutdown(this.db.listSnapshots(), this.db.listJobs(200));
  }
}
