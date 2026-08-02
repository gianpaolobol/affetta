import { AgentError } from './errors.js';
import { sha256Json } from './hash.js';
import { normalizeProfileStatus } from './capabilities.js';
import type { LocalAffettaClient } from './local-affetta-client.js';
import type {
  EngineId,
  JobRequestV1,
  JobResultV1,
  LocalJob,
  OutputArtifact,
  OutputFormat
} from './types.js';
import { nowIso } from './time.js';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeEngine(value: unknown): EngineId | null {
  const text = String(value || '').toLowerCase();
  if (text.includes('snapmaker')) return 'snapmaker_orca';
  if (text.includes('orca')) return 'orca';
  if (text.includes('cura')) return 'cura';
  if (text.includes('prusa')) return 'prusa';
  if (text.includes('kiri')) return 'kiri';
  if (text.includes('mock') || text.includes('demo')) return 'mock';
  return null;
}

export async function buildJobResult(options: {
  local: LocalAffettaClient;
  cloudJobId: string;
  request: JobRequestV1;
  localJob: LocalJob;
  artifact: OutputArtifact;
}): Promise<JobResultV1> {
  const { local, cloudJobId, request, localJob, artifact } = options;
  if (!localJob.result || localJob.result.demo_only || localJob.result.print_ready === false) {
    throw new AgentError('local_artifact_not_print_ready', 'Affetta locale non ha prodotto un artefatto stampabile.', {
      stage: 'validating',
      details: { demo_only: Boolean(localJob.result?.demo_only), print_ready: localJob.result?.print_ready ?? null }
    });
  }
  const [health, diagnostics] = await Promise.all([local.getHealth(), local.getDiagnostics()]);
  const diag = record(diagnostics);
  const engines = record(diag.engines);
  const slicing = record(diag.slicing);
  const printers = record(slicing.printers);
  const printerId = localJob.printer?.id || request.routing.printer_profile_id || 'auto-lab';
  const printerDiagnostic = record(printers[printerId]);
  const routes = Array.isArray(printerDiagnostic.routes) ? printerDiagnostic.routes : [];
  const routeEngine = routes
    .map((route) => record(route))
    .find((route) => route.available === true && route.resources_ready !== false)?.engine;
  const outputFormat: OutputFormat = localJob.result.output_format || localJob.output_format || artifact.format;
  const engineId = normalizeEngine(localJob.result.provider)
    || normalizeEngine(routeEngine)
    || request.routing.preferred_engine
    || (outputFormat === 'x3g' ? 'cura' : 'mock');
  const engineDiagnostic = record(engines[engineId]);
  const engineVersion = String(engineDiagnostic.version || health.version || 'unknown').slice(0, 128);
  const appliedProfile = localJob.result.applied_profile || {
    printer_id: printerId,
    print_intent: request.print_intent,
    routing: request.routing
  };
  const validation = localJob.result.validation || {};
  const warnings = [
    ...(validation.warnings || []),
    ...(validation.errors || []).map((message) => `Errore locale riportato: ${message}`)
  ];
  const result: JobResultV1 = {
    schema_version: 'affetta.result.v1',
    job_id: cloudJobId,
    request_id: request.request_id,
    idempotency_key: request.idempotency_key,
    status: 'completed',
    updated_at: nowIso(),
    result: {
      printer_profile_id: printerId,
      printer_profile_version: /^\d+\.\d+\.\d+/.test(health.version) ? health.version : '0.0.0',
      printer_profile_sha256: sha256Json(appliedProfile),
      profile_status: normalizeProfileStatus(localJob.result.profile_status || localJob.printer?.profile_status),
      ...((localJob.printer?.fleet_unit_id || request.routing.fleet_unit_id)
        ? { fleet_unit_id: localJob.printer?.fleet_unit_id || request.routing.fleet_unit_id }
        : {}),
      engine: { id: engineId, version: engineVersion },
      ...(outputFormat === 'x3g' ? {
        postprocessors: [{
          id: 'gpx' as const,
          version: String(record(engines.gpx).version || 'unknown').slice(0, 128)
        }]
      } : {}),
      output_format: outputFormat,
      time_seconds: Math.max(0, Math.round(Number(localJob.result.time_seconds || 0))),
      ...(
        Number.isFinite(localJob.result.filament_g) && Number.isFinite(localJob.result.filament_length_mm)
          ? { filament: {
              grams: Math.max(0, Number(localJob.result.filament_g)),
              millimeters: Math.max(0, Number(localJob.result.filament_length_mm))
            } }
          : {}
      ),
      validation: {
        valid: validation.valid !== false,
        warnings,
        observed: validation.observed || {}
      },
      artifacts: [artifact]
    }
  };
  return result;
}
