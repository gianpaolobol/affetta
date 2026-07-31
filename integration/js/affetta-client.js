/**
 * Client browser/server JavaScript minimale per Affetta API v1.
 * Non contiene logica dei motori: il contratto resta invariato quando il backend cambia provider.
 */
export class AffettaClient {
  constructor({ baseUrl, apiKey = '', fetchImpl = globalThis.fetch }) {
    if (!baseUrl) throw new TypeError('baseUrl è obbligatorio');
    if (typeof fetchImpl !== 'function') throw new TypeError('fetch non disponibile');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetch = fetchImpl;
  }

  async quoteFile(file, options = {}) {
    return this.#request('/api/v1/quotes', {
      method: 'POST',
      body: { ...await this.#filePayload(file), ...options }
    });
  }

  async createSliceJob(file, options) {
    return this.#request('/api/v1/slice-jobs', {
      method: 'POST',
      body: { ...await this.#filePayload(file), ...options }
    });
  }

  async createAffettaJob(file, options) {
    return this.#request('/api/v1/affetta-jobs', {
      method: 'POST',
      body: { ...await this.#filePayload(file), ...options }
    });
  }

  getQuote(quoteId) {
    return this.#request(`/api/v1/quotes/${encodeURIComponent(quoteId)}`);
  }

  getSliceJob(jobId) {
    return this.#request(`/api/v1/slice-jobs/${encodeURIComponent(jobId)}`, { retries: 3 });
  }

  async waitForSliceJob(jobId, { intervalMs = 1200, timeoutMs = 600000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await this.getSliceJob(jobId);
      if (response.job.status === 'completed') return response.job;
      if (response.job.status === 'failed') throw new Error(response.job.error?.message || 'Slicing fallito');
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error('Timeout del job Affetta');
  }

  async #filePayload(file) {
    const name = file.name || 'model.stl';
    const buffer = file instanceof ArrayBuffer ? file : await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return { filename: name, file_base64: btoa(binary) };
  }

  async #request(path, { method = 'GET', body, retries = 1 } = {}) {
    const headers = { Accept: 'application/json', 'X-Affetta-Client': 'js' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (body) headers['Content-Type'] = 'application/json';
    let lastError = null;
    for (let attempt = 1; attempt <= Math.max(1, retries); attempt++) {
      try {
        const response = await this.fetch(`${this.baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
        const data = await response.json();
        if (!response.ok || data.success === false) {
          throw Object.assign(new Error(data.error?.message || `Affetta HTTP ${response.status}`), {
            code: data.error?.code || 'http_error',
            status: response.status,
            stage: data.error?.stage || null,
            response: data,
            job: data.job || null
          });
        }
        return data;
      } catch (error) {
        lastError = error;
        if (error.status || attempt >= retries) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
      }
    }
    throw lastError;
  }
}
