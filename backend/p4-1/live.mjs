import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

function args(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) throw new Error(`Argomento non valido: ${key ?? ''}`);
    result[key.slice(2)] = value;
  }
  return result;
}

async function jsonRequest(url, options = {}, expected = [200]) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = { raw: text }; }
  if (!expected.includes(response.status)) {
    const error = new Error(`HTTP ${response.status} ${url}: ${body?.error?.code ?? ''} ${body?.error?.message ?? text}`.trim());
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return { status: response.status, headers: Object.fromEntries(response.headers), body };
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /token|password|authorization/i.test(key) ? '[REDACTED]' : redact(item)
  ]));
}

const options = args(process.argv.slice(2));
const backendUrl = (options['backend-url'] ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const reportDir = path.resolve(options['report-dir'] ?? path.join(process.cwd(), 'backend', 'p4-1', 'reports'));
const testedAt = new Date().toISOString();
const suffix = `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`.toLowerCase();
const registration = {
  display_name: `P4.1 Test ${suffix}`,
  username: `p41.${suffix}`.slice(0, 32),
  email: `p41-${suffix}@local.invalid`,
  phone_e164: `+390${String(Date.now()).slice(-12)}`,
  password: `P4.1-test-${suffix}-Password!`,
  terms_accepted: true
};
const report = {
  tested_at: testedAt,
  result: 'failed',
  backend_url: backendUrl,
  checks: {},
  account: { email: registration.email, username: registration.username },
  completed_at: null,
  error: null
};

await fs.mkdir(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `p4-1-live-test-${testedAt.replaceAll(':', '').replaceAll('-', '').replaceAll('.', '')}.json`);

try {
  const ready = await jsonRequest(`${backendUrl}/readyz`);
  if (ready.body.ok !== true) throw new Error('Backend non ready.');
  report.checks.backend_ready = 'ok';

  const pageResponse = await fetch(`${backendUrl}/beta/`);
  const page = await pageResponse.text();
  if (!pageResponse.ok || !page.includes('AFFETTA') || !page.includes('register-form')) {
    throw new Error('Pagina beta non disponibile o incompleta.');
  }
  report.checks.beta_page = 'ok';

  const limits = await jsonRequest(`${backendUrl}/v1/beta/limits`);
  if (limits.body.plan !== 'free' || limits.body.max_agents !== 1) throw new Error('Limiti Free inattesi.');
  report.checks.free_limits = 'ok';
  report.limits = limits.body;

  const registered = await jsonRequest(`${backendUrl}/v1/beta/register`, { method: 'POST', body: registration }, [201]);
  const verificationToken = registered.body.dev_verification_token;
  if (typeof verificationToken !== 'string' || verificationToken.length < 16) {
    throw new Error('Token di verifica sviluppo non esposto. Nel profilo locale impostare AFFETTA_BETA_EXPOSE_DEV_TOKENS=true.');
  }
  if (JSON.stringify(registered.body).includes(registration.password) || JSON.stringify(registered.body).includes('password_hash')) {
    throw new Error('La risposta di registrazione espone dati password.');
  }
  report.checks.registration = 'ok';
  report.account.user_id = registered.body.account?.user?.id ?? null;
  report.account.organization_id = registered.body.account?.organization?.id ?? null;

  const preVerifyLogin = await jsonRequest(`${backendUrl}/v1/beta/login`, {
    method: 'POST', body: { email: registration.email, password: registration.password }
  }, [403]);
  if (preVerifyLogin.body?.error?.code !== 'email_not_verified') throw new Error('Login pre-verifica non bloccato correttamente.');
  report.checks.unverified_login_blocked = 'ok';

  const verified = await jsonRequest(`${backendUrl}/v1/beta/verify-email`, {
    method: 'POST', body: { token: verificationToken }
  });
  if (verified.body.verified !== true) throw new Error('Verifica email non confermata.');
  report.checks.email_verification = 'ok';

  const login = await jsonRequest(`${backendUrl}/v1/beta/login`, {
    method: 'POST', body: { email: registration.email, password: registration.password }
  });
  const accessToken = login.body.access_token;
  if (typeof accessToken !== 'string' || accessToken.length < 16) throw new Error('Sessione beta non emessa.');
  report.checks.login = 'ok';

  const auth = { authorization: `Bearer ${accessToken}` };
  const me = await jsonRequest(`${backendUrl}/v1/beta/me`, { headers: auth });
  if (me.body.account?.user?.email !== registration.email || me.body.account?.membership?.role !== 'owner') {
    throw new Error('Account beta o tenant personale incoerente.');
  }
  report.checks.account_isolation = 'ok';

  const updated = await jsonRequest(`${backendUrl}/v1/beta/me/cost-profile`, {
    method: 'PATCH', headers: auth, body: {
      display_name: `Service ${suffix}`,
      cost_profile: {
        energy_eur_per_kwh: 0.41,
        machine_hour_eur: 3.25,
        labor_hour_eur: 30,
        material_markup_percent: 25
      }
    }
  });
  if (updated.body.profile?.cost_profile?.machine_hour_eur !== 3.25) throw new Error('Profilo costi non aggiornato.');
  report.checks.cost_profile = 'ok';

  const logout = await jsonRequest(`${backendUrl}/v1/beta/logout`, { method: 'POST', headers: auth });
  if (logout.body.logged_out !== true) throw new Error('Logout non confermato.');
  const afterLogout = await jsonRequest(`${backendUrl}/v1/beta/me`, { headers: auth }, [401]);
  if (afterLogout.body?.error?.code !== 'invalid_beta_session') throw new Error('Sessione ancora valida dopo logout.');
  report.checks.session_revocation = 'ok';

  report.result = 'passed';
  report.completed_at = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(redact(report), null, 2) + '\n');
  console.log(`P4.1 report: ${reportPath}`);
  console.log('=== COLLAUDO LIVE BETA P4.1 SUPERATO ===');
} catch (error) {
  report.completed_at = new Date().toISOString();
  report.error = {
    message: error instanceof Error ? error.message : String(error),
    status: error?.status,
    body: error?.body
  };
  await fs.writeFile(reportPath, JSON.stringify(redact(report), null, 2) + '\n');
  console.error(`P4.1 report: ${reportPath}`);
  console.error(`ERRORE P4.1: ${report.error.message}`);
  process.exitCode = 1;
}
