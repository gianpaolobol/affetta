import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AgentConfig } from './config.js';
import { assertArtifactUrl } from './config.js';
import { AgentError } from './errors.js';

export interface JsonRequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  expected?: number[];
  stage?: string;
}

export async function requestJson<T>(url: string, options: JsonRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const request: RequestInit = {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers
      },
      signal: controller.signal,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
    };
    const response = await fetch(url, request);
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); }
      catch {
        throw new AgentError('invalid_json_response', 'Risposta JSON non valida.', {
          stage: options.stage ?? 'http',
          retryable: response.status >= 500,
          statusCode: response.status,
          details: { url: new URL(url).pathname, preview: text.slice(0, 300) }
        });
      }
    }
    const expected = options.expected ?? [];
    if (!response.ok && !expected.includes(response.status)) {
      const errorBody = parsed as { error?: { code?: string; message?: string } } | null;
      throw new AgentError(
        errorBody?.error?.code || `http_${response.status}`,
        errorBody?.error?.message || `Richiesta HTTP fallita con stato ${response.status}.`,
        {
          stage: options.stage ?? 'http',
          retryable: response.status === 408 || response.status === 429 || response.status >= 500,
          statusCode: response.status,
          details: { url: new URL(url).pathname }
        }
      );
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof AgentError) throw error;
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new AgentError('http_timeout', 'Timeout della richiesta HTTP.', {
        stage: options.stage ?? 'http', retryable: true, cause: error
      });
    }
    throw new AgentError('http_network_error', 'Errore di rete.', {
      stage: options.stage ?? 'http', retryable: true, cause: error
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function downloadSignedFile(config: AgentConfig, rawUrl: string, destination: string, options: {
  headers?: Record<string, string>;
  expectedSha256: string;
  expectedSizeBytes: number;
}): Promise<{ sha256: string; size_bytes: number }> {
  const url = assertArtifactUrl(config, rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
  const temp = `${destination}.part`;
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.rmSync(temp, { force: true });
  const handle = await fs.promises.open(temp, 'w', 0o600);
  const hash = createHash('sha256');
  let size = 0;
  let handleClosed = false;
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      ...(options.headers ? { headers: options.headers } : {})
    });
    if (!response.ok || !response.body) {
      throw new AgentError(`artifact_download_http_${response.status}`, 'Download artefatto non riuscito.', {
        stage: 'downloading', retryable: response.status === 429 || response.status >= 500, statusCode: response.status
      });
    }
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > config.maxDownloadBytes) {
        throw new AgentError('artifact_too_large', 'Artefatto oltre il limite configurato.', {
          stage: 'downloading', details: { max_bytes: config.maxDownloadBytes }
        });
      }
      hash.update(buffer);
      await handle.write(buffer);
    }
  } catch (error) {
    await handle.close();
    handleClosed = true;
    fs.rmSync(temp, { force: true });
    if (error instanceof AgentError) throw error;
    throw new AgentError('artifact_download_failed', 'Download artefatto interrotto.', {
      stage: 'downloading', retryable: true, cause: error
    });
  } finally {
    clearTimeout(timer);
    if (!handleClosed) await handle.close();
  }
  const sha256 = hash.digest('hex');
  if (size !== options.expectedSizeBytes || sha256 !== options.expectedSha256) {
    fs.rmSync(temp, { force: true });
    throw new AgentError('artifact_checksum_mismatch', 'Checksum o dimensione del modello non corrispondono.', {
      stage: 'downloading',
      details: {
        expected_sha256: options.expectedSha256,
        observed_sha256: sha256,
        expected_size_bytes: options.expectedSizeBytes,
        observed_size_bytes: size
      }
    });
  }
  fs.renameSync(temp, destination);
  return { sha256, size_bytes: size };
}

export async function uploadSignedFile(config: AgentConfig, rawUrl: string, source: string, headers: Record<string, string> = {}): Promise<void> {
  const url = assertArtifactUrl(config, rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(config.httpTimeoutMs, 120000));
  try {
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: fs.createReadStream(source) as unknown as BodyInit,
      duplex: 'half',
      signal: controller.signal
    } as RequestInit & { duplex: 'half' });
    if (!response.ok) {
      throw new AgentError(`artifact_upload_http_${response.status}`, 'Upload artefatto non riuscito.', {
        stage: 'uploading', retryable: response.status === 429 || response.status >= 500, statusCode: response.status
      });
    }
  } catch (error) {
    if (error instanceof AgentError) throw error;
    throw new AgentError('artifact_upload_failed', 'Upload artefatto interrotto.', {
      stage: 'uploading', retryable: true, cause: error
    });
  } finally {
    clearTimeout(timer);
  }
}
