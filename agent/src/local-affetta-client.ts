import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentConfig } from './config.js';
import { AgentError } from './errors.js';
import { requestJson } from './http.js';
import type { JobRequestV1, LocalHealth, LocalJob } from './types.js';

export interface LocalCatalogResponse {
  success: boolean;
  printers: Record<string, {
    label?: string;
    nozzles?: number[];
    default_nozzle?: number;
    materials?: string[];
    status?: string;
  }>;
}

export interface LocalFleetResponse {
  success: boolean;
  fleet: {
    id?: string;
    units?: Array<{
      id: string;
      printer_id: string;
      production_ready?: boolean;
      calibration_status?: string;
      material_ids?: string[];
    }>;
  };
}

export class LocalAffettaClient {
  constructor(private readonly config: AgentConfig) {}

  private url(pathname: string): string { return `${this.config.localBaseUrl}${pathname}`; }
  private headers(): Record<string, string> {
    return this.config.localApiKey ? { Authorization: `Bearer ${this.config.localApiKey}` } : {};
  }

  getHealth(): Promise<LocalHealth> {
    return requestJson(this.url('/api/v1/health'), {
      headers: this.headers(), timeoutMs: this.config.httpTimeoutMs, stage: 'local_health'
    });
  }

  getCatalog(): Promise<LocalCatalogResponse> {
    return requestJson(this.url('/api/v1/catalog'), {
      headers: this.headers(), timeoutMs: this.config.httpTimeoutMs, stage: 'local_capabilities'
    });
  }

  getFleet(): Promise<LocalFleetResponse> {
    return requestJson(this.url('/api/v1/fleet'), {
      headers: this.headers(), timeoutMs: this.config.httpTimeoutMs, stage: 'local_capabilities'
    });
  }

  async getDiagnostics(): Promise<Record<string, unknown>> {
    return requestJson(this.url('/api/v1/capabilities'), {
      headers: this.headers(), timeoutMs: Math.max(this.config.httpTimeoutMs, 60000), stage: 'local_capabilities'
    });
  }

  async createJob(request: JobRequestV1, inputPath: string): Promise<LocalJob> {
    if (request.input.format !== 'stl') {
      throw new AgentError('local_input_format_unsupported', 'Affetta 0.5.2 accetta solo STL nel payload Base64.', {
        stage: 'preparing', details: { format: request.input.format }
      });
    }
    if (request.print_intent.quantity > 999) {
      throw new AgentError('local_quantity_unsupported', 'Affetta 0.5.2 supporta al massimo 999 copie per job.', {
        stage: 'preparing', details: { quantity: request.print_intent.quantity, maximum: 999 }
      });
    }
    const printerId = await this.resolvePrinterId(request);
    const file = fs.readFileSync(inputPath);
    const response = await requestJson<{ success: boolean; job: LocalJob }>(this.url('/api/v1/slice-jobs'), {
      method: 'POST',
      headers: this.headers(),
      timeoutMs: Math.max(this.config.httpTimeoutMs, 120000),
      stage: 'preparing',
      body: {
        filename: path.basename(request.input.filename),
        file_base64: file.toString('base64'),
        material_id: request.print_intent.material_id,
        quality_id: request.print_intent.quality_id,
        strength_id: request.print_intent.strength_id,
        color_id: request.print_intent.color_id,
        quantity: request.print_intent.quantity,
        nozzle_mm: request.print_intent.nozzle_mm,
        printer_id: printerId,
        source: 'affetta-agent',
        external_ref: request.request_id,
        metadata: {
          idempotency_key: request.idempotency_key,
          cloud_source: request.source,
          require_production_ready: String(request.routing.require_production_ready)
        }
      }
    });
    return response.job;
  }

  private async resolvePrinterId(request: JobRequestV1): Promise<string> {
    if (request.routing.mode === 'automatic') {
      if (request.routing.printer_profile_id || request.routing.fleet_unit_id) {
        throw new AgentError('automatic_routing_has_manual_target', 'Il routing automatico non può contenere una destinazione manuale.', {
          stage: 'preparing'
        });
      }
      return 'auto-lab';
    }

    const fleet = await this.getFleet();
    const units = fleet.fleet?.units ?? [];
    const selectedUnit = request.routing.fleet_unit_id
      ? units.find((unit) => unit.id === request.routing.fleet_unit_id)
      : undefined;
    if (request.routing.fleet_unit_id && !selectedUnit) {
      throw new AgentError('fleet_unit_unavailable', 'L’unità richiesta non è disponibile nel parco macchine locale.', {
        stage: 'preparing', details: { fleet_unit_id: request.routing.fleet_unit_id }
      });
    }
    const printerId = request.routing.printer_profile_id || selectedUnit?.printer_id;
    if (!printerId) {
      throw new AgentError('local_api_requires_printer_target', 'Il routing manuale richiede printer_profile_id o una fleet_unit_id risolvibile.', {
        stage: 'preparing'
      });
    }
    if (selectedUnit && selectedUnit.printer_id !== printerId) {
      throw new AgentError('fleet_profile_mismatch', 'L’unità richiesta non usa il profilo stampante indicato.', {
        stage: 'preparing',
        details: { fleet_unit_id: selectedUnit.id, observed_printer_profile_id: selectedUnit.printer_id, requested_printer_profile_id: printerId }
      });
    }
    if (selectedUnit?.material_ids?.length && !selectedUnit.material_ids.includes(request.print_intent.material_id)) {
      throw new AgentError('fleet_material_mismatch', 'Il materiale richiesto non è assegnato all’unità selezionata.', {
        stage: 'preparing', details: { fleet_unit_id: selectedUnit.id, material_id: request.print_intent.material_id }
      });
    }
    if (request.routing.require_production_ready) {
      const eligible = selectedUnit
        ? selectedUnit.production_ready === true
        : units.some((unit) => unit.printer_id === printerId && unit.production_ready === true);
      if (!eligible) {
        throw new AgentError('fleet_unit_not_production_ready', 'Il routing richiede una unità collaudata e pronta per la produzione.', {
          stage: 'preparing',
          details: { fleet_unit_id: selectedUnit?.id ?? null, printer_profile_id: printerId }
        });
      }
    }
    return printerId;
  }

  async getJob(localJobId: string): Promise<LocalJob> {
    const response = await requestJson<{ success: boolean; job: LocalJob }>(
      this.url(`/api/v1/slice-jobs/${encodeURIComponent(localJobId)}`),
      {
        headers: this.headers(), timeoutMs: this.config.httpTimeoutMs,
        expected: [422], stage: 'slicing'
      }
    );
    return response.job;
  }

  async downloadArtifact(localJob: LocalJob, destination: string): Promise<{ sha256: string; size_bytes: number }> {
    if (!localJob.artifact_url) {
      throw new AgentError('local_artifact_missing', 'Affetta locale non ha fornito artifact_url.', { stage: 'uploading' });
    }
    const url = new URL(localJob.artifact_url, `${this.config.localBaseUrl}/`);
    const expectedOrigin = new URL(this.config.localBaseUrl).origin;
    if (url.origin !== expectedOrigin) {
      throw new AgentError('local_artifact_origin_mismatch', 'artifact_url locale punta fuori da Affetta.', { stage: 'uploading' });
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(this.config.httpTimeoutMs, 120000));
    const temp = `${destination}.part`;
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.rmSync(temp, { force: true });
    const handle = await fs.promises.open(temp, 'w', 0o600);
    const hash = createHash('sha256');
    let size = 0;
    let handleClosed = false;
    try {
      const response = await fetch(url, { headers: this.headers(), signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new AgentError(`local_artifact_http_${response.status}`, 'Download artefatto locale non riuscito.', {
          stage: 'uploading', retryable: response.status >= 500
        });
      }
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk);
        size += buffer.length;
        if (size > this.config.maxDownloadBytes) {
          throw new AgentError('local_artifact_too_large', 'Artefatto locale oltre il limite configurato.', { stage: 'uploading' });
        }
        hash.update(buffer);
        await handle.write(buffer);
      }
    } catch (error) {
      await handle.close();
      handleClosed = true;
      fs.rmSync(temp, { force: true });
      if (error instanceof AgentError) throw error;
      throw new AgentError('local_artifact_download_failed', 'Download dell’artefatto locale interrotto.', {
        stage: 'uploading', retryable: true, cause: error
      });
    } finally {
      clearTimeout(timer);
      if (!handleClosed) await handle.close();
    }
    fs.renameSync(temp, destination);
    return { sha256: hash.digest('hex'), size_bytes: size };
  }
}
