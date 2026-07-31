import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'affetta-auth-test-'));
process.env.AFFETTA_DATA_DIR = dataDir;
process.env.AFFETTA_MAIL_MODE = 'log';
process.env.AFFETTA_PUBLIC_BASE_URL = 'http://127.0.0.1:8787';

const auth = await import(`../src/auth-service.js?auth-test=${Date.now()}`);
const pricing = await import(`../src/user-pricing.js?pricing-test=${Date.now()}`);

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('registrazione, conferma email, login e profilo costi personale', async () => {
  const registered = await auth.registerUser({
    name: 'Mario Rossi',
    username: 'mario.rossi',
    email: 'mario@example.test',
    phone: '+39 333 1234567',
    password: 'PasswordAffetta123'
  });
  assert.equal(registered.user.email_verified, false);
  assert.match(registered.development_verification_url, /token=/);
  assert.ok(fs.existsSync(registered.development_mail_file));
  const rawToken = new URL(registered.development_verification_url).searchParams.get('token');
  assert.equal(auth.verifyEmailToken(rawToken), true);

  const login = auth.loginUser({ identity: 'mario.rossi', password: 'PasswordAffetta123' });
  assert.equal(login.user.email_verified, true);
  assert.ok(login.session_id);
  assert.equal(auth.sessionUser(login.session_id).public.email, 'mario@example.test');

  const updated = auth.updatePricingProfile(login.user.id, {
    ...auth.getPricingProfile(login.user.id),
    machine_eur_hour: 8.5,
    materials_eur_kg: { pla: 24.5 }
  });
  assert.equal(updated.machine_eur_hour, 8.5);
  assert.equal(updated.materials_eur_kg.pla, 24.5);
  assert.equal(auth.logoutSession(login.session_id), true);
});

test('calcolo prezzo usa quantità e profilo personale', () => {
  const profile = pricing.defaultPricingProfile();
  const one = pricing.calculateUserPrice({
    profile,
    estimate: { filament_g: 100, time_seconds: 3600 },
    materialId: 'pla', qualityId: 'standard', strengthId: 'standard', colorId: 'random', quantity: 1
  });
  const three = pricing.calculateUserPrice({
    profile,
    estimate: { filament_g: 100, time_seconds: 3600 },
    materialId: 'pla', qualityId: 'standard', strengthId: 'standard', colorId: 'random', quantity: 3
  });
  assert.ok(three.total_eur > one.total_eur);
  assert.equal(three.quantity, 3);
  assert.equal(three.unit_eur, Number((three.total_eur / 3).toFixed(2)));
});
