const $ = (selector) => document.querySelector(selector);
const state = { token: sessionStorage.getItem('affetta_beta_token') || '' };

function notice(message, error = false) {
  const node = $('#notice'); node.textContent = message; node.classList.toggle('error', error); node.classList.remove('hidden');
  clearTimeout(notice.timer); notice.timer = setTimeout(() => node.classList.add('hidden'), 5500);
}

async function api(path, options = {}) {
  const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.authorization = `Bearer ${state.token}`;
  const response = await fetch(path, { ...options, headers, body: options.body ? JSON.stringify(options.body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Errore HTTP ${response.status}`);
  return payload;
}

function formObject(form) { return Object.fromEntries(new FormData(form)); }
function costForm(profile) {
  const form = $('#profile-form'); form.display_name.value = profile.display_name;
  for (const [key, value] of Object.entries(profile.cost_profile)) if (form[key]) form[key].value = value;
}

function showAccount(payload) {
  const account = payload.account; $('#auth').classList.add('hidden'); $('#workspace').classList.remove('hidden'); $('#logout').classList.remove('hidden');
  $('#welcome').textContent = `Ciao, ${account.profile.display_name}`; costForm(account.profile);
}

async function refreshMe() {
  if (!state.token) return;
  try { showAccount(await api('/v1/beta/me')); }
  catch { state.token = ''; sessionStorage.removeItem('affetta_beta_token'); }
}

$('#register-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const data = formObject(event.currentTarget); data.terms_accepted = event.currentTarget.terms_accepted.checked;
  try {
    const result = await api('/v1/beta/register', { method: 'POST', body: data });
    if (result.dev_verification_token) $('#verify-form').token.value = result.dev_verification_token;
    notice('Account creato. Verifica l’email prima di accedere.');
  } catch (error) { notice(error.message, true); }
});

$('#verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try { await api('/v1/beta/verify-email', { method: 'POST', body: formObject(event.currentTarget) }); notice('Email verificata. Ora puoi accedere.'); }
  catch (error) { notice(error.message, true); }
});

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await api('/v1/beta/login', { method: 'POST', body: formObject(event.currentTarget) });
    state.token = result.access_token; sessionStorage.setItem('affetta_beta_token', state.token); showAccount(result); notice('Accesso effettuato.');
  } catch (error) { notice(error.message, true); }
});

$('#profile-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const raw = formObject(event.currentTarget);
  const body = { display_name: raw.display_name, cost_profile: {} };
  for (const key of ['energy_eur_per_kwh','machine_hour_eur','labor_hour_eur','material_markup_percent']) body.cost_profile[key] = Number(raw[key]);
  try { const result = await api('/v1/beta/me/cost-profile', { method: 'PATCH', body }); costForm(result.profile); notice('Profilo costi salvato.'); }
  catch (error) { notice(error.message, true); }
});

$('#logout').addEventListener('click', async () => {
  try { await api('/v1/beta/logout', { method: 'POST' }); } catch {}
  state.token = ''; sessionStorage.removeItem('affetta_beta_token'); location.reload();
});

const dropzone = $('#dropzone'), input = $('#file');
for (const name of ['dragenter','dragover']) dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
for (const name of ['dragleave','drop']) dropzone.addEventListener(name, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); });
dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) updateFile(e.dataTransfer.files[0]); });
input.addEventListener('change', () => { if (input.files[0]) updateFile(input.files[0]); });
function updateFile(file) { $('#file-info').textContent = `${file.name} · ${(file.size / 1_000_000).toFixed(2)} MB`; }

const hash = new URL(location.href).hash;
if (hash.startsWith('#verify=')) $('#verify-form').token.value = decodeURIComponent(hash.slice(8));
api('/v1/beta/limits').then((limits) => {
  $('#limits').innerHTML = [
    [limits.daily_jobs, 'job al giorno'], [`${Math.round(limits.max_input_bytes/1e6)} MB`, 'file massimo'],
    [`${limits.retention_hours} h`, 'retention'], [limits.max_agents, 'Agent']
  ].map(([value,label]) => `<div class="limit"><strong>${value}</strong><span>${label}</span></div>`).join('');
}).catch((error) => notice(error.message, true));
refreshMe();
