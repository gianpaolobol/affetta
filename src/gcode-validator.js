import { round } from './utils.js';

function numericTriplet(value, fallback) {
  if (!Array.isArray(value) || value.length !== 3) return [...fallback];
  return value.map((item, index) => Number.isFinite(Number(item)) ? Number(item) : fallback[index]);
}

function resolveMotionBounds(buildMm, motionBoundsMm) {
  const build = numericTriplet(buildMm, [0, 0, 0]);
  return {
    min: numericTriplet(motionBoundsMm?.min, [-15, -15, -1]),
    max: numericTriplet(motionBoundsMm?.max, build.map((value) => value + 5))
  };
}

export function validateGcode(text, { buildMm, material, motionBoundsMm = null }) {
  const warnings = [];
  const errors = [];
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxHotend = 0, maxBed = 0;
  let motionLines = 0;

  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.split(';', 1)[0].trim().toUpperCase();
    if (!line) continue;
    if (/^G0?1\b/.test(line)) {
      motionLines++;
      const x = line.match(/\bX(-?\d+(?:\.\d+)?)/)?.[1];
      const y = line.match(/\bY(-?\d+(?:\.\d+)?)/)?.[1];
      const z = line.match(/\bZ(-?\d+(?:\.\d+)?)/)?.[1];
      if (x != null) { const v = Number(x); minX = Math.min(minX, v); maxX = Math.max(maxX, v); }
      if (y != null) { const v = Number(y); minY = Math.min(minY, v); maxY = Math.max(maxY, v); }
      if (z != null) { const v = Number(z); minZ = Math.min(minZ, v); maxZ = Math.max(maxZ, v); }
    }
    const hot = line.match(/^M10[49]\s+.*?S(\d+(?:\.\d+)?)/)?.[1];
    const bed = line.match(/^M1(?:40|90)\s+.*?S(\d+(?:\.\d+)?)/)?.[1];
    if (hot) maxHotend = Math.max(maxHotend, Number(hot));
    if (bed) maxBed = Math.max(maxBed, Number(bed));
  }

  if (motionLines < 10) errors.push('Il file contiene troppo pochi movimenti per essere considerato un G-code di stampa.');

  const bounds = resolveMotionBounds(buildMm, motionBoundsMm);
  const outsideMotionEnvelope =
    maxX > bounds.max[0] || maxY > bounds.max[1] || maxZ > bounds.max[2] ||
    minX < bounds.min[0] || minY < bounds.min[1] || minZ < bounds.min[2];
  if (outsideMotionEnvelope) {
    errors.push(
      `Sono presenti coordinate oltre l'inviluppo ammesso. ` +
      `Rilevate X=${minX}..${maxX}, ` +
      `Y=${minY}..${maxY}, ` +
      `Z=${minZ}..${maxZ}; ` +
      `ammesse X=${bounds.min[0]}..${bounds.max[0]}, ` +
      `Y=${bounds.min[1]}..${bounds.max[1]}, ` +
      `Z=${bounds.min[2]}..${bounds.max[2]}.`
    );
  } else if (minX < 0 || minY < 0 || minZ < 0 || maxX > buildMm[0] || maxY > buildMm[1] || maxZ > buildMm[2]) {
    warnings.push('Il G-code contiene movimenti di servizio fuori dall’area nominale di stampa, compatibili con il profilo macchina selezionato.');
  }

  if (maxHotend > Math.max(300, material.nozzle_c + 35)) errors.push('Temperatura hotend oltre il limite prudenziale.');
  if (maxBed > 130) errors.push('Temperatura piano oltre il limite prudenziale.');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    observed: {
      min_xyz: [minX, minY, minZ].map((v) => Number.isFinite(v) ? round(v, 2) : null),
      max_xyz: [maxX, maxY, maxZ].map((v) => Number.isFinite(v) ? round(v, 2) : null),
      motion_bounds_mm: bounds,
      max_hotend_c: maxHotend,
      max_bed_c: maxBed,
      motion_lines: motionLines
    }
  };
}
