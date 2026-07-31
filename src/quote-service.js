import { catalogs, config } from './config.js';
import { analyzeStl } from './stl.js';
import { formatDuration, id, round, sha256 } from './utils.js';
import { EstimateRouter } from './providers/estimate-router.js';
import { quoteStore } from './quote-store.js';
import { calculateUserPrice } from './user-pricing.js';

const estimator = new EstimateRouter();

function pricingModeForTenant(tenant, requested) {
  if (tenant === 'stampa3dbologna' && requested === 'internal') return 'internal';
  if (tenant === 'stampa3dbologna') return 'stampa3dbologna';
  if (tenant === 'reborn') return 'reborn';
  return 'retail';
}

async function estimateInput({ modelBuffer, filename, options }) {
  const material = catalogs.materials[options.material_id];
  const quality = catalogs.qualities[options.quality_id];
  const strength = catalogs.strengths[options.strength_id];
  const color = catalogs.colors[options.color_id];
  const analysis = analyzeStl(modelBuffer);
  const estimate = await estimator.estimate({ modelBuffer, filename, analysis, material, quality, strength });
  return { material, quality, strength, color, analysis, estimate };
}

function baseQuote({ tenant, modelBuffer, filename, options, material, quality, strength, color, analysis, estimate }) {
  const createdAt = new Date().toISOString();
  return {
    success: true,
    api_version: config.apiVersion,
    quote_id: id('quote'),
    created_at: createdAt,
    source: options.source,
    external_ref: options.external_ref,
    metadata: options.metadata,
    tenant,
    model: { filename, sha256: sha256(modelBuffer), ...analysis },
    selections: {
      material: { id: options.material_id, label: material.label },
      quality: { id: options.quality_id, label: quality.label, layer_height_mm: quality.layer_height_mm },
      strength: { id: options.strength_id, label: strength.label, infill_percent: strength.infill_percent, walls: strength.walls },
      color: {
        id: options.color_id,
        label: options.color_id === 'custom' && options.custom_color ? options.custom_color : color.label,
        custom: options.color_id === 'custom' ? options.custom_color : null
      },
      quantity: options.quantity
    },
    estimate: {
      ...(config.exposeEngineNames ? { provider: estimate.provider } : {}),
      quality: estimate.estimate_quality,
      time_seconds: estimate.time_seconds,
      time_human: formatDuration(estimate.time_seconds),
      filament_g: estimate.filament_g,
      filament_length_mm: estimate.filament_length_mm,
      layers: estimate.layers,
      warnings: [...analysis.warnings, ...(estimate.warnings || [])]
    },
    disclaimer: 'Stima automatica soggetta a verifica di orientamento, supporti, tolleranze e stampabilità.'
  };
}

export async function createQuote({ tenant, modelBuffer, filename, options }) {
  const input = await estimateInput({ modelBuffer, filename, options });
  const quote = baseQuote({ tenant, modelBuffer, filename, options, ...input });
  const mode = pricingModeForTenant(tenant, options.pricing_mode);
  const pricing = catalogs.pricing[mode];
  const quantity = options.quantity;
  const materialRaw = input.estimate.filament_g / 1000 * input.material.cost_eur_kg;
  const materialCharge = materialRaw * pricing.material_markup;
  const machineCharge = input.estimate.time_seconds / 3600 * pricing.machine_eur_hour;
  const variableTotal = (materialCharge + machineCharge) * quantity;
  const base = pricing.setup_eur + pricing.labor_eur + variableTotal;
  const risk = base * pricing.risk_percent * input.material.risk_factor;
  const platform = (base + risk) * (pricing.platform_percent || 0);
  const preMinimum = (base + risk + platform) * input.color.price_factor;
  const total = Math.max(preMinimum, pricing.minimum_eur);
  quote.price = {
    currency: pricing.currency,
    pricing_mode: mode,
    unit_eur: round(total / quantity, 2),
    total_eur: round(total, 2),
    breakdown: tenant === 'stampa3dbologna' ? {
      raw_material_eur: round(materialRaw * quantity, 3),
      charged_material_eur: round(materialCharge * quantity, 2),
      machine_eur: round(machineCharge * quantity, 2),
      setup_labor_eur: round(pricing.setup_eur + pricing.labor_eur, 2),
      risk_eur: round(risk, 2),
      platform_eur: round(platform, 2)
    } : undefined
  };
  quoteStore.create({ id: quote.quote_id, ...quote });
  return quote;
}

export async function createUserQuote({ userId, pricingProfile, modelBuffer, filename, options }) {
  const tenant = `user:${userId}`;
  const input = await estimateInput({ modelBuffer, filename, options });
  const quote = baseQuote({ tenant, modelBuffer, filename, options, ...input });
  quote.price = calculateUserPrice({
    estimate: input.estimate,
    materialId: options.material_id,
    qualityId: options.quality_id,
    strengthId: options.strength_id,
    colorId: options.color_id,
    quantity: options.quantity,
    profile: pricingProfile
  });
  quote.price.pricing_mode = 'user-profile';
  quoteStore.create({ id: quote.quote_id, ...quote });
  return quote;
}

export function getQuote(quoteId, tenant) {
  const quote = quoteStore.get(quoteId);
  if (!quote || (tenant !== 'admin' && quote.tenant !== tenant)) return null;
  return quote;
}
