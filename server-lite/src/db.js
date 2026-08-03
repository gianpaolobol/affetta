import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { stateChanged } from './state-model.js';

function nowIso() { return new Date().toISOString(); }
function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}
function json(value) { return JSON.stringify(value ?? null); }
function bool(value) { return value ? 1 : 0; }

export class ServerLiteDatabase {
  constructor(databasePath) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    this.databasePath = databasePath;
    this.db = new DatabaseSync(databasePath);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS printers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        model TEXT NOT NULL,
        adapter TEXT NOT NULL,
        endpoint TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS printer_snapshots (
        printer_id TEXT PRIMARY KEY REFERENCES printers(id) ON DELETE CASCADE,
        snapshot_json TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS print_jobs (
        id TEXT PRIMARY KEY,
        printer_id TEXT NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        sha256 TEXT,
        remote_job_id TEXT,
        status TEXT NOT NULL,
        progress_percent REAL,
        autonomous INTEGER NOT NULL DEFAULT 0,
        outcome_source TEXT NOT NULL DEFAULT 'affetta',
        created_at TEXT NOT NULL,
        sent_at TEXT,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE INDEX IF NOT EXISTS idx_print_jobs_printer_updated
        ON print_jobs(printer_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS status_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        printer_id TEXT NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
        job_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_status_events_printer_created
        ON status_events(printer_id, created_at DESC);
    `);
  }

  close() { this.db.close(); }

  upsertPrinter(printer, timestamp = nowIso()) {
    const current = this.getPrinter(printer.id);
    this.db.prepare(`
      INSERT INTO printers(id, name, model, adapter, endpoint, enabled, config_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, model=excluded.model, adapter=excluded.adapter,
        endpoint=excluded.endpoint, enabled=excluded.enabled,
        config_json=excluded.config_json, updated_at=excluded.updated_at
    `).run(
      printer.id, printer.name, printer.model, printer.adapter, printer.endpoint ?? null,
      bool(printer.enabled), json(printer), current?.created_at || timestamp, timestamp
    );
    return this.getPrinter(printer.id);
  }

  getPrinter(id) {
    const row = this.db.prepare('SELECT * FROM printers WHERE id = ?').get(id);
    return row ? this.mapPrinter(row) : null;
  }

  listPrinters() {
    return this.db.prepare('SELECT * FROM printers ORDER BY name COLLATE NOCASE').all().map((row) => this.mapPrinter(row));
  }

  mapPrinter(row) {
    const config = parseJson(row.config_json, {});
    return {
      ...config,
      id: row.id,
      name: row.name,
      model: row.model,
      adapter: row.adapter,
      endpoint: row.endpoint,
      enabled: Boolean(row.enabled),
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  getSnapshot(printerId) {
    const row = this.db.prepare('SELECT snapshot_json FROM printer_snapshots WHERE printer_id = ?').get(printerId);
    return row ? parseJson(row.snapshot_json, null) : null;
  }

  listSnapshots() {
    const rows = this.db.prepare('SELECT snapshot_json FROM printer_snapshots ORDER BY printer_id').all();
    return rows.map((row) => parseJson(row.snapshot_json, null)).filter(Boolean);
  }

  saveSnapshot(snapshot, source = 'poll') {
    const previous = this.getSnapshot(snapshot.printer_id);
    const timestamp = nowIso();
    this.db.prepare(`
      INSERT INTO printer_snapshots(printer_id, snapshot_json, observed_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(printer_id) DO UPDATE SET
        snapshot_json=excluded.snapshot_json, observed_at=excluded.observed_at, updated_at=excluded.updated_at
    `).run(snapshot.printer_id, json(snapshot), snapshot.observed_at, timestamp);

    if (stateChanged(previous, snapshot)) {
      this.appendEvent(snapshot.printer_id, null, 'printer_status_changed', { source, previous, current: snapshot }, timestamp);
    }
    return { previous, current: snapshot };
  }

  registerDelivery(input, timestamp = nowIso()) {
    const id = input.id || `print_${randomUUID().replaceAll('-', '')}`;
    const current = this.getJob(id);
    const record = {
      id,
      printer_id: input.printer_id,
      filename: input.filename,
      sha256: input.sha256 || null,
      remote_job_id: input.remote_job_id || null,
      status: input.status || 'transferred',
      progress_percent: input.progress_percent ?? null,
      autonomous: Boolean(input.autonomous),
      outcome_source: input.outcome_source || 'affetta',
      created_at: current?.created_at || input.created_at || timestamp,
      sent_at: input.sent_at || current?.sent_at || timestamp,
      started_at: input.started_at || current?.started_at || null,
      completed_at: input.completed_at || current?.completed_at || null,
      updated_at: timestamp,
      metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : current?.metadata || {}
    };
    this.db.prepare(`
      INSERT INTO print_jobs(id, printer_id, filename, sha256, remote_job_id, status, progress_percent,
        autonomous, outcome_source, created_at, sent_at, started_at, completed_at, updated_at, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        printer_id=excluded.printer_id, filename=excluded.filename, sha256=excluded.sha256,
        remote_job_id=excluded.remote_job_id, status=excluded.status,
        progress_percent=excluded.progress_percent, autonomous=excluded.autonomous,
        outcome_source=excluded.outcome_source, sent_at=excluded.sent_at,
        started_at=excluded.started_at, completed_at=excluded.completed_at,
        updated_at=excluded.updated_at, metadata_json=excluded.metadata_json
    `).run(
      record.id, record.printer_id, record.filename, record.sha256, record.remote_job_id,
      record.status, record.progress_percent, bool(record.autonomous), record.outcome_source,
      record.created_at, record.sent_at, record.started_at, record.completed_at,
      record.updated_at, json(record.metadata)
    );
    this.appendEvent(record.printer_id, record.id, 'delivery_registered', record, timestamp);
    return this.getJob(record.id);
  }

  updateJob(id, patch, source = 'reconciliation', timestamp = nowIso()) {
    const current = this.getJob(id);
    if (!current) return null;
    const next = {
      ...current,
      ...patch,
      metadata: patch.metadata && typeof patch.metadata === 'object' ? patch.metadata : current.metadata,
      updated_at: timestamp
    };
    this.db.prepare(`
      UPDATE print_jobs SET remote_job_id=?, status=?, progress_percent=?, autonomous=?, outcome_source=?,
        sent_at=?, started_at=?, completed_at=?, updated_at=?, metadata_json=? WHERE id=?
    `).run(
      next.remote_job_id, next.status, next.progress_percent, bool(next.autonomous), next.outcome_source,
      next.sent_at, next.started_at, next.completed_at, next.updated_at, json(next.metadata), id
    );
    this.appendEvent(next.printer_id, id, 'job_status_changed', { source, previous: current, current: next }, timestamp);
    return this.getJob(id);
  }

  getJob(id) {
    const row = this.db.prepare('SELECT * FROM print_jobs WHERE id = ?').get(id);
    return row ? this.mapJob(row) : null;
  }

  listJobs(limit = 100) {
    return this.db.prepare('SELECT * FROM print_jobs ORDER BY updated_at DESC LIMIT ?').all(limit).map((row) => this.mapJob(row));
  }

  listActiveJobs(printerId = null) {
    const terminal = "('completed','failed','cancelled','interrupted','outcome_unknown')";
    const sql = printerId
      ? `SELECT * FROM print_jobs WHERE printer_id=? AND status NOT IN ${terminal} ORDER BY updated_at DESC`
      : `SELECT * FROM print_jobs WHERE status NOT IN ${terminal} ORDER BY updated_at DESC`;
    const rows = printerId ? this.db.prepare(sql).all(printerId) : this.db.prepare(sql).all();
    return rows.map((row) => this.mapJob(row));
  }

  mapJob(row) {
    return {
      id: row.id,
      printer_id: row.printer_id,
      filename: row.filename,
      sha256: row.sha256,
      remote_job_id: row.remote_job_id,
      status: row.status,
      progress_percent: row.progress_percent,
      autonomous: Boolean(row.autonomous),
      outcome_source: row.outcome_source,
      created_at: row.created_at,
      sent_at: row.sent_at,
      started_at: row.started_at,
      completed_at: row.completed_at,
      updated_at: row.updated_at,
      metadata: parseJson(row.metadata_json, {})
    };
  }

  appendEvent(printerId, jobId, eventType, payload, timestamp = nowIso()) {
    this.db.prepare(`
      INSERT INTO status_events(printer_id, job_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(printerId, jobId, eventType, json(payload), timestamp);
  }

  listEvents(printerId, limit = 100) {
    return this.db.prepare(`
      SELECT id, printer_id, job_id, event_type, payload_json, created_at
      FROM status_events WHERE printer_id=? ORDER BY id DESC LIMIT ?
    `).all(printerId, limit).map((row) => ({ ...row, payload: parseJson(row.payload_json, {}) }));
  }
}
