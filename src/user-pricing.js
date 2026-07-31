import { catalogs } from './config.js';
import { clamp, round } from './utils.js';

function mapValues(source, mapper) {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, mapper(value, key)]));
}

export function defaultPricingProfile() {
  return {
    currency: 'EUR',
    setup_eur: 4.5,
    labor_eur: 1.5,
    machine_eur_hour: 3.6,
    energy_eur_hour: 0.25,
    material_markup: 2.2,
    risk_percent: 10,
    margin_percent: 15,
    minimum_eur: 9.9,
    vat_percent: 0,
    materials_eur_kg: mapValues(catalogs.materials, (value) => value.cost_eur_kg),
    quality_price_factor: mapValues(catalogs.qualities, () => 1),
    strength_price_factor: mapValues(catalogs.strengths, () => 1),
    color_price_factor: mapValues(catalogs.colors, (value) => value.price_factor || 1)
  };
}

function number(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback;
}

function sanitizeMap(input, defaults, min, max) {
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => [key, number(input?.[key], fallback, min, max)]));
}

export function sanitizePricingProfile(input = {}, current = defaultPricingProfile()) {
  const defaults = { ...defaultPricingProfile(), ...current };
  return {
    currency: 'EUR',
    setup_eur: number(input.setup_eur, defaults.setup_eur, 0, 10000),
    labor_eur: number(input.labor_eur, defaults.labor_eur, 0, 10000),
    machine_eur_hour: number(input.machine_eur_hour, defaults.machine_eur_hour, 0, 10000),
    energy_eur_hour: number(input.energy_eur_hour, defaults.energy_eur_hour, 0, 1000),
    material_markup: number(input.material_markup, defaults.material_markup, 0, 20),
    risk_percent: number(input.risk_percent, defaults.risk_percent, 0, 100),
    margin_percent: number(input.margin_percent, defaults.margin_percent, 0, 500),
    minimum_eur: number(input.minimum_eur, defaults.minimum_eur, 0, 100000),
    vat_percent: number(input.vat_percent, defaults.vat_percent, 0, 100),
    materials_eur_kg: sanitizeMap(input.materials_eur_kg, defaults.materials_eur_kg, 0, 10000),
    quality_price_factor: sanitizeMap(input.quality_price_factor, defaults.quality_price_factor, 0.1, 10),
    strength_price_factor: sanitizeMap(input.strength_price_factor, defaults.strength_price_factor, 0.1, 10),
    color_price_factor: sanitizeMap(input.color_price_factor, defaults.color_price_factor, 0.1, 10)
  };
}

export function calculateUserPrice({ estimate, materialId, qualityId, strengthId, colorId, quantity, profile }) {
  const safeProfile = sanitizePricingProfile(profile);
  const units = Math.max(1, Math.min(999, Number(quantity) || 1));
  const materialCostKg = safeProfile.materials_eur_kg[materialId] ?? catalogs.materials[materialId].cost_eur_kg;
  const rawMaterialUnit = estimate.filament_g / 1000 * materialCostKg;
  const chargedMaterialUnit = rawMaterialUnit * safeProfile.material_markup;
  const machineUnit = estimate.time_seconds / 3600 * (safeProfile.machine_eur_hour + safeProfile.energy_eur_hour);
  const variableUnit = chargedMaterialUnit + machineUnit;
  const variableTotal = variableUnit * units;
  const base = safeProfile.setup_eur + safeProfile.labor_eur + variableTotal;
  const risk = base * (safeProfile.risk_percent / 100);
  const margin = (base + risk) * (safeProfile.margin_percent / 100);
  const factor = (safeProfile.quality_price_factor[qualityId] || 1)
    * (safeProfile.strength_price_factor[strengthId] || 1)
    * (safeProfile.color_price_factor[colorId] || 1);
  const preVat = Math.max((base + risk + margin) * factor, safeProfile.minimum_eur);
  const vat = preVat * safeProfile.vat_percent / 100;
  const total = preVat + vat;
  return {
    currency: safeProfile.currency,
    quantity: units,
    unit_eur: round(total / units, 2),
    total_eur: round(total, 2),
    breakdown: {
      setup_eur: round(safeProfile.setup_eur, 2),
      labor_eur: round(safeProfile.labor_eur, 2),
      raw_material_eur: round(rawMaterialUnit * units, 2),
      charged_material_eur: round(chargedMaterialUnit * units, 2),
      machine_energy_eur: round(machineUnit * units, 2),
      risk_eur: round(risk, 2),
      margin_eur: round(margin, 2),
      vat_eur: round(vat, 2),
      factor: round(factor, 4)
    }
  };
}
