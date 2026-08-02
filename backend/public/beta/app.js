const $ = (selector) => document.querySelector(selector);
const state = {
  token: sessionStorage.getItem('affetta_beta_token') || '',
  file: null,
  limits: null,
  currentJobId: null,
  pollTimer: null
};

function notice(message, error = false) {
  const node = $('#notice');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.classList.remove('hidden');
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => node.classList.add('hidden'), 6000);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `Errore HTTP ${response.status}`);
    error.code = payload?.error?.code;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function formObject(form) { return Object.fromEntries(new FormData(form)); }
function bytesLabel(value) { return value < 1e6 ? `${Math.round(value / 1000)} kB` : `${(value / 1e6).toFixed(2)} MB`; }
function statusLabel(value) {
  return ({ queued: 'In coda', leased: 'Assegnato', assigned: 'Avviato', downloading: 'Download', preparing: 'Preparazione', slicing: 'Slicing', validating: 'Validazione', postprocessing: 'Post-processo', uploading: 'Upload risultato', completed: 'Completato', retrying: 'Nuovo tentativo', failed: 'Fallito', cancelled: 'Cancellato', cancel_requested: 'Cancellazione richiesta', expired: 'Scaduto' })[value] || value;
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function costForm(profile) {
  const form = $('#profile-form');
  form.display_name.value = profile.display_name;
  for (const [key, value] of Object.entries(profile.cost_profile)) if (form[key]) form[key].value = value;
}

function renderUsage(usage) {
  if (!usage || !state.limits) return;
  $('#usage-badge').textContent = `${usage.jobs_used}/${state.limits.daily_jobs} JOB`;
}

function showAccount(payload) {
  const account = payload.account;
  $('#auth').classList.add('hidden');
  $('#workspace').classList.remove('hidden');
  $('#logout').classList.remove('hidden');
  $('#welcome').textContent = `Ciao, ${account.profile.display_name}`;
  costForm(account.profile);
  renderUsage(payload.usage);
  renderAgents(payload.agents || []);
}

async function refreshMe() {
  if (!state.token) return;
  try {
    const payload = await api('/v1/beta/me');
    showAccount(payload);
    await refreshJobs();
  } catch {
    state.token = '';
    sessionStorage.removeItem('affetta_beta_token');
  }
}

function renderAgents(agents) {
  const node = $('#agent-list');
  if (!agents.length) {
    node.innerHTML = '<p class="note">Nessun Agent associato. Genera un codice per collegarlo.</p>';
    $('#pair-agent').disabled = false;
    return;
  }
  node.innerHTML = agents.map((agent) => `
    <div class="agent-row">
      <div><strong>${escapeHtml(agent.name)}</strong><span>${escapeHtml(agent.status)} · ${agent.production_profiles || 0} profili pronti</span></div>
      ${agent.revoked_at ? '' : `<button class="tiny danger" data-revoke-agent="${escapeHtml(agent.id)}" type="button">Revoca</button>`}
    </div>`).join('');
  $('#pair-agent').disabled = agents.some((agent) => !agent.revoked_at && agent.status !== 'revoked');
}

async function refreshAgents() {
  const result = await api('/v1/beta/agents');
  renderAgents(result.agents || []);
}

function renderJob(job) {
  const progress = Math.max(0, Math.min(100, Number(job.progress_percent || 0)));
  const result = job.result;
  return `
    <article class="job-card" data-job-id="${escapeHtml(job.id)}">
      <div class="job-head"><div><strong>${escapeHtml(job.input.filename)}</strong><span>${new Date(job.created_at).toLocaleString()}</span></div><span class="status ${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span></div>
      <div class="progress"><i style="width:${progress}%"></i></div>
      <p>${escapeHtml(job.message)} · ${progress}%</p>
      ${result ? `<div class="result-meta"><span>${Math.round(result.time_seconds / 60)} min</span><span>${result.filament?.grams ?? '—'} g</span><span>${escapeHtml(result.output_format).toUpperCase()}</span></div>` : ''}
      ${job.error ? `<p class="job-error">${escapeHtml(job.error.message)}</p>` : ''}
      <div class="job-actions">
        ${job.download_ready ? `<button class="tiny" data-download-job="${escapeHtml(job.id)}" type="button">Scarica G-code</button>` : ''}
        ${!job.terminal ? `<button class="tiny ghost" data-cancel-job="${escapeHtml(job.id)}" type="button">Annulla</button>` : ''}
      </div>
    </article>`;
}

async function refreshJobs() {
  if (!state.token) return;
  const result = await api('/v1/beta/jobs');
  const jobs = result.jobs || [];
  $('#jobs').innerHTML = jobs.length ? jobs.map(renderJob).join('') : '<p class="note">Nessun job.</p>';
  if (state.currentJobId) {
    const current = jobs.find((job) => job.id === state.currentJobId);
    if (current) renderActiveJob(current);
  }
}

function renderActiveJob(job) {
  const node = $('#active-job');
  node.classList.remove('hidden');
  node.innerHTML = `<strong>${escapeHtml(statusLabel(job.status))}</strong><span>${escapeHtml(job.message)} · ${job.progress_percent || 0}%</span>`;
  $('#upload-step').textContent = statusLabel(job.status);
  if (job.terminal) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
    $('#submit-job').disabled = !state.file;
    if (job.status === 'completed') notice('G-code generato e verificato.');
    else notice(job.error?.message || `Job ${statusLabel(job.status).toLowerCase()}.`, true);
  }
}

function watchJob(jobId) {
  state.currentJobId = jobId;
  clearInterval(state.pollTimer);
  const poll = async () => {
    try {
      const result = await api(`/v1/beta/jobs/${encodeURIComponent(jobId)}`);
      renderActiveJob(result.job);
      await refreshJobs();
    } catch (error) { notice(error.message, true); }
  };
  poll();
  state.pollTimer = setInterval(poll, 1800);
}

async function sha256File(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function submitJob() {
  const file = state.file;
  if (!file) return notice('Seleziona prima un modello.', true);
  if (state.limits && file.size > state.limits.max_input_bytes) return notice(`Il file supera ${bytesLabel(state.limits.max_input_bytes)}.`, true);
  const extension = file.name.split('.').pop().toLowerCase();
  const button = $('#submit-job');
  button.disabled = true;
  try {
    $('#upload-step').textContent = 'Checksum';
    const hash = await sha256File(file);
    $('#upload-step').textContent = 'Upload';
    const prepared = await api('/v1/beta/artifacts/prepare-upload', { method: 'POST', body: {
      filename: file.name, format: extension, sha256: hash, size_bytes: file.size
    }});
    const uploadResponse = await fetch(prepared.upload.url, {
      method: prepared.upload.method || 'PUT',
      headers: prepared.upload.headers || { 'content-type': file.type || 'application/octet-stream' },
      body: file
    });
    if (!uploadResponse.ok) throw new Error(`Upload storage non riuscito: HTTP ${uploadResponse.status}`);
    $('#upload-step').textContent = 'Verifica';
    await api(`/v1/beta/artifacts/${encodeURIComponent(prepared.artifact.id)}/upload-complete`, {
      method: 'POST', body: { sha256: hash, size_bytes: file.size }
    });
    $('#upload-step').textContent = 'Coda';
    const idempotencyKey = `beta-${crypto.randomUUID()}`;
    const created = await api('/v1/beta/jobs', { method: 'POST', body: {
      artifact_id: prepared.artifact.id,
      idempotency_key: idempotencyKey,
      material_id: $('#material').value,
      quality_id: $('#quality').value,
      strength_id: $('#strength').value,
      color_id: $('#color').value,
      nozzle_mm: Number($('#nozzle').value),
      quantity: Number($('#quantity').value)
    }});
    renderUsage(created.usage);
    notice('Modello verificato e job inserito in coda.');
    watchJob(created.job.id);
  } catch (error) {
    $('#upload-step').textContent = 'Errore';
    notice(error.message, true);
    button.disabled = false;
  }
}

async function downloadJob(jobId) {
  try {
    const result = await api(`/v1/beta/jobs/${encodeURIComponent(jobId)}/download`);
    const anchor = document.createElement('a');
    anchor.href = result.download.url;
    anchor.download = result.filename;
    anchor.rel = 'noopener';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) { notice(error.message, true); }
}

$('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = formObject(event.currentTarget);
  data.terms_accepted = event.currentTarget.terms_accepted.checked;
  try {
    const result = await api('/v1/beta/register', { method: 'POST', body: data });
    if (result.dev_verification_token) $('#verify-form').token.value = result.dev_verification_token;
    notice('Account creato. Verifica l’email prima di accedere.');
  } catch (error) { notice(error.message, true); }
});

$('#verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/v1/beta/verify-email', { method: 'POST', body: formObject(event.currentTarget) });
    notice('Email verificata. Ora puoi accedere.');
  } catch (error) { notice(error.message, true); }
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/v1/beta/login', { method: 'POST', body: formObject(event.currentTarget) });
    state.token = result.access_token;
    sessionStorage.setItem('affetta_beta_token', state.token);
    showAccount(result);
    await Promise.all([refreshMe(), refreshAgents(), refreshJobs()]);
    notice('Accesso effettuato.');
  } catch (error) { notice(error.message, true); }
});

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const raw = formObject(event.currentTarget);
  const body = { display_name: raw.display_name, cost_profile: {} };
  for (const key of ['energy_eur_per_kwh', 'machine_hour_eur', 'labor_hour_eur', 'material_markup_percent']) body.cost_profile[key] = Number(raw[key]);
  try {
    const result = await api('/v1/beta/me/cost-profile', { method: 'PATCH', body });
    costForm(result.profile);
    notice('Profilo costi salvato.');
  } catch (error) { notice(error.message, true); }
});

$('#logout').addEventListener('click', async () => {
  try { await api('/v1/beta/logout', { method: 'POST' }); } catch {}
  state.token = '';
  sessionStorage.removeItem('affetta_beta_token');
  location.reload();
});

$('#pair-agent').addEventListener('click', async () => {
  try {
    const result = await api('/v1/beta/agents/pairing-code', { method: 'POST', body: { name: 'Agent Windows personale' } });
    $('#pairing-code').textContent = result.pairing_code;
    $('#pairing-expiry').textContent = `Scade: ${new Date(result.expires_at).toLocaleString()}`;
    $('#pairing-panel').classList.remove('hidden');
    notice('Codice di pairing generato.');
  } catch (error) { notice(error.message, true); }
});

$('#agent-list').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-revoke-agent]');
  if (!button) return;
  try {
    await api(`/v1/beta/agents/${encodeURIComponent(button.dataset.revokeAgent)}/revoke`, { method: 'POST', body: {} });
    await refreshAgents();
    notice('Agent revocato.');
  } catch (error) { notice(error.message, true); }
});

const dropzone = $('#dropzone'), input = $('#file');
for (const name of ['dragenter', 'dragover']) dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.add('drag'); });
for (const name of ['dragleave', 'drop']) dropzone.addEventListener(name, (event) => { event.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', (event) => { if (event.dataTransfer.files[0]) updateFile(event.dataTransfer.files[0]); });
input.addEventListener('change', () => { if (input.files[0]) updateFile(input.files[0]); });
function updateFile(file) {
  state.file = file;
  $('#file-info').textContent = `${file.name} · ${bytesLabel(file.size)}`;
  $('#submit-job').disabled = false;
  $('#upload-step').textContent = 'Pronto';
}

$('#submit-job').addEventListener('click', submitJob);
$('#refresh-jobs').addEventListener('click', () => refreshJobs().catch((error) => notice(error.message, true)));
$('#jobs').addEventListener('click', async (event) => {
  const download = event.target.closest('[data-download-job]');
  if (download) return downloadJob(download.dataset.downloadJob);
  const cancel = event.target.closest('[data-cancel-job]');
  if (cancel) {
    try {
      await api(`/v1/beta/jobs/${encodeURIComponent(cancel.dataset.cancelJob)}/cancel`, { method: 'POST', body: {} });
      await refreshJobs();
      notice('Cancellazione registrata.');
    } catch (error) { notice(error.message, true); }
  }
});

const hash = new URL(location.href).hash;
if (hash.startsWith('#verify=')) $('#verify-form').token.value = decodeURIComponent(hash.slice(8));
api('/v1/beta/limits').then((limits) => {
  state.limits = limits;
  $('#limits').innerHTML = [
    [limits.daily_jobs, 'job al giorno'], [`${Math.round(limits.max_input_bytes / 1e6)} MB`, 'file massimo'],
    [`${limits.retention_hours} h`, 'download'], [limits.max_agents, 'Agent']
  ].map(([value, label]) => `<div class="limit"><strong>${value}</strong><span>${label}</span></div>`).join('');
}).catch((error) => notice(error.message, true));
refreshMe();
