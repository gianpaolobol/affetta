import { createViewer } from './viewer.js';

const $ = (id) => document.getElementById(id);
const state = { catalog:null, capabilities:null, user:null, file:null, base64:null, viewer:null, quote:null, job:null, pricing:null };
const colorHex = { random:'#e7472f', black:'#222222', white:'#f2f2f0', red:'#d63b32', blue:'#3472c9', custom:'#e7472f' };

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const money = (value) => new Intl.NumberFormat('it-IT', { style:'currency', currency:'EUR' }).format(Number(value || 0));
const bytes = (value) => value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { credentials:'same-origin', ...options, headers:{ ...(options.body ? {'Content-Type':'application/json'} : {}), ...(options.headers || {}) } });
  } catch (cause) {
    throw Object.assign(new Error('Connessione temporaneamente interrotta.'), { code:'transport_error', transport:true, cause });
  }
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('json') ? await response.json() : null;
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || `Errore HTTP ${response.status}`), { code:data?.error?.code || 'http_error', status:response.status });
  return data;
}

function showToast(message, duration = 4500) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

function route(name) {
  if (name === 'dashboard' && !state.user) {
    openAuth('login');
    return;
  }
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  $(`${name}-view`).classList.add('active');
  const path = name === 'dashboard' ? '/dashboard' : '/';
  if (location.pathname !== path) history.pushState({ view:name }, '', path);
  if (name === 'dashboard') loadDashboard().catch((error) => showToast(error.message));
  window.scrollTo({ top:0, behavior:'smooth' });
}

async function init() {
  // Upload e viewer vengono inizializzati prima delle API: anche se un endpoint
  // o WebGL non rispondono, l'utente può comunque selezionare e leggere lo STL.
  bindEvents();
  state.viewer = createViewer($('viewer'), $('viewer-status'));

  const [catalogResult, capabilitiesResult, meResult] = await Promise.allSettled([
    api('/api/v1/catalog'),
    api('/api/v1/capabilities'),
    api('/api/v1/auth/me')
  ]);

  if (catalogResult.status !== 'fulfilled') {
    throw new Error(`Catalogo non disponibile: ${catalogResult.reason?.message || 'errore sconosciuto'}`);
  }

  state.catalog = catalogResult.value;
  state.capabilities = capabilitiesResult.status === 'fulfilled' ? capabilitiesResult.value : { slicing:{ printers:{} } };
  state.user = meResult.status === 'fulfilled' ? meResult.value.user : null;

  populateCatalog();
  syncPrinter();
  syncColor();
  updateAuthUi();

  if (capabilitiesResult.status !== 'fulfilled') showToast('Diagnostica motori non disponibile; il caricamento STL resta attivo.');
  if (meResult.status !== 'fulfilled') showToast('Sessione utente non disponibile; puoi comunque usare lo slicer libero.');

  const params = new URLSearchParams(location.search);
  if (params.has('email_verified')) {
    showToast(params.get('email_verified') === '1' ? 'Email confermata. Ora puoi accedere.' : 'Link di conferma non valido o scaduto.');
    history.replaceState({}, '', location.pathname);
  }
  route(location.pathname === '/dashboard' ? 'dashboard' : 'slicer');
}

function populateCatalog() {
  const options = (object) => Object.entries(object).map(([id, item]) => `<option value="${esc(id)}">${esc(item.label)}</option>`).join('');
  $('printer').innerHTML = options(state.catalog.printers);
  $('material').innerHTML = options(state.catalog.materials);
  $('color').innerHTML = options(state.catalog.colors);
  $('quality-options').innerHTML = Object.entries(state.catalog.qualities).map(([id, item], index) => `<label class="segment"><input type="radio" name="quality" value="${esc(id)}" ${id === 'standard' || (!index && !state.catalog.qualities.standard) ? 'checked' : ''}><span><b>${esc(item.label)}</b><small>adattata all’ugello</small></span></label>`).join('');
  $('strength-options').innerHTML = Object.entries(state.catalog.strengths).map(([id, item], index) => `<label class="segment"><input type="radio" name="strength" value="${esc(id)}" ${id === 'standard' || (!index && !state.catalog.strengths.standard) ? 'checked' : ''}><span><b>${esc(item.label)}</b><small>${esc(item.infill_percent)}% · ${esc(item.walls)} pareti</small></span></label>`).join('');
}

function bindEvents() {
  document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', (event) => { event.preventDefault(); route(button.dataset.route); }));
  window.addEventListener('popstate', () => route(location.pathname === '/dashboard' ? 'dashboard' : 'slicer'));
  $('back-to-slicer').addEventListener('click', () => route('slicer'));
  $('auth-button').addEventListener('click', () => openAuth('login'));
  $('user-button').addEventListener('click', () => route('dashboard'));
  $('pricing-login').addEventListener('click', () => openAuth('login'));
  $('close-auth').addEventListener('click', () => $('auth-dialog').close());
  document.querySelectorAll('.auth-tab').forEach((button) => button.addEventListener('click', () => selectAuthTab(button.dataset.authTab)));
  $('login-form').addEventListener('submit', login);
  $('register-form').addEventListener('submit', register);
  $('logout-button').addEventListener('click', logout);
  $('pricing-form').addEventListener('submit', savePricing);
  const fileInput = $('file-input');
  const drop = $('drop-zone');
  const chooseFile = () => { fileInput.value = ''; fileInput.click(); };
  fileInput.addEventListener('change', () => acceptFile(fileInput.files?.[0]));
  drop.addEventListener('click', (event) => { if (event.target !== fileInput) chooseFile(); });
  drop.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseFile(); }
  });
  $('file-label').addEventListener('click', chooseFile);
  $('change-file').addEventListener('click', chooseFile);
  ['dragenter','dragover'].forEach((eventName) => drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.add('drag'); }));
  ['dragleave','drop'].forEach((eventName) => drop.addEventListener(eventName, (event) => { event.preventDefault(); drop.classList.remove('drag'); }));
  drop.addEventListener('drop', (event) => acceptFile(event.dataTransfer?.files?.[0]));
  $('fit-model').addEventListener('click', () => state.viewer?.reset());
  $('wireframe').addEventListener('click', () => state.viewer?.toggleWireframe());
  $('printer').addEventListener('change', syncPrinter);
  $('nozzle').addEventListener('change', syncResolvedProfile);
  $('material').addEventListener('change', syncResolvedProfile);
  $('quality-options').addEventListener('change', syncResolvedProfile);
  $('strength-options').addEventListener('change', syncResolvedProfile);
  $('color').addEventListener('change', syncColor);
  $('custom-color').addEventListener('input', () => state.viewer?.setColor('#e7472f'));
  $('slice-form').addEventListener('submit', submitAffetta);
}

async function readFileAsArrayBuffer(file) {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Impossibile leggere il file.'));
    reader.readAsArrayBuffer(file);
  });
}

async function acceptFile(file) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.stl')) return showToast('Seleziona un file con estensione .stl.');
  if (file.size <= 0) return showToast('Il file selezionato è vuoto.');
  if (file.size > 25 * 1024 * 1024) return showToast('Il file supera 25 MB.');

  const previousLabel = $('viewer-status').textContent;
  $('viewer-status').textContent = 'Lettura del file STL…';
  try {
    const buffer = await readFileAsArrayBuffer(file);
    if (!state.viewer) state.viewer = createViewer($('viewer'), $('viewer-status'));
    const dimensions = state.viewer.load(buffer);
    state.file = file;
    state.base64 = arrayBufferToBase64(buffer);
    $('drop-zone').classList.add('hidden');
    $('change-file').classList.remove('hidden');
    $('file-label').textContent = `${file.name} · ${bytes(file.size)}`;
    $('model-dimensions').textContent = `${dimensions.size.map((value) => Number(value).toFixed(1)).join(' × ')} mm · ${dimensions.triangleCount.toLocaleString('it-IT')} triangoli`;
    $('submit-button').disabled = false;
    document.querySelector('.button-label').textContent = 'Affetta e crea il G-code';
    $('result').classList.add('hidden');
    $('viewer-status').textContent = `${dimensions.renderer === 'webgl' ? 'Viewer 3D' : 'Viewer compatibile'} · modello caricato`;
    showToast(`Modello caricato: ${file.name}`);
  } catch (error) {
    state.file = null;
    state.base64 = null;
    $('submit-button').disabled = true;
    $('drop-zone').classList.remove('hidden');
    $('change-file').classList.add('hidden');
    $('viewer-status').textContent = previousLabel || 'Viewer pronto';
    showToast(`Impossibile leggere il modello: ${error.message}`, 7000);
  }
}

function arrayBufferToBase64(buffer) {
  const data = new Uint8Array(buffer);
  let binary = '';
  for (let index = 0; index < data.length; index += 0x8000) binary += String.fromCharCode(...data.subarray(index, index + 0x8000));
  return btoa(binary);
}

function syncPrinter() {
  const printerId = $('printer').value;
  const printer = state.catalog.printers[printerId];
  const previous = Number($('nozzle').value);
  const automatic = printerId === 'auto-lab';
  $('nozzle').disabled = automatic;
  $('nozzle').innerHTML = automatic
    ? '<option value="0.4">Scelto automaticamente</option>'
    : printer.nozzles.map((value) => `<option value="${value}" ${value === (printer.default_nozzle || previous) ? 'selected' : ''}>${value} mm</option>`).join('');
  const supported = new Set(printer.materials || Object.keys(state.catalog.materials));
  const currentMaterial = $('material').value;
  $('material').innerHTML = Object.entries(state.catalog.materials)
    .filter(([id, item]) => supported.has(id) && (item.technology || 'fff') === 'fff')
    .map(([id,item]) => `<option value="${esc(id)}">${esc(item.label)}</option>`).join('');
  if (supported.has(currentMaterial)) $('material').value = currentMaterial;
  const available = Boolean(state.capabilities?.slicing?.printers?.[printerId]?.slice_available);
  $('printer-note').textContent = automatic
    ? `Router del laboratorio · sceglie unità fisica, ugello e motore dopo l’analisi`
    : `${printer.build_mm.join(' × ')} mm · filamento ${printer.filament_diameter_mm || '—'} mm · ${available ? 'motore pronto' : 'motore da installare/configurare'}`;
  state.viewer?.setPrinter({
    build_mm: printer.build_mm,
    bed_shape: printer.bed_shape,
    build_diameter_mm: printer.build_diameter_mm
  });
  syncResolvedProfile();
}

let profilePreviewSequence = 0;
async function syncResolvedProfile() {
  if (!state.catalog || !$('printer').value || !$('nozzle').value || !$('material').value) return;
  const sequence = ++profilePreviewSequence;
  const quality = document.querySelector('input[name="quality"]:checked')?.value || 'standard';
  const strength = document.querySelector('input[name="strength"]:checked')?.value || 'standard';
  const params = new URLSearchParams({
    printer_id: $('printer').value, nozzle_mm: $('nozzle').value, material_id: $('material').value, quality_id: quality, strength_id: strength
  });
  $('auto-profile-summary').textContent = 'Calcolo dei parametri…';
  try {
    const data = await api(`/api/v1/profile-preview?${params}`);
    if (sequence !== profilePreviewSequence) return;
    const p = data.profile;
    if (p.routing_pending_model) {
      $('auto-profile-summary').textContent = 'Affetta analizzerà dimensioni, quantità, materiale, qualità, resistenza e colore per scegliere il reparto più adatto.';
      return;
    }
    const plate = p.build_plate ? ` · piatto ${p.build_plate}` : '';
    $('auto-profile-summary').textContent = `Layer ${p.layer_height_mm} mm · ${p.infill_percent}% · ${p.walls} pareti · ${p.temperature_c}/${p.bed_temperature_c} °C · ${p.print_speed_mm_s} mm/s · retrazione ${p.retract_length_mm} mm · filamento ${p.filament_diameter_mm} mm${plate}`;
  } catch (error) {
    if (sequence === profilePreviewSequence) $('auto-profile-summary').textContent = error.message;
  }
}

function syncColor() {
  const value = $('color').value;
  $('custom-color-field').classList.toggle('hidden', value !== 'custom');
  $('custom-color').required = value === 'custom';
  state.viewer?.setColor(colorHex[value] || '#e7472f');
}

async function submitAffetta(event) {
  event.preventDefault();
  if (!state.file || !state.base64) return;
  const payload = {
    filename: state.file.name,
    file_base64: state.base64,
    printer_id: $('printer').value,
    nozzle_mm: $('printer').value === 'auto-lab' ? null : Number($('nozzle').value),
    material_id: $('material').value,
    color_id: $('color').value,
    custom_color: $('color').value === 'custom' ? $('custom-color').value.trim() : null,
    quality_id: document.querySelector('input[name="quality"]:checked').value,
    strength_id: document.querySelector('input[name="strength"]:checked').value,
    quantity: Number($('quantity').value || 1),
    source: 'affetta-standalone'
  };
  setBusy(true);
  try {
    const data = await api('/api/v1/affetta-jobs', { method:'POST', body:JSON.stringify(payload) });
    state.job = data.job;
    state.quote = data.quote;
    renderProgress(data.job, data.quote);
    pollJob(data.job.id);
  } catch (error) { renderError(error.message); }
  finally { setBusy(false); }
}

function setBusy(busy) {
  $('submit-button').disabled = busy || !state.file;
  document.querySelector('.button-label').textContent = busy ? 'Affetta sta preparando il lavoro…' : state.file ? 'Affetta e crea il G-code' : 'Carica un modello STL';
}

function quoteHtml(quote) {
  if (!quote) return `<div class="info-card"><strong>Preventivo non calcolato.</strong><br>Il G-code resta disponibile liberamente. Registrati o accedi per applicare un profilo costi personale.</div>`;
  return `<div class="metrics">
    <div class="metric"><small>Costo totale</small><strong>${money(quote.price.total_eur)}</strong></div>
    <div class="metric"><small>Costo unitario</small><strong>${money(quote.price.unit_eur)}</strong></div>
    <div class="metric"><small>Tempo stimato</small><strong>${esc(quote.estimate.time_human)}</strong></div>
    <div class="metric"><small>Materiale per pezzo</small><strong>${esc(quote.estimate.filament_g)} g</strong></div>
  </div>`;
}

function renderProgress(job, quote) {
  const result = $('result');
  const routed = job.routing?.selected ? ` · ${esc(job.routing.selected.unit_label)}` : '';
  result.innerHTML = `<h2>Affetta sta preparando il G-code</h2><p class="sub">${esc(job.printer.label)}${routed} · ${esc(job.selections.quantity)} ${job.selections.quantity === 1 ? 'pezzo' : 'pezzi'}</p>
    ${quoteHtml(quote)}
    <div class="progress-track"><div id="progress-bar" class="progress-bar" style="width:${job.progress}%"></div></div>
    <p id="job-message">${esc(job.message)}</p>`;
  result.classList.remove('hidden');
  result.scrollIntoView({ behavior:'smooth', block:'start' });
}

async function pollJob(id) {
  let consecutiveTransportErrors = 0;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    try {
      const data = await api(`/api/v1/slice-jobs/${encodeURIComponent(id)}`);
      consecutiveTransportErrors = 0;
      const job = data.job;
      const bar = $('progress-bar');
      if (bar) bar.style.width = `${job.progress}%`;
      const message = $('job-message');
      if (message) message.textContent = job.message;
      if (job.status === 'completed') return renderCompleted(job, state.quote);
      if (job.status === 'failed') return renderError(job.error?.message || 'Slicing non riuscito.');
    } catch (error) {
      if (error.transport && consecutiveTransportErrors < 3) {
        consecutiveTransportErrors++;
        const message = $('job-message');
        if (message) message.textContent = `Connessione temporanea: nuovo tentativo ${consecutiveTransportErrors}/3…`;
        continue;
      }
      return renderError(error.message);
    }
  }
  renderError('Timeout durante l’attesa del G-code. Il job può essere verificato dalla diagnostica.');
}

function renderCompleted(job, quote) {
  const result = $('result');
  const data = job.result;
  result.innerHTML = `<h2>${data.print_ready ? 'G-code pronto' : 'Flusso di prova completato'}</h2>
    <p class="sub">${esc(job.printer.label)}${job.routing?.selected ? ` · unità ${esc(job.routing.selected.unit_label)}` : ''} · profilo ${esc(data.profile_status === 'validated' ? 'validato' : 'da collaudare')}</p>
    ${quoteHtml(quote)}
    <div class="metrics">
      <div class="metric"><small>Stato file</small><strong>${data.print_ready ? 'Pronto' : 'Demo'}</strong></div>
      <div class="metric"><small>Tempo G-code</small><strong>${esc(data.time_human)}</strong></div>
      <div class="metric"><small>Materiale G-code</small><strong>${esc(data.filament_g)} g</strong></div>
      <div class="metric"><small>Quantità richiesta</small><strong>${esc(job.selections.quantity)}</strong></div>
    </div>
    ${data.applied_profile ? `<div class="info-card"><strong>Profilo applicato automaticamente</strong><br>Layer ${esc(data.applied_profile.layer_height_mm)} mm · ${esc(data.applied_profile.infill_percent)}% riempimento · ${esc(data.applied_profile.walls)} pareti · ${esc(data.applied_profile.temperature_c)}/${esc(data.applied_profile.bed_temperature_c)} °C · ${esc(data.applied_profile.print_speed_mm_s)} mm/s${data.applied_profile.build_plate ? ` · piatto ${esc(data.applied_profile.build_plate)}` : ''}</div>` : ''}
    <div class="result-actions">
      ${data.print_ready ? `<a class="download" href="${esc(job.artifact_url)}">Scarica il G-code</a>` : ''}
      ${!state.user ? '<button class="button ghost" id="result-register">Registrati per i costi</button>' : '<button class="button ghost" id="result-dashboard">Modifica profilo costi</button>'}
    </div>
    ${(data.warning || data.demo_only) ? `<div class="warning">${esc(data.warning || 'Il file dimostrativo non è stampabile: configura il motore dedicato.')}</div>` : ''}`;
  $('result-register')?.addEventListener('click', () => openAuth('register'));
  $('result-dashboard')?.addEventListener('click', () => route('dashboard'));
}

function renderError(message) {
  const result = $('result');
  result.innerHTML = `<div class="error-card"><strong>Operazione non completata.</strong><br>${esc(message)}</div>`;
  result.classList.remove('hidden');
  result.scrollIntoView({ behavior:'smooth', block:'start' });
}

function openAuth(tab = 'login') {
  selectAuthTab(tab);
  $('auth-message').classList.add('hidden');
  $('auth-dialog').showModal();
}

function selectAuthTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((button) => button.classList.toggle('active', button.dataset.authTab === tab));
  $('login-panel').classList.toggle('active', tab === 'login');
  $('register-panel').classList.toggle('active', tab === 'register');
}

async function login(event) {
  event.preventDefault();
  setAuthMessage('Accesso in corso…');
  try {
    const data = await api('/api/v1/auth/login', { method:'POST', body:JSON.stringify({ identity:$('login-identity').value, password:$('login-password').value }) });
    state.user = data.user;
    updateAuthUi();
    $('auth-dialog').close();
    showToast(`Ciao ${state.user.name}, profilo costi attivo.`);
  } catch (error) { setAuthMessage(error.message, true); }
}

async function register(event) {
  event.preventDefault();
  setAuthMessage('Creazione account e invio email…');
  try {
    const data = await api('/api/v1/auth/register', { method:'POST', body:JSON.stringify({
      name:$('register-name').value, username:$('register-username').value, email:$('register-email').value,
      phone:$('register-phone').value, password:$('register-password').value
    }) });
    let extra = '';
    if (data.development_verification_url) extra = `<br><br><a href="${esc(data.development_verification_url)}">Conferma l’email in modalità locale</a><br><small>La copia della mail è salvata in data/mail-outbox.</small>`;
    setAuthMessage(`${esc(data.message)}${extra}`, false, true);
  } catch (error) { setAuthMessage(error.message, true); }
}

function setAuthMessage(message, error = false, html = false) {
  const box = $('auth-message');
  if (html) box.innerHTML = message; else box.textContent = message;
  box.classList.remove('hidden');
  box.style.background = error ? '#ffe7e3' : '#e8f0ff';
  box.style.color = error ? '#b53c32' : '#31558c';
}

async function logout() {
  await api('/api/v1/auth/logout', { method:'POST', body:'{}' });
  state.user = null; state.pricing = null;
  updateAuthUi();
  route('slicer');
  showToast('Sessione terminata.');
}

function updateAuthUi() {
  const logged = Boolean(state.user);
  $('auth-button').classList.toggle('hidden', logged);
  $('user-button').classList.toggle('hidden', !logged);
  $('dashboard-nav').classList.toggle('hidden', !logged);
  if (logged) {
    $('user-button').textContent = state.user.name.trim().charAt(0).toUpperCase();
    $('account-badge').className = 'badge success';
    $('account-badge').textContent = 'Costo personale attivo';
    $('pricing-message').innerHTML = '<strong>Preventivo incluso</strong><span>Verrà applicato il tuo profilo costi personale.</span><button type="button" class="text-button" id="edit-pricing-inline">Modifica costi</button>';
    $('edit-pricing-inline').addEventListener('click', () => route('dashboard'));
  } else {
    $('account-badge').className = 'badge neutral';
    $('account-badge').textContent = 'G-code libero';
    $('pricing-message').innerHTML = '<strong>Vuoi anche il prezzo?</strong><span>Accedi e configura i tuoi costi in dashboard.</span><button type="button" class="text-button" id="pricing-login-inline">Accedi o registrati</button>';
    $('pricing-login-inline').addEventListener('click', () => openAuth('login'));
  }
}

async function loadDashboard() {
  if (!state.user) return;
  $('profile-avatar').textContent = state.user.name.charAt(0).toUpperCase();
  $('profile-name').textContent = state.user.name;
  $('profile-username').textContent = `@${state.user.username}`;
  $('profile-email').textContent = state.user.email;
  $('profile-phone').textContent = state.user.phone;
  const data = await api('/api/v1/user/pricing-profile');
  state.pricing = data.profile;
  renderPricingForm(data.profile, data.catalogs);
}

function inputField(id, label, value, suffix = '', step = '0.01', min = '0') {
  return `<label class="field"><span>${esc(label)}</span><div class="input-suffix"><input data-price-key="${esc(id)}" type="number" step="${step}" min="${min}" value="${esc(value)}">${suffix ? `<em>${esc(suffix)}</em>` : ''}</div></label>`;
}

function renderPricingForm(profile, catalogs) {
  const general = [
    ['setup_eur','Preparazione ordine',profile.setup_eur,'€'], ['labor_eur','Lavoro operatore',profile.labor_eur,'€'],
    ['machine_eur_hour','Costo macchina',profile.machine_eur_hour,'€/h'], ['energy_eur_hour','Energia',profile.energy_eur_hour,'€/h'],
    ['material_markup','Moltiplicatore materiale',profile.material_markup,'×'], ['risk_percent','Rischio/scarto',profile.risk_percent,'%'],
    ['margin_percent','Margine',profile.margin_percent,'%'], ['minimum_eur','Importo minimo',profile.minimum_eur,'€'],
    ['vat_percent','IVA',profile.vat_percent,'%']
  ];
  $('general-pricing-fields').innerHTML = general.map((item) => inputField(...item)).join('');
  $('material-pricing-fields').innerHTML = Object.entries(catalogs.materials).map(([id, item]) => inputField(`materials_eur_kg.${id}`, item.label, profile.materials_eur_kg[id], '€/kg')).join('');
  $('quality-pricing-fields').innerHTML = Object.entries(catalogs.qualities).map(([id, item]) => inputField(`quality_price_factor.${id}`, item.label, profile.quality_price_factor[id], '×', '0.01', '0.1')).join('');
  $('strength-pricing-fields').innerHTML = Object.entries(catalogs.strengths).map(([id, item]) => inputField(`strength_price_factor.${id}`, item.label, profile.strength_price_factor[id], '×', '0.01', '0.1')).join('');
  $('color-pricing-fields').innerHTML = Object.entries(catalogs.colors).map(([id, item]) => inputField(`color_price_factor.${id}`, item.label, profile.color_price_factor[id], '×', '0.01', '0.1')).join('');
}

async function savePricing(event) {
  event.preventDefault();
  const profile = structuredClone(state.pricing);
  document.querySelectorAll('[data-price-key]').forEach((input) => {
    const path = input.dataset.priceKey.split('.');
    if (path.length === 1) profile[path[0]] = Number(input.value);
    else profile[path[0]][path[1]] = Number(input.value);
  });
  $('save-status').textContent = 'Salvataggio…';
  try {
    const data = await api('/api/v1/user/pricing-profile', { method:'PUT', body:JSON.stringify(profile) });
    state.pricing = data.profile;
    $('save-status').textContent = 'Salvato';
    showToast('Profilo costi aggiornato.');
    setTimeout(() => { $('save-status').textContent = ''; }, 2500);
  } catch (error) { $('save-status').textContent = 'Errore'; showToast(error.message); }
}

init().catch((error) => renderError(error.message));
