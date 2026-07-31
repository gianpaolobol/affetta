import { config } from '../config.js';
import { GeometryEstimateProvider } from './geometry-estimate.js';
import { KiriEstimateProvider } from './kiri-estimate.js';

export class EstimateRouter {
  constructor() {
    this.kiri = new KiriEstimateProvider();
    this.fallback = new GeometryEstimateProvider();
  }

  async estimate(input) {
    if (this.kiri.isConfigured()) {
      try { return await this.kiri.estimate(input); }
      catch (error) {
        if (config.requireKiri || !config.allowGeometryFallback) throw Object.assign(error, { code: 'kiri_failed', statusCode: 503 });
        const fallback = await this.fallback.estimate(input);
        fallback.warnings.unshift('Stima di slicing non disponibile: è stata utilizzata una stima geometrica prudenziale.');
        return fallback;
      }
    }
    if (config.requireKiri || !config.allowGeometryFallback) {
      throw Object.assign(new Error('Kiri:Moto è richiesto ma non configurato.'), { code: 'kiri_not_configured', statusCode: 503 });
    }
    return this.fallback.estimate(input);
  }
}
