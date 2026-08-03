import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(moduleDir, '..');

function integer(value, fallback, min = 0) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed >= min ? parsed : fallback;
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function resolveCredential(value) {
  if (!value || typeof value !== 'string') return value ?? null;
  const match = /^env:([A-Z0-9_]+)$/.exec(value);
  return match ? process.env[match[1]] || null : value;
}

export function loadServerLiteConfig(env = process.env) {
  const configPath = path.resolve(env.AFFETTA_SERVER_LITE_CONFIG || path.join(packageRoot, 'config', 'local-server.json'));
  const fileConfig = readJson(configPath);
  const dataDir = path.resolve(env.AFFETTA_SERVER_LITE_DATA_DIR || fileConfig.data_dir || path.join(packageRoot, 'data'));
  const printers = Array.isArray(fileConfig.printers) ? fileConfig.printers.map((printer) => ({
    id: String(printer.id || '').trim(),
    name: String(printer.name || printer.id || '').trim(),
    model: String(printer.model || 'Stampante 3D').trim(),
    adapter: String(printer.adapter || 'mock').trim(),
    endpoint: printer.endpoint ? String(printer.endpoint).replace(/\/$/, '') : null,
    enabled: printer.enabled !== false,
    api_key: resolveCredential(printer.api_key),
    access_code: resolveCredential(printer.access_code),
    serial: resolveCredential(printer.serial),
    options: printer.options && typeof printer.options === 'object' ? printer.options : {}
  })).filter((printer) => printer.id && printer.name) : [];

  return {
    config_path: configPath,
    host: env.AFFETTA_SERVER_LITE_HOST || fileConfig.host || '127.0.0.1',
    port: integer(env.AFFETTA_SERVER_LITE_PORT || fileConfig.port, 8791, 1),
    poll_seconds: integer(env.AFFETTA_SERVER_LITE_POLL_SECONDS || fileConfig.poll_seconds, 15, 5),
    request_timeout_ms: integer(env.AFFETTA_SERVER_LITE_REQUEST_TIMEOUT_MS || fileConfig.request_timeout_ms, 5000, 500),
    data_dir: dataDir,
    database_path: path.resolve(dataDir, fileConfig.database_file || 'affetta-server-lite.sqlite'),
    api_token: resolveCredential(env.AFFETTA_SERVER_LITE_API_TOKEN || fileConfig.api_token) || null,
    printers
  };
}
