import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export function parseDotEnv(text) {
  const result = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export function readDotEnv(file) {
  return parseDotEnv(fs.readFileSync(file, 'utf8'));
}

export function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sessionSuffix(bytes = 8) {
  return randomBytes(bytes).toString('hex');
}

export function normalizeBaseUrl(value, label) {
  let parsed;
  try { parsed = new URL(value); }
  catch { throw new Error(`${label} non è un URL valido.`); }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

export function assertLocalLoopback(value, label) {
  const parsed = new URL(value);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error(`${label} deve restare su loopback durante P3.3.`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} usa un protocollo non supportato.`);
  }
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function unique(values) {
  return [...new Set(values)];
}

export function chooseCatalogColor(catalog) {
  const colors = object(catalog?.colors);
  const ids = Object.keys(colors).filter((id) => typeof id === 'string' && id.trim().length > 0);
  if (ids.length === 0) {
    throw new Error('Il catalogo Affetta non espone alcun color_id valido per il collaudo P3.3.');
  }
  for (const preferred of ['random', 'black', 'white']) {
    if (ids.includes(preferred)) return preferred;
  }
  return ids.sort((a, b) => a.localeCompare(b))[0];
}

export function chooseProductionGcodeTarget({ catalog, fleet, diagnostics }) {
  const printers = object(catalog?.printers);
  const colorId = chooseCatalogColor(catalog);
  const units = Array.isArray(fleet?.fleet?.units) ? fleet.fleet.units : [];
  const slicing = object(diagnostics?.slicing);
  const printerDiagnostics = object(slicing.printers);

  const candidates = [];
  for (const unit of units) {
    if (!unit || unit.production_ready !== true || typeof unit.printer_id !== 'string') continue;
    const profileId = unit.printer_id;
    if (profileId.toLowerCase().includes('thing-o-matic')) continue;
    const profile = object(printers[profileId]);
    const diagnostic = object(printerDiagnostics[profileId]);
    const outputFormat = String(diagnostic.output_format || 'gcode').toLowerCase();
    if (outputFormat !== 'gcode') continue;

    const profileMaterials = Array.isArray(profile.materials) ? profile.materials.map(String) : [];
    const unitMaterials = Array.isArray(unit.material_ids) ? unit.material_ids.map(String) : [];
    const allowedMaterials = unitMaterials.length > 0
      ? profileMaterials.filter((material) => unitMaterials.includes(material))
      : profileMaterials;
    const materials = allowedMaterials.length > 0 ? allowedMaterials : unitMaterials;
    if (materials.length === 0) continue;

    const nozzles = unique(
      (Array.isArray(profile.nozzles) ? profile.nozzles : [profile.default_nozzle ?? 0.4])
        .map(Number)
        .filter((value) => Number.isFinite(value) && value > 0 && value <= 3)
    ).sort((a, b) => a - b);
    if (nozzles.length === 0) continue;

    const material = materials.includes('pla') ? 'pla' : materials[0];
    const defaultNozzle = Number(profile.default_nozzle);
    const nozzle = nozzles.includes(defaultNozzle) ? defaultNozzle : nozzles[0];
    candidates.push({
      fleet_unit_id: String(unit.id),
      printer_profile_id: profileId,
      material_id: material,
      color_id: colorId,
      nozzle_mm: nozzle,
      output_format: 'gcode',
      profile_status: String(profile.status || diagnostic.profile_status || 'unknown'),
      calibration_status: String(unit.calibration_status || 'unknown')
    });
  }

  candidates.sort((a, b) => {
    const aPla = a.material_id === 'pla' ? 0 : 1;
    const bPla = b.material_id === 'pla' ? 0 : 1;
    if (aPla !== bPla) return aPla - bPla;
    return a.printer_profile_id.localeCompare(b.printer_profile_id) || a.fleet_unit_id.localeCompare(b.fleet_unit_id);
  });
  if (candidates.length === 0) {
    throw new Error('Nessuna unità G-code production_ready compatibile disponibile per il collaudo P3.3.');
  }
  return candidates[0];
}

export function buildJobRequest({ artifact, sha256, sizeBytes, target, suffix, filename }) {
  return {
    schema_version: 'affetta.job.v1',
    request_id: `req_p33_${suffix}`,
    idempotency_key: `p3-3-${suffix}`,
    source: 'api',
    operation: 'slice',
    created_at: new Date().toISOString(),
    input: {
      artifact_id: artifact.id,
      filename,
      format: 'stl',
      sha256,
      size_bytes: sizeBytes,
      units: 'millimeter'
    },
    print_intent: {
      material_id: target.material_id,
      quality_id: 'standard',
      strength_id: 'standard',
      color_id: target.color_id,
      quantity: 1,
      nozzle_mm: target.nozzle_mm,
      requested_output_format: 'gcode'
    },
    routing: {
      mode: 'manual',
      require_production_ready: true,
      printer_profile_id: target.printer_profile_id,
      fleet_unit_id: target.fleet_unit_id
    },
    extensions: {
      'affetta.p3-3.synthetic': true,
      'affetta.p3-3.no-physical-print': true
    }
  };
}

export function parseJsonEvents(text) {
  const events = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.event === 'string') events.push(parsed);
    } catch {}
  }
  return events;
}

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (/token|secret|password|api[_-]?key|pairing[_-]?code/i.test(key)) result[key] = '[REDACTED]';
    else result[key] = redact(item);
  }
  return result;
}

export function safeReportPath(baseDir, timestamp = new Date()) {
  const stamp = timestamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return path.join(baseDir, `p3-3-live-test-report-${stamp}.json`);
}
