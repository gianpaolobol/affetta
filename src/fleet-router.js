import { catalogs } from './config.js';
import { analyzeStl, arrangeStlCopies } from './stl.js';
import { round } from './utils.js';

function roleScore(unit, role, points) {
  return unit.roles?.includes(role) ? points : 0;
}

function isDefinedColor(options) {
  return Boolean(options.color_id && options.color_id !== 'random');
}

function physicalUnits({ productionOnly = false } = {}) {
  return (catalogs.fleet?.units || []).filter((unit) => {
    if (!unit.enabled) return false;
    if (productionOnly && unit.production_ready !== true) return false;
    if (unit.pool && Number(unit.configured_units || 0) <= 0) return false;
    return Boolean(catalogs.printers[unit.printer_id]);
  });
}

function candidateScore(unit, printer, analysis, options, layout) {
  const [sx, sy, sz] = analysis.bounds_mm.size;
  const [bx, by, bz] = printer.build_mm;
  const footprintRatio = Math.max(sx / bx, sy / by);
  const heightRatio = sz / bz;
  const quality = options.quality_id;
  const material = options.material_id;
  const strength = options.strength_id;
  let score = Number(unit.priority || 0);
  const reasons = [];

  if (unit.preferred_materials?.includes(material)) { score += 24; reasons.push('materiale preferenziale'); }
  if (material === 'tpu') {
    const add = roleScore(unit, 'flexible', 42);
    score += add;
    if (add) reasons.push('reparto flessibili');
  }
  if (['abs', 'asa'].includes(material)) {
    if (printer.enclosed || unit.roles?.includes('enclosed')) { score += 50; reasons.push('camera chiusa'); }
    else score -= 80;
    score += roleScore(unit, 'engineering', 24);
  }
  if ((catalogs.materials[material]?.technology || 'fff') === 'msla') {
    score += roleScore(unit, 'resin', 100) + roleScore(unit, 'very-high-detail', 40);
  }
  if (['high', 'ultra'].includes(quality)) {
    const add = roleScore(unit, 'detail', 24) + roleScore(unit, 'very-high-detail', 35);
    score += add;
    if (add) reasons.push('profilo dettaglio');
    if (Number(unit.default_nozzle_mm || 0.4) >= 0.8) score -= 45;
  }
  if (quality === 'draft') {
    const add = roleScore(unit, 'fast', 24) + roleScore(unit, 'coarse', 18);
    score += add;
    if (add) reasons.push('profilo rapido');
  }
  if (['strong', 'solid'].includes(strength)) {
    const add = roleScore(unit, 'strong', 20) + roleScore(unit, 'engineering', 12);
    score += add;
    if (Number(unit.default_nozzle_mm || 0.4) >= 0.6) score += 12;
    if (add) reasons.push('profilo resistente');
  }
  if (Number(options.quantity || 1) >= Number(catalogs.fleet?.routing_rules?.batch_threshold || 4)) {
    const add = roleScore(unit, 'batch', 26);
    score += add;
    if (add) reasons.push('produzione in serie');
  }
  if (footprintRatio >= Number(catalogs.fleet?.routing_rules?.large_footprint_ratio || 0.65)) {
    const add = roleScore(unit, 'large', 26) + roleScore(unit, 'very-large', 42);
    score += add;
    if (add) reasons.push('grande formato');
  }
  if (sz >= Number(catalogs.fleet?.routing_rules?.tall_threshold_mm || 250)) {
    const add = roleScore(unit, 'tall', 35);
    score += add;
    if (add) reasons.push('pezzo alto');
  }
  if (isDefinedColor(options)) {
    const add = roleScore(unit, 'color-defined', 30) + roleScore(unit, 'multicolor', 18);
    score += add;
    if (add) reasons.push('gestione colore dedicata');
  }

  // Preferisce la macchina più piccola che contiene bene il lavoro, preservando
  // i grandi formati per i pezzi che ne hanno davvero bisogno.
  const utilization = Math.max(
    Number(layout?.footprint_mm?.[0] || sx) / bx,
    Number(layout?.footprint_mm?.[1] || sy) / by,
    heightRatio
  );
  score += Math.min(22, utilization * 22);
  if (utilization < 0.2 && unit.roles?.includes('very-large')) score -= 25;

  // Non occupare macchine premium per PLA standard/random quando sono disponibili
  // reparti generalisti equivalenti.
  if (material === 'pla' && quality === 'standard' && !isDefinedColor(options)) {
    if (unit.id === 'x1c-01') score -= 18;
    if (unit.id.startsWith('wasp-turbo')) score -= 20;
  }

  return { score: round(score, 2), reasons, utilization: round(utilization, 3) };
}

export function routeProductionJob({ modelBuffer, options, limit = 5, productionOnly = true }) {
  const analysis = analyzeStl(modelBuffer);
  const material = catalogs.materials[options.material_id];
  const technology = material?.technology || 'fff';
  const candidates = [];
  const rejected = [];

  for (const unit of physicalUnits({ productionOnly })) {
    const printer = catalogs.printers[unit.printer_id];
    if ((printer.technology || 'fff') !== technology) {
      rejected.push({ unit_id: unit.id, reason: 'technology_mismatch' });
      continue;
    }
    if (unit.material_ids && !unit.material_ids.includes(options.material_id)) {
      rejected.push({ unit_id: unit.id, reason: 'material_not_assigned' });
      continue;
    }
    if (printer.materials && !printer.materials.includes(options.material_id)) {
      rejected.push({ unit_id: unit.id, reason: 'material_not_supported' });
      continue;
    }
    if (unit.quality_ids && !unit.quality_ids.includes(options.quality_id)) {
      rejected.push({ unit_id: unit.id, reason: 'quality_not_assigned' });
      continue;
    }
    if (unit.strength_ids && !unit.strength_ids.includes(options.strength_id)) {
      rejected.push({ unit_id: unit.id, reason: 'strength_not_assigned' });
      continue;
    }
    const nozzle = Number(unit.default_nozzle_mm || printer.default_nozzle || 0);
    if (technology === 'fff' && !printer.nozzles.includes(nozzle)) {
      rejected.push({ unit_id: unit.id, reason: 'nozzle_not_supported' });
      continue;
    }

    let layout;
    try {
      layout = arrangeStlCopies(modelBuffer, options.quantity, printer).layout;
    } catch (error) {
      rejected.push({ unit_id: unit.id, reason: error.code || 'does_not_fit', detail: error.message });
      continue;
    }

    const ranked = candidateScore(unit, printer, analysis, options, layout);
    candidates.push({
      unit_id: unit.id,
      unit_label: unit.label,
      printer_id: unit.printer_id,
      printer_label: printer.label,
      nozzle_mm: technology === 'fff' ? nozzle : null,
      technology,
      engine_candidates: printer.engines,
      profile_status: printer.status,
      production_ready: unit.production_ready === true,
      calibration_status: unit.calibration_status || 'unknown',
      layout,
      ...ranked
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.unit_id.localeCompare(b.unit_id));
  if (!candidates.length) {
    throw Object.assign(new Error('Nessuna stampante del laboratorio è compatibile con modello, materiale e impostazioni richieste.'), {
      statusCode: 422,
      code: 'no_fleet_route',
      rejected
    });
  }
  return {
    fleet_id: catalogs.fleet.id,
    routing_version: catalogs.fleet.routing_version,
    analysis,
    selected: candidates[0],
    alternatives: candidates.slice(1, Math.max(1, limit)),
    rejected
  };
}

export function publicFleet() {
  return {
    id: catalogs.fleet.id,
    label: catalogs.fleet.label,
    routing_version: catalogs.fleet.routing_version,
    units: physicalUnits().map((unit) => {
      const printer = catalogs.printers[unit.printer_id];
      return {
        id: unit.id,
        label: unit.label,
        printer_id: unit.printer_id,
        printer_label: printer.label,
        technology: printer.technology || 'fff',
        build_mm: printer.build_mm,
        bed_shape: printer.bed_shape || 'rectangular',
        filament_diameter_mm: printer.filament_diameter_mm || null,
        default_nozzle_mm: unit.default_nozzle_mm || null,
        roles: unit.roles || [],
        enabled: unit.enabled !== false,
        profile_status: printer.status,
        production_ready: unit.production_ready === true,
        calibration_status: unit.calibration_status || 'unknown',
        material_ids: unit.material_ids || unit.preferred_materials || []
      };
    })
  };
}
