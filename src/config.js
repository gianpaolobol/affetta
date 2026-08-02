import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), 'utf8'));
}

function boolEnv(name, fallback) {
  const value = process.env[name];
  if (value == null) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function numberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function parseApiKeys(value = '') {
  const result = new Map();
  for (const entry of value.split(',').map((v) => v.trim()).filter(Boolean)) {
    const index = entry.indexOf(':');
    if (index <= 0) continue;
    const tenant = entry.slice(0, index).trim();
    const key = entry.slice(index + 1).trim();
    if (tenant && key) result.set(key, tenant);
  }
  return result;
}

export const catalogs = Object.freeze({
  app: readJson('config/app.json'),
  materials: readJson('config/materials.json'),
  qualities: readJson('config/qualities.json'),
  strengths: readJson('config/strengths.json'),
  colors: readJson('config/colors.json'),
  pricing: readJson('config/pricing.json'),
  printers: readJson('config/printers.json'),
  fleet: readJson('config/fleet.json'),
  internalProfiles: readJson('config/internal-profiles.json')
});

const dataDir = path.resolve(process.env.AFFETTA_DATA_DIR || path.join(ROOT, 'data'));

export const config = Object.freeze({
  version: '0.5.2',
  apiVersion: 'v1',
  instanceId: process.env.AFFETTA_INSTANCE_ID || '',
  buildId: process.env.AFFETTA_BUILD_ID || '',
  host: process.env.AFFETTA_HOST || '0.0.0.0',
  port: numberEnv('AFFETTA_PORT', 8787),
  publicMode: boolEnv('AFFETTA_PUBLIC_MODE', true),
  publicBaseUrl: process.env.AFFETTA_PUBLIC_BASE_URL || 'http://127.0.0.1:8787',
  maxFileBytes: Math.round(numberEnv('AFFETTA_MAX_FILE_MB', 25) * 1024 * 1024),
  allowedOrigins: (process.env.AFFETTA_ALLOWED_ORIGINS || '').split(',').map((v) => v.trim()).filter(Boolean),
  apiKeys: parseApiKeys(process.env.AFFETTA_API_KEYS),
  adminToken: process.env.AFFETTA_ADMIN_TOKEN || '',
  requireKiri: boolEnv('AFFETTA_REQUIRE_KIRI', false),
  allowGeometryFallback: boolEnv('AFFETTA_ALLOW_GEOMETRY_FALLBACK', true),
  allowDemoGcode: boolEnv('AFFETTA_ALLOW_DEMO_GCODE', false),
  exposeEngineNames: boolEnv('AFFETTA_EXPOSE_ENGINE_NAMES', false),
  artifactTtlHours: numberEnv('AFFETTA_ARTIFACT_TTL_HOURS', 72),
  sessionDays: numberEnv('AFFETTA_SESSION_DAYS', 30),
  emailVerificationHours: numberEnv('AFFETTA_EMAIL_VERIFICATION_HOURS', 24),
  mailMode: process.env.AFFETTA_MAIL_MODE || 'log',
  mailFrom: process.env.AFFETTA_MAIL_FROM || 'Affetta <noreply@affetta.local>',
  smtpHost: process.env.AFFETTA_SMTP_HOST || '',
  smtpPort: numberEnv('AFFETTA_SMTP_PORT', 587),
  smtpSecure: boolEnv('AFFETTA_SMTP_SECURE', false),
  smtpUser: process.env.AFFETTA_SMTP_USER || '',
  smtpPass: process.env.AFFETTA_SMTP_PASS || '',
  smtpHelo: process.env.AFFETTA_SMTP_HELO || 'affetta.local',
  kiriCliCommand: process.env.KIRI_CLI_COMMAND || '',
  dataDir,
  artifactDir: path.join(dataDir, 'artifacts'),
  uploadDir: path.join(dataDir, 'uploads'),
  mailOutboxDir: path.join(dataDir, 'mail-outbox'),
  publicDir: path.join(ROOT, 'public')
});
