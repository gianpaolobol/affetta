import fs from 'node:fs';
import path from 'node:path';
import { catalogs, config } from './config.js';
import { analyzeGcode } from './gcode.js';
import { validateGcode } from './gcode-validator.js';
import { jobStore } from './job-store.js';
import { analyzeStl, arrangeStlCopies } from './stl.js';
import { ensureDir, formatDuration, id, safeFilename, sha256 } from './utils.js';
import { CommandSlicerProvider, resolvePrinter } from './providers/command-slicer.js';
import { publicProfile, resolvePrintProfile } from './providers/profile-resolver.js';
import { appendDiagnostic, normalizeError } from './runtime-diagnostics.js';

function publicJob(job) {
  const { input_path, artifact_path, download_token, engine_internal, ...safe } = job;
  const publicPrinter = safe.printer ? {
    id: safe.printer.id,
    label: safe.printer.label,
    profile_status: safe.printer.profile_status
  } : null;
  const publicResult = safe.result ? {
    ...safe.result,
    ...(config.exposeEngineNames ? { provider: safe.result.provider_internal } : {}),
    provider_internal: undefined
  } : null;
  return {
    ...safe,
    api_version: config.apiVersion,
    printer: publicPrinter,
    result: publicResult,
    artifact_url: job.status === 'completed' ? `/api/v1/slice-jobs/${job.id}/artifact?token=${download_token}` : null
  };
}

function demoGcode({ filename, printer, options }) {
  return `; AFFETTA DEMO G-CODE — NON STAMPARE\n; File: ${filename}\n; Printer: ${printer.label}\n; Material: ${options.material_id}\n; Questo artefatto verifica soltanto il flusso applicativo.\nG90\nM82\nM84\n`;
}

function updateJobSafely(jobId, patch, diagnosticEvent) {
  try {
    return jobStore.update(jobId, patch);
  } catch (error) {
    appendDiagnostic(diagnosticEvent, { job_id: jobId, patch_status: patch.status || null, error: normalizeError(error) });
    return null;
  }
}

export function createSliceJob({ tenant, modelBuffer, filename, options }) {
  const printer = resolvePrinter(options.printer_id);
  if (!printer) throw Object.assign(new Error('Profilo stampante non trovato.'), { statusCode: 400, code: 'invalid_printer' });
  const arranged = arrangeStlCopies(modelBuffer, options.quantity, printer.build_mm);
  const analysis = arranged.analysis;
  if (analysis.bounds_mm.size.some((v, i) => v > printer.build_mm[i] + 0.01)) {
    throw Object.assign(new Error('Il modello o la disposizione delle copie supera il volume della stampante selezionata.'), { statusCode: 422, code: 'model_too_large' });
  }
  ensureDir(config.uploadDir);
  ensureDir(config.artifactDir);
  const jobId = id('slice');
  const inputPath = path.join(config.uploadDir, `${jobId}-${safeFilename(filename)}`);
  const outputPath = path.join(config.artifactDir, `${jobId}.gcode`);
  fs.writeFileSync(inputPath, arranged.buffer);
  const now = new Date().toISOString();
  const job = jobStore.create({
    id: jobId,
    tenant,
    source: options.source,
    external_ref: options.external_ref,
    metadata: options.metadata,
    status: 'queued',
    phase: 'queued',
    progress: 0,
    message: 'In coda',
    created_at: now,
    updated_at: now,
    filename,
    model_sha256: sha256(modelBuffer),
    model_analysis: analysis,
    layout: arranged.layout,
    selections: options,
    printer: { id: options.printer_id, label: printer.label, profile_status: printer.status },
    engine_internal: printer.engines[0],
    input_path: inputPath,
    artifact_path: outputPath,
    download_token: id('dl'),
    result: null,
    error: null
  });

  appendDiagnostic('slice_job_created', {
    job_id: jobId,
    printer_id: options.printer_id,
    engine_candidates: printer.engines,
    input_bytes: arranged.buffer.length,
    memory: process.memoryUsage()
  });

  setImmediate(() => {
    processSliceJob(jobId).catch((error) => {
      appendDiagnostic('slice_job_scheduler_rejection', { job_id: jobId, error: normalizeError(error) }, { file: 'process-crash.jsonl' });
      updateJobSafely(jobId, {
        status: 'failed',
        phase: 'failed',
        progress: 100,
        message: 'Slicing non riuscito',
        error: { code: error.code || 'slice_scheduler_failed', message: error.message || String(error), stage: 'scheduler' }
      }, 'slice_job_scheduler_store_failure');
    });
  });
  return publicJob(job);
}

async function processSliceJob(jobId) {
  let job = null;
  let stage = 'load_job';
  const startedAt = Date.now();
  try {
    job = jobStore.get(jobId);
    if (!job) throw Object.assign(new Error(`Job ${jobId} non trovato nello store.`), { code: 'job_missing' });

    stage = 'resolve_catalogs';
    const options = job.selections;
    const printer = resolvePrinter(options.printer_id);
    const material = catalogs.materials[options.material_id];
    const quality = catalogs.qualities[options.quality_id];
    const strength = catalogs.strengths[options.strength_id];
    if (!printer || !material || !quality || !strength) {
      throw Object.assign(new Error('Cataloghi o profilo di stampa non risolvibili per il job.'), { code: 'job_profile_invalid' });
    }

    stage = 'mark_running';
    jobStore.update(jobId, { status: 'running', phase: 'profile', progress: 10, message: 'Preparazione del profilo di stampa' });
    appendDiagnostic('slice_job_started', {
      job_id: jobId,
      printer_id: options.printer_id,
      engine_candidates: printer.engines,
      memory: process.memoryUsage()
    });

    let provider = printer.engines[0];
    let appliedProfile = resolvePrintProfile({
      printerId: options.printer_id,
      nozzleMm: options.nozzle_mm,
      materialId: options.material_id,
      qualityId: options.quality_id,
      strengthId: options.strength_id
    });
    let engineAttempts = [];
    let isDemo = false;

    stage = 'slice_engine';
    jobStore.update(jobId, { phase: 'slice_engine', progress: 20, message: 'Slicing con il motore selezionato' });
    try {
      const slicer = new CommandSlicerProvider();
      const sliced = await slicer.slice({
        inputPath: job.input_path,
        outputPath: job.artifact_path,
        printer,
        options,
        diagnosticContext: { job_id: jobId, stage: 'slice_engine', input_path: job.input_path, output_path: job.artifact_path }
      });
      provider = sliced.provider;
      appliedProfile = sliced.profile;
      engineAttempts = sliced.attempts || [];
    } catch (engineError) {
      if (!config.allowDemoGcode) throw engineError;
      fs.writeFileSync(job.artifact_path, demoGcode({ filename: job.filename, printer, options }));
      provider = 'demo-flow';
      engineAttempts = engineError.attempts || [];
      isDemo = true;
    }

    stage = 'read_artifact';
    jobStore.update(jobId, { phase: 'validate_gcode', progress: 82, message: 'Controllo di sicurezza del G-code' });
    const artifactStat = fs.statSync(job.artifact_path);
    const text = fs.readFileSync(job.artifact_path, 'utf8');

    stage = 'validate_gcode';
    const stats = analyzeGcode(text, { densityGcm3: material.density_g_cm3 });
    const validation = isDemo
      ? { valid: false, errors: ['Artefatto dimostrativo non stampabile.'], warnings: [], observed: {} }
      : validateGcode(text, { buildMm: printer.build_mm, material, motionBoundsMm: printer.validation?.motion_bounds_mm });
    if (!validation.valid && !isDemo) {
      throw Object.assign(new Error(`Validazione G-code fallita: ${validation.errors.join(' ')}`), { code: 'gcode_validation_failed' });
    }

    const result = {
      provider_internal: provider,
      demo_only: isDemo,
      print_ready: !isDemo && validation.valid,
      time_seconds: stats.time_seconds,
      time_human: formatDuration(stats.time_seconds),
      filament_g: stats.filament_g,
      filament_length_mm: stats.filament_length_mm,
      validation,
      profile_status: printer.status,
      applied_profile: publicProfile(appliedProfile),
      engine_fallbacks_used: engineAttempts.length,
      warning: appliedProfile.warnings.length ? appliedProfile.warnings.join(' ') : null
    };

    stage = 'mark_completed';
    jobStore.update(jobId, { status: 'completed', phase: 'completed', progress: 100, message: isDemo ? 'Flusso dimostrativo completato' : 'G-code pronto', result });
    appendDiagnostic('slice_job_completed', {
      job_id: jobId,
      printer_id: options.printer_id,
      provider,
      artifact_path: job.artifact_path,
      artifact_bytes: artifactStat.size,
      duration_ms: Date.now() - startedAt,
      memory: process.memoryUsage()
    });
  } catch (error) {
    appendDiagnostic('slice_job_failed', {
      job_id: jobId,
      stage,
      duration_ms: Date.now() - startedAt,
      error: normalizeError(error),
      memory: process.memoryUsage()
    });
    updateJobSafely(jobId, {
      status: 'failed',
      phase: 'failed',
      progress: 100,
      message: 'Slicing non riuscito',
      error: { code: error.code || 'slice_failed', message: error.message || String(error), stage }
    }, 'slice_job_failure_store_error');
  } finally {
    if (job?.input_path) {
      try {
        fs.rmSync(job.input_path, { force: true });
      } catch (error) {
        appendDiagnostic('slice_job_input_cleanup_failed', { job_id: jobId, input_path: job.input_path, error: normalizeError(error) });
      }
    }
  }
}

export function getSliceJob(idValue, tenant = null) {
  const job = jobStore.get(idValue);
  if (!job || (tenant && tenant !== 'admin' && job.tenant !== tenant)) return null;
  return publicJob(job);
}

export function getArtifact(idValue, token) {
  const job = jobStore.get(idValue);
  if (!job || job.status !== 'completed' || token !== job.download_token) return null;
  const expired = Date.now() - new Date(job.updated_at).getTime() > config.artifactTtlHours * 3600_000;
  if (expired) return null;
  return { path: job.artifact_path, filename: `${path.parse(job.filename).name}-${job.printer.id}.gcode`, demo: Boolean(job.result?.demo_only) };
}
