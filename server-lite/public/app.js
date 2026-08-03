const printers = document.querySelector('#printers');
const summary = document.querySelector('#summary');
const errorBox = document.querySelector('#error');
const reconcile = document.querySelector('#reconcile');

function value(value, suffix = '') { return value === null || value === undefined ? 'non disponibile' : `${value}${suffix}`; }
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char])); }

function render(data) {
  const totals = data.totals;
  summary.innerHTML = `<strong>${totals.configured} configurate</strong> · ${totals.connected} connesse · ${totals.printing} in stampa · ${totals.paused} in pausa · ${totals.unreachable} non raggiungibili<br><strong>${data.shutdown_readiness.can_shutdown ? 'Il server può essere spento' : 'Non spegnere ancora il server'}</strong> — ${escapeHtml(data.shutdown_readiness.reason)}`;
  printers.innerHTML = data.printers.map((item) => `
    <article class="card">
      <h2>${escapeHtml(item.printer_name)}</h2>
      <p>${escapeHtml(item.printer_model)}</p>
      <p class="status">${escapeHtml(item.connection_status)} · ${escapeHtml(item.job_status)}</p>
      <div class="meter"><span style="width:${item.progress_percent ?? 0}%"></span></div>
      <dl>
        <dt>Completamento</dt><dd>${value(item.progress_percent, '%')}</dd>
        <dt>Tempo residuo</dt><dd>${value(item.remaining_seconds, ' s')}</dd>
        <dt>Layer</dt><dd>${item.layer_current == null ? 'non disponibile' : `${item.layer_current}/${item.layer_total ?? '?'}`}</dd>
        <dt>File</dt><dd>${escapeHtml(item.active_file || '—')}</dd>
        <dt>Ultimo contatto</dt><dd>${escapeHtml(item.observed_at)}</dd>
        <dt>Autonomia</dt><dd>${escapeHtml(item.server_dependency)}</dd>
      </dl>
      ${item.error ? `<p class="error">${escapeHtml(item.error.message)}</p>` : ''}
    </article>
  `).join('');
}

async function refresh() {
  try {
    const response = await fetch('/api/v1/server-lite/summary', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
    errorBox.hidden = true;
  } catch (error) {
    errorBox.textContent = `Aggiornamento non riuscito: ${error.message}`;
    errorBox.hidden = false;
  }
}

reconcile.addEventListener('click', async () => {
  reconcile.disabled = true;
  try { await fetch('/api/v1/server-lite/reconcile', { method: 'POST' }); }
  finally { reconcile.disabled = false; await refresh(); }
});

await refresh();
setInterval(refresh, 5000);
