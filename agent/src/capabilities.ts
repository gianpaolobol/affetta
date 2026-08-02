import fs from 'node:fs';
import os from 'node:os';
import type { AgentConfig } from './config.js';
import type { AgentDatabase } from './db.js';
import { sha256Buffer, sha256Json } from './hash.js';
import type { LocalAffettaClient, LocalCatalogResponse, LocalFleetResponse } from './local-affetta-client.js';
import type { AgentCapabilitiesV1, EngineId, OutputFormat, ProfileStatus } from './types.js';
import { nowIso } from './time.js';

function normalizeSemver(value: unknown): string {
  const text = String(value || '0.0.0');
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(text) ? text : '0.0.0';
}

export function normalizeProfileStatus(value: unknown): ProfileStatus {
  const text = String(value || '').toLowerCase();
  if (text === 'validated') return 'validated';
  if (text === 'verified' || text.includes('verified') || text.includes('vendor-profile')) return 'verified';
  if (text === 'deprecated') return 'deprecated';
  if (text === 'draft') return 'draft';
  return 'experimental';
}

function platformName(): 'windows' | 'linux' | 'macos' {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

function platformArch(): 'x64' | 'arm64' {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

function diskFreeBytes(directory: string): number {
  try {
    const stat = fs.statfsSync(directory);
    return Math.max(0, Number(stat.bavail) * Number(stat.bsize));
  } catch {
    return 0;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function collectCapabilities(
  config: AgentConfig,
  db: AgentDatabase,
  local: LocalAffettaClient,
  agentId: string
): Promise<AgentCapabilitiesV1> {
  const [health, catalog, fleet, diagnostics] = await Promise.all([
    local.getHealth(), local.getCatalog(), local.getFleet(), local.getDiagnostics()
  ]);
  const diag = objectValue(diagnostics);
  const slicing = objectValue(diag.slicing);
  const printerDiagnostics = objectValue(slicing.printers);
  const engineDiagnostics = objectValue(diag.engines);
  const engineIds: EngineId[] = ['kiri', 'cura', 'prusa', 'orca', 'snapmaker_orca'];
  const engines = engineIds.map((id) => {
    const item = objectValue(engineDiagnostics[id]);
    const result: { id: EngineId; available: boolean; version?: string; diagnostic?: string } = {
      id,
      available: Boolean(item.available)
    };
    if (item.version) result.version = String(item.version).slice(0, 128);
    if (item.detail) result.diagnostic = String(item.detail).slice(0, 1000);
    return result;
  });
  const gpxDiagnostic = objectValue(engineDiagnostics.gpx);
  const postprocessors = [{
    id: 'gpx' as const,
    available: Boolean(gpxDiagnostic.available),
    ...(gpxDiagnostic.version ? { version: String(gpxDiagnostic.version).slice(0, 128) } : {}),
    ...(gpxDiagnostic.detail ? { diagnostic: String(gpxDiagnostic.detail).slice(0, 1000) } : {})
  }];

  const unitsByPrinter = new Map<string, NonNullable<LocalFleetResponse['fleet']['units']>>();
  for (const unit of fleet.fleet?.units ?? []) {
    const list = unitsByPrinter.get(unit.printer_id) ?? [];
    list.push(unit);
    unitsByPrinter.set(unit.printer_id, list);
  }

  const version = normalizeSemver(health.version);
  const printerProfiles = Object.entries(catalog.printers ?? {}).map(([profileId, printer]) => {
    const item = objectValue(printerDiagnostics[profileId]);
    const units = unitsByPrinter.get(profileId) ?? [];
    const productionReady = units.some((unit) => unit.production_ready === true);
    const outputFormat: OutputFormat = item.output_format === 'x3g' ? 'x3g' : 'gcode';
    const profileSource = {
      profile_id: profileId,
      version,
      catalog: printer,
      diagnostics: item,
      fleet_units: units.map((unit) => ({
        id: unit.id,
        production_ready: unit.production_ready === true,
        calibration_status: unit.calibration_status ?? 'unknown'
      }))
    };
    return {
      profile_id: profileId,
      profile_version: version,
      profile_sha256: sha256Json(profileSource),
      profile_status: normalizeProfileStatus(printer.status ?? item.profile_status),
      output_format: outputFormat,
      materials: [...new Set((printer.materials ?? ['pla']).map(String))].sort(),
      nozzles_mm: [...new Set((printer.nozzles ?? [printer.default_nozzle ?? 0.4]).map(Number))].sort((a, b) => a - b),
      production_ready: productionReady,
      physical_validation: units.length === 0 ? 'not_required' as const : productionReady ? 'passed' as const : 'pending' as const
    };
  });
  const outputFormats = [...new Set(printerProfiles.map((profile) => profile.output_format))].sort() as OutputFormat[];
  if (outputFormats.length === 0) outputFormats.push('gcode');

  const withoutHash = {
    schema_version: 'affetta.agent-capabilities.v1' as const,
    agent_id: agentId,
    observed_at: nowIso(),
    status: printerProfiles.some((profile) => profile.production_ready) ? 'online' as const : 'degraded' as const,
    affetta_version: version,
    protocol_versions: ['affetta.job.v1', 'affetta.result.v1', 'affetta.event.v1'] as const,
    active_jobs: db.activeJobCount(),
    disk_free_bytes: diskFreeBytes(config.dataDir),
    platform: {
      os: platformName(),
      arch: platformArch(),
      node_version: process.version,
      hostname_hash: sha256Buffer(os.hostname().toLowerCase())
    },
    engines,
    postprocessors,
    output_formats: outputFormats,
    printer_profiles: printerProfiles,
    extensions: {
      'affetta.agent.sqlite-driver': db.driver,
      'affetta.agent.local-instance-id': health.instance_id || null
    }
  };
  return { ...withoutHash, capability_sha256: sha256Json(withoutHash) };
}
