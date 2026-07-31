import crypto from 'node:crypto';
import { config } from './config.js';
import { id, sha256 } from './utils.js';
import { defaultPricingProfile, sanitizePricingProfile } from './user-pricing.js';
import { findUserByEmail, findUserByUsername, sessionStore, userStore, verificationStore } from './auth-store.js';
import { sendVerificationEmail } from './mail-service.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;
const PHONE_RE = /^[+0-9 ()-]{6,30}$/;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, expected] = String(stored || '').split(':');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  return actual.length === expectedBuffer.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    email: user.email,
    phone: user.phone,
    email_verified: Boolean(user.email_verified_at),
    created_at: user.created_at
  };
}

function validateRegistration(input) {
  const name = String(input?.name || '').trim().replace(/\s+/g, ' ');
  const username = String(input?.username || '').trim();
  const email = String(input?.email || '').trim().toLowerCase();
  const phone = String(input?.phone || '').trim();
  const password = String(input?.password || '');
  if (name.length < 2 || name.length > 100) throw Object.assign(new Error('Inserisci nome e cognome.'), { statusCode: 400 });
  if (!USERNAME_RE.test(username)) throw Object.assign(new Error('Il nome utente deve contenere 3-32 caratteri: lettere, numeri, punto, trattino o underscore.'), { statusCode: 400 });
  if (!EMAIL_RE.test(email)) throw Object.assign(new Error('Indirizzo email non valido.'), { statusCode: 400 });
  if (!PHONE_RE.test(phone)) throw Object.assign(new Error('Numero di cellulare non valido.'), { statusCode: 400 });
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) throw Object.assign(new Error('La password deve avere almeno 10 caratteri, una lettera e un numero.'), { statusCode: 400 });
  return { name, username, username_normalized: username.toLowerCase(), email, phone, password };
}

export async function registerUser(input) {
  const value = validateRegistration(input);
  if (findUserByEmail(value.email)) throw Object.assign(new Error('Esiste già un account con questa email.'), { statusCode: 409, code: 'email_exists' });
  if (findUserByUsername(value.username)) throw Object.assign(new Error('Nome utente già utilizzato.'), { statusCode: 409, code: 'username_exists' });
  const now = new Date().toISOString();
  const user = userStore.create({
    id: id('usr'),
    name: value.name,
    username: value.username,
    username_normalized: value.username_normalized,
    email: value.email,
    phone: value.phone,
    password_hash: hashPassword(value.password),
    email_verified_at: null,
    pricing_profile: defaultPricingProfile(),
    created_at: now,
    updated_at: now
  });
  const rawToken = crypto.randomBytes(32).toString('base64url');
  const token = verificationStore.create({
    id: id('verify'),
    user_id: user.id,
    token_hash: sha256(Buffer.from(rawToken)),
    expires_at: new Date(Date.now() + config.emailVerificationHours * 3600_000).toISOString(),
    created_at: now
  });
  const verificationUrl = `${config.publicBaseUrl.replace(/\/$/, '')}/api/v1/auth/verify?token=${encodeURIComponent(rawToken)}`;
  let delivery;
  try {
    delivery = await sendVerificationEmail({ user, verificationUrl });
  } catch (error) {
    userStore.delete(user.id);
    verificationStore.delete(token.id);
    throw Object.assign(new Error(`Registrazione non completata: ${error.message}`), { statusCode: 503, code: 'mail_delivery_failed' });
  }
  return {
    user: publicUser(user),
    message: 'Registrazione completata. Controlla la tua email per confermare l’account.',
    mail_delivery: delivery.mode,
    ...(config.mailMode === 'log' ? { development_verification_url: verificationUrl, development_mail_file: delivery.file } : {})
  };
}

export function verifyEmailToken(rawToken) {
  const tokenHash = sha256(Buffer.from(String(rawToken || '')));
  const token = verificationStore.list({ limit: 100000 }).find((item) => item.token_hash === tokenHash) || null;
  if (!token || new Date(token.expires_at).getTime() < Date.now()) return false;
  const user = userStore.get(token.user_id);
  if (!user) return false;
  userStore.update(user.id, { email_verified_at: new Date().toISOString() });
  verificationStore.delete(token.id);
  return true;
}

export function loginUser(input) {
  const identity = String(input?.identity || '').trim();
  const password = String(input?.password || '');
  const user = identity.includes('@') ? findUserByEmail(identity) : findUserByUsername(identity);
  if (!user || !verifyPassword(password, user.password_hash)) throw Object.assign(new Error('Credenziali non valide.'), { statusCode: 401, code: 'invalid_credentials' });
  if (!user.email_verified_at) throw Object.assign(new Error('Conferma prima l’indirizzo email.'), { statusCode: 403, code: 'email_not_verified' });
  const session = sessionStore.create({
    id: crypto.randomBytes(32).toString('base64url'),
    user_id: user.id,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + config.sessionDays * 86400_000).toISOString()
  });
  return { session_id: session.id, user: publicUser(user) };
}

export function sessionUser(sessionId) {
  if (!sessionId) return null;
  const session = sessionStore.get(sessionId);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    sessionStore.delete(session.id);
    return null;
  }
  const user = userStore.get(session.user_id);
  return user ? { user, public: publicUser(user), session } : null;
}

export function logoutSession(sessionId) {
  return sessionId ? sessionStore.delete(sessionId) : false;
}

export function getPricingProfile(userId) {
  const user = userStore.get(userId);
  return user ? sanitizePricingProfile(user.pricing_profile) : null;
}

export function updatePricingProfile(userId, input) {
  const user = userStore.get(userId);
  if (!user) return null;
  const pricingProfile = sanitizePricingProfile(input, user.pricing_profile);
  userStore.update(user.id, { pricing_profile: pricingProfile });
  return pricingProfile;
}
