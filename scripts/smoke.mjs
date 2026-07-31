import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedVersion = fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim();
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-smoke-'));
const port = 18787;
const fake = path.join(root, 'scripts', 'fake-slicer.mjs');
const customEngine = JSON.stringify([process.execPath, fake, '{input}', '{output}']);
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['bootstrap.js'], {
  cwd: root,
  env: {
    ...process.env,
    AFFETTA_DATA_DIR: dataDir,
    AFFETTA_PORT: String(port),
    AFFETTA_PUBLIC_BASE_URL: baseUrl,
    AFFETTA_ENGINE_COMMAND_PRUSA: customEngine,
    AFFETTA_ENGINE_COMMAND_CURA: customEngine,
    AFFETTA_ENGINE_COMMAND_ORCA: customEngine,
    AFFETTA_ALLOW_DEMO_GCODE: 'false',
    AFFETTA_PUBLIC_MODE: 'true',
    AFFETTA_EXPOSE_ENGINE_NAMES: 'false',
    AFFETTA_MAIL_MODE: 'log'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stderr = '';
child.stderr.on('data', (d) => { stderr += d; });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitHealth() {
  for (let i = 0; i < 50; i++) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return response.json();
    } catch {}
    await sleep(200);
  }
  throw new Error(`server non avviato ${stderr}`);
}

async function pollJob(jobId, headers = {}) {
  for (let i = 0; i < 60; i++) {
    await sleep(120);
    const response = await fetch(`${baseUrl}/api/v1/slice-jobs/${jobId}`, { headers });
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    if (data.job.status === 'completed') return data.job;
    if (data.job.status === 'failed') throw new Error(JSON.stringify(data.job.error));
  }
  throw new Error('timeout job slicing');
}

try {
  const health = await waitHealth();
  if (health.version !== expectedVersion) throw new Error(`versione health errata: ${health.version}`);

  let response = await fetch(`${baseUrl}/api/v1/capabilities`);
  const capabilities = await response.json();
  if (!response.ok || capabilities.slicing.ready_printers !== capabilities.slicing.total_printers) throw new Error(`capabilities errate ${JSON.stringify(capabilities)}`);
  if ('engines' in capabilities || Object.values(capabilities.slicing.printers).some((item) => 'routes' in item)) throw new Error('dettagli motori esposti nelle capabilities pubbliche');

  response = await fetch(`${baseUrl}/api/v1/profile-preview?printer_id=creality-ender3&nozzle_mm=0.6&material_id=petg&quality_id=draft&strength_id=light`);
  const preview = await response.json();
  if (!response.ok || preview.profile.layer_height_mm !== 0.42 || preview.profile.infill_percent !== 12) throw new Error(`profilo automatico errato ${JSON.stringify(preview)}`);

  const file = fs.readFileSync(path.join(root, 'samples', 'cube20.stl')).toString('base64');
  const base = {
    filename: 'cube20.stl',
    file_base64: file,
    printer_id: 'generic-reprap-marlin',
    nozzle_mm: 0.4,
    material_id: 'pla',
    quality_id: 'standard',
    strength_id: 'standard',
    color_id: 'custom',
    custom_color: 'Blu petrolio',
    quantity: 2,
    external_ref: 'SMOKE-030',
    metadata: { channel: 'standalone' }
  };

  // Uso pubblico: crea il G-code ma non mostra un prezzo.
  response = await fetch(`${baseUrl}/api/v1/affetta-jobs`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(base)
  });
  const publicResult = await response.json();
  if (!response.ok || publicResult.quote !== null || publicResult.pricing_access !== false) throw new Error(`flusso pubblico errato ${JSON.stringify(publicResult)}`);
  const publicJob = await pollJob(publicResult.job.id);
  if (!publicJob.result.print_ready) throw new Error('G-code pubblico non pronto');
  if ('engine' in publicJob.printer || 'provider' in publicJob.result) throw new Error('motore esposto al client pubblico');

  for (const machine of [
    { printer_id:'prusa-mk4', nozzle_mm:0.4 },
    { printer_id:'creality-ender3', nozzle_mm:0.4 },
    { printer_id:'bambu-x1c', nozzle_mm:0.4 }
  ]) {
    response = await fetch(`${baseUrl}/api/v1/affetta-jobs`, {
      method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({...base,...machine,quantity:1,color_id:'random',custom_color:null})
    });
    const routed = await response.json();
    if (!response.ok) throw new Error(`creazione job ${machine.printer_id} fallita ${JSON.stringify(routed)}`);
    const routedJob = await pollJob(routed.job.id);
    if (!routedJob.result.print_ready || !routedJob.result.applied_profile) throw new Error(`routing ${machine.printer_id} fallito`);
  }

  // Registrazione e conferma email locale.
  const suffix = Date.now().toString(36);
  response = await fetch(`${baseUrl}/api/v1/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      name: 'Utente Smoke', username: `smoke_${suffix}`, email: `smoke_${suffix}@example.test`, phone: '+39 333 1234567', password: 'AffettaTest1234'
    })
  });
  const registration = await response.json();
  if (response.status !== 201 || !registration.development_verification_url) throw new Error(`registrazione fallita ${JSON.stringify(registration)}`);
  response = await fetch(registration.development_verification_url, { redirect: 'manual' });
  if (response.status !== 302) throw new Error(`verifica email fallita: ${response.status}`);

  response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identity: registration.user.email, password: 'AffettaTest1234' })
  });
  const login = await response.json();
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!response.ok || !cookie || !login.user.email_verified) throw new Error(`login fallito ${JSON.stringify(login)}`);
  const authHeaders = { cookie };

  response = await fetch(`${baseUrl}/api/v1/user/pricing-profile`, { headers: authHeaders });
  const pricing = await response.json();
  if (!response.ok || !pricing.profile) throw new Error('profilo prezzi non disponibile');
  pricing.profile.machine_eur_hour = 7.25;
  pricing.profile.materials_eur_kg.pla = 23.5;
  response = await fetch(`${baseUrl}/api/v1/user/pricing-profile`, {
    method: 'PUT', headers: { ...authHeaders, 'content-type': 'application/json' }, body: JSON.stringify(pricing.profile)
  });
  if (!response.ok) throw new Error('salvataggio profilo prezzi fallito');

  // Utente registrato: stesso lavoro, G-code + prezzo personale.
  response = await fetch(`${baseUrl}/api/v1/affetta-jobs`, {
    method: 'POST', headers: { ...authHeaders, 'content-type': 'application/json' }, body: JSON.stringify(base)
  });
  const privateResult = await response.json();
  if (!response.ok || !privateResult.quote?.price?.total_eur || !privateResult.pricing_access) throw new Error(`preventivo personale assente ${JSON.stringify(privateResult)}`);
  if ('provider' in privateResult.quote.estimate) throw new Error('motore stima esposto');
  const privateJob = await pollJob(privateResult.job.id, authHeaders);
  if (!privateJob.result.print_ready) throw new Error('G-code privato non pronto');

  response = await fetch(`${baseUrl}${privateJob.artifact_url}`);
  const gcode = await response.text();
  if (!response.ok || !gcode.includes('generated by Affetta test fixture')) throw new Error('download G-code non riuscito');

  console.log(JSON.stringify({
    health: 'ok',
    version: health.version,
    public_gcode: true,
    public_price_hidden: true,
    registration: true,
    email_verification: true,
    personal_pricing: true,
    quote_total: privateResult.quote.price.total_eur,
    custom_color: privateResult.quote.selections.color.custom,
    quantity: privateResult.quote.selections.quantity,
    hidden_engine: true,
    ready_printers: capabilities.slicing.ready_printers,
    routed_families: ['prusa','cura','orca'],
    profile_preview: preview.profile
  }, null, 2));
} finally {
  child.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}
