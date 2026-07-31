import { round } from './utils.js';

function parseParams(line) {
  const params = {};
  for (const match of line.matchAll(/([A-Z])\s*(-?\d+(?:\.\d+)?)/gi)) params[match[1].toUpperCase()] = Number(match[2]);
  return params;
}

function parseNumber(value) {
  const number = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function parseNumberList(value) {
  const numbers = String(value)
    .split(/[,;\s]+/)
    .map(parseNumber)
    .filter((number) => number != null && number >= 0);
  return numbers.length ? numbers.reduce((sum, number) => sum + number, 0) : null;
}

export function parseDurationSeconds(value) {
  const text = String(value || '').trim().toLowerCase().replace(/,/g, '.');
  if (!text) return null;

  const colon = text.match(/^(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/);
  if (colon) {
    if (colon[3] != null) return Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
    return Number(colon[1]) * 60 + Number(colon[2]);
  }

  let total = 0;
  let foundUnit = false;
  const units = /([0-9]+(?:\.[0-9]+)?)\s*(days?|d|hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/g;
  for (const match of text.matchAll(units)) {
    const number = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(number)) continue;
    foundUnit = true;
    if (/^(?:days?|d)$/.test(unit)) total += number * 86400;
    else if (/^(?:hours?|hrs?|hr|h)$/.test(unit)) total += number * 3600;
    else if (/^(?:minutes?|mins?|min|m)$/.test(unit)) total += number * 60;
    else total += number;
  }
  return foundUnit && total > 0 ? total : null;
}

function timeCandidate(raw) {
  const exactSeconds = raw.match(/^\s*;?\s*(?:TIME|PRINT_TIME)\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*$/i);
  if (exactSeconds) return { seconds: Number(exactSeconds[1]), priority: 100, source: 'gcode_seconds_tag' };

  const definitions = [
    { pattern: /total estimated time\s*[:=]\s*([^;]+)/i, priority: 90, source: 'slicer_total_estimate' },
    { pattern: /estimated printing time(?:\s*\([^)]*\))?\s*[:=]\s*([^;]+)/i, priority: 80, source: 'slicer_estimate' },
    { pattern: /total printing time\s*[:=]\s*([^;]+)/i, priority: 75, source: 'slicer_total_printing_time' },
    { pattern: /model printing time\s*[:=]\s*([^;]+)/i, priority: 60, source: 'slicer_model_estimate' }
  ];
  for (const definition of definitions) {
    const match = raw.match(definition.pattern);
    if (!match) continue;
    const seconds = parseDurationSeconds(match[1]);
    if (seconds != null && seconds > 0) return { seconds, priority: definition.priority, source: definition.source };
  }
  return null;
}

function metadataCandidate(raw, kind) {
  const definitions = kind === 'length'
    ? [
        /(?:total\s+)?filament(?:\s+used|\s+length)?\s*\[mm\]\s*[:=]\s*([0-9.,;\s]+)/i,
        /total\s+filament\s+length\s*[:=]\s*([0-9.,;\s]+)\s*mm\b/i
      ]
    : [
        /(?:total\s+)?filament(?:\s+used|\s+weight)?\s*\[g\]\s*[:=]\s*([0-9.,;\s]+)/i,
        /total\s+filament\s+weight\s*[:=]\s*([0-9.,;\s]+)\s*g\b/i
      ];
  for (const pattern of definitions) {
    const match = raw.match(pattern);
    if (!match) continue;
    const value = parseNumberList(match[1]);
    if (value != null && value > 0) return value;
  }
  return null;
}

export function analyzeGcode(text, { filamentDiameterMm = 1.75, densityGcm3 = 1.24 } = {}) {
  let absoluteXYZ = true;
  let absoluteE = true;
  let x = 0, y = 0, z = 0, e = 0, feed = 1800;
  let extrusionMm = 0;
  let moveDistanceMm = 0;
  let estimatedSeconds = 0;
  let explicitTime = null;
  let explicitTimePriority = -1;
  let explicitTimeSource = null;
  let explicitFilamentLengthMm = null;
  let explicitFilamentG = null;
  let layerCount = 0;

  for (const raw of String(text).split(/\r?\n/)) {
    const candidate = timeCandidate(raw);
    if (candidate && candidate.priority > explicitTimePriority) {
      explicitTime = candidate.seconds;
      explicitTimePriority = candidate.priority;
      explicitTimeSource = candidate.source;
    }
    const lengthCandidate = metadataCandidate(raw, 'length');
    if (lengthCandidate != null) explicitFilamentLengthMm = Math.max(explicitFilamentLengthMm || 0, lengthCandidate);
    const weightCandidate = metadataCandidate(raw, 'weight');
    if (weightCandidate != null) explicitFilamentG = Math.max(explicitFilamentG || 0, weightCandidate);

    if (/;\s*LAYER[: ]/i.test(raw)) layerCount += 1;
    const line = raw.split(';', 1)[0].trim().toUpperCase();
    if (!line) continue;
    if (line.startsWith('G90')) absoluteXYZ = true;
    else if (line.startsWith('G91')) absoluteXYZ = false;
    else if (line.startsWith('M82')) absoluteE = true;
    else if (line.startsWith('M83')) absoluteE = false;
    else if (line.startsWith('G92')) {
      const p = parseParams(line);
      if (p.X != null) x = p.X;
      if (p.Y != null) y = p.Y;
      if (p.Z != null) z = p.Z;
      if (p.E != null) e = p.E;
    } else if (/^G0?1\b/.test(line) || /^G0\b/.test(line)) {
      const p = parseParams(line);
      if (p.F != null && p.F > 0) feed = p.F;
      const nx = p.X == null ? x : absoluteXYZ ? p.X : x + p.X;
      const ny = p.Y == null ? y : absoluteXYZ ? p.Y : y + p.Y;
      const nz = p.Z == null ? z : absoluteXYZ ? p.Z : z + p.Z;
      const ne = p.E == null ? e : absoluteE ? p.E : e + p.E;
      const distance = Math.hypot(nx - x, ny - y, nz - z);
      moveDistanceMm += distance;
      if (feed > 0) estimatedSeconds += distance / (feed / 60);
      const deltaE = ne - e;
      if (deltaE > 0) extrusionMm += deltaE;
      x = nx; y = ny; z = nz; e = ne;
    }
  }

  const filamentLengthMm = explicitFilamentLengthMm || extrusionMm;
  const radius = filamentDiameterMm / 2;
  const filamentVolumeMm3 = Math.PI * radius * radius * filamentLengthMm;
  const calculatedFilamentG = filamentVolumeMm3 / 1000 * densityGcm3;
  const filamentG = explicitFilamentG || calculatedFilamentG;
  const timeSeconds = explicitTime && explicitTime > 0 ? explicitTime : estimatedSeconds * 1.12;

  return {
    time_seconds: round(timeSeconds, 1),
    time_source: explicitTimeSource || 'motion_estimate',
    filament_length_mm: round(filamentLengthMm, 1),
    filament_g: round(filamentG, 2),
    filament_source: explicitFilamentG != null || explicitFilamentLengthMm != null ? 'slicer_metadata' : 'extrusion_commands',
    move_distance_mm: round(moveDistanceMm, 1),
    layers: layerCount || null
  };
}
