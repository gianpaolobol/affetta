import { clamp, round } from '../utils.js';

export class GeometryEstimateProvider {
  constructor() { this.id = 'geometry-fallback'; }

  async estimate({ analysis, material, quality, strength, filamentDiameterMm = 1.75 }) {
    const volume = Math.max(analysis.volume_mm3, 1);
    const area = Math.max(analysis.surface_area_mm2, 1);
    const wallThickness = Math.max(0.8, strength.walls * 0.42);
    const shellVolume = Math.min(volume, area * wallThickness * 0.56);
    const innerVolume = Math.max(0, volume - shellVolume);
    const infillVolume = innerVolume * (strength.infill_percent / 100);
    const topBottomAllowance = Math.min(innerVolume - infillVolume, area * quality.layer_height_mm * (quality.top_layers + quality.bottom_layers) * 0.10);
    const supportAllowance = area * 0.015;
    const extrusionVolume = clamp(shellVolume + infillVolume + Math.max(0, topBottomAllowance) + supportAllowance, volume * 0.05, volume * 1.35);
    const filamentG = extrusionVolume / 1000 * material.density_g_cm3 * 1.06;
    const volumetricFlow = 7.5 * material.speed_factor * (0.20 / quality.layer_height_mm) ** 0.15;
    const depositionSeconds = extrusionVolume / Math.max(1.8, volumetricFlow);
    const layers = Math.max(1, Math.ceil(analysis.bounds_mm.size[2] / quality.layer_height_mm));
    const travelSeconds = layers * 2.7 + Math.sqrt(area) * 4.5;
    const timeSeconds = (depositionSeconds + travelSeconds) * quality.time_factor * strength.time_factor;
    return {
      provider: this.id,
      estimate_quality: 'development_fallback',
      time_seconds: round(timeSeconds, 1),
      filament_g: round(filamentG, 2),
      filament_length_mm: round((extrusionVolume / (Math.PI * (Number(filamentDiameterMm || 1.75) / 2) ** 2)), 1),
      layers,
      warnings: ['Stima geometrica di emergenza: attivare Kiri:Moto per preventivi produttivi.']
    };
  }
}
