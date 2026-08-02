import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { AgentError } from './errors.js';

export interface AgentConfig {
  cloudBaseUrl: string;
  localBaseUrl: string;
  localApiKey: string;
  pairingCode: string;
  agentName: string;
  dataDir: string;
  downloadDir: string;
  uploadDir: string;
  logDir: string;
  databasePath: string;
  secretKeyPath: string;
  pidPath: string;
  artifactAllowedHosts: Set<string>;
  pollMs: number;
  heartbeatMs: number;
  leaseRenewMs: number;
  httpTimeoutMs: number;
  localJobTimeoutMs: number;
  maxDownloadBytes: number;
  allowInsecureHttp: boolean;
}

function loadEnvFile(file = path.resolve('.env')): void {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function boolEnv(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeBaseUrl(value: string, label: string): string {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new AgentError('invalid_configuration', `${label} non è un URL valido.`, { stage: 'configuration' }); }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function assertCloudUrl(url: string, allowInsecure: boolean): void {
  const parsed = new URL(url);
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(allowInsecure && local)) {
    throw new AgentError('insecure_cloud_url', 'Il backend cloud deve usare HTTPS.', { stage: 'configuration' });
  }
}

function assertLoopbackUrl(url: string): void {
  const parsed = new URL(url);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new AgentError('local_affetta_not_loopback', 'Affetta locale deve essere raggiunto soltanto su loopback.', { stage: 'configuration' });
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new AgentError('invalid_local_protocol', 'Protocollo Affetta locale non supportato.', { stage: 'configuration' });
  }
}

export function loadConfig(): AgentConfig {
  loadEnvFile();
  const allowInsecureHttp = boolEnv('AFFETTA_AGENT_ALLOW_INSECURE_HTTP', false);
  const rawCloudBaseUrl = process.env.AFFETTA_CLOUD_BASE_URL?.trim() || '';
  if (!rawCloudBaseUrl) throw new AgentError('missing_cloud_url', 'AFFETTA_CLOUD_BASE_URL è obbligatorio.', { stage: 'configuration' });
  const cloudBaseUrl = normalizeBaseUrl(rawCloudBaseUrl, 'AFFETTA_CLOUD_BASE_URL');
  const localBaseUrl = normalizeBaseUrl(process.env.AFFETTA_LOCAL_BASE_URL || 'http://127.0.0.1:8787', 'AFFETTA_LOCAL_BASE_URL');
  assertCloudUrl(cloudBaseUrl, allowInsecureHttp);
  assertLoopbackUrl(localBaseUrl);

  const dataDir = path.resolve(process.env.AFFETTA_AGENT_DATA_DIR || path.join(process.cwd(), 'agent-data'));
  const cloudHost = new URL(cloudBaseUrl).host.toLowerCase();
  const hosts = new Set<string>(
    (process.env.AFFETTA_ARTIFACT_ALLOWED_HOSTS || cloudHost)
      .split(',')
      .map((value: string) => value.trim().toLowerCase())
      .filter(Boolean)
  );

  const config: AgentConfig = {
    cloudBaseUrl,
    localBaseUrl,
    localApiKey: process.env.AFFETTA_LOCAL_API_KEY || '',
    pairingCode: process.env.AFFETTA_PAIRING_CODE || '',
    agentName: (process.env.AFFETTA_AGENT_NAME || 'Affetta Agent').slice(0, 120),
    dataDir,
    downloadDir: path.join(dataDir, 'downloads'),
    uploadDir: path.join(dataDir, 'uploads'),
    logDir: path.join(dataDir, 'logs'),
    databasePath: path.join(dataDir, 'agent.db'),
    secretKeyPath: path.join(dataDir, 'secret.key'),
    pidPath: path.join(dataDir, 'agent.pid'),
    artifactAllowedHosts: hosts,
    pollMs: numberEnv('AFFETTA_AGENT_POLL_MS', 5000, 1000, 300000),
    heartbeatMs: numberEnv('AFFETTA_AGENT_HEARTBEAT_MS', 30000, 5000, 3600000),
    leaseRenewMs: numberEnv('AFFETTA_AGENT_LEASE_RENEW_MS', 15000, 5000, 300000),
    httpTimeoutMs: numberEnv('AFFETTA_HTTP_TIMEOUT_MS', 30000, 1000, 300000),
    localJobTimeoutMs: numberEnv('AFFETTA_LOCAL_JOB_TIMEOUT_MS', 3600000, 60000, 86400000),
    maxDownloadBytes: Math.round(numberEnv('AFFETTA_MAX_DOWNLOAD_MB', 25, 1, 4096) * 1024 * 1024),
    allowInsecureHttp
  };

  for (const directory of [config.dataDir, config.downloadDir, config.uploadDir, config.logDir]) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  return config;
}

export function assertArtifactUrl(config: AgentConfig, rawUrl: string): URL {
  let parsed: URL;
  try { parsed = new URL(rawUrl); }
  catch { throw new AgentError('invalid_artifact_url', 'URL firmato non valido.', { stage: 'transfer' }); }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(config.allowInsecureHttp && local)) {
    throw new AgentError('insecure_artifact_url', 'Download e upload richiedono HTTPS.', { stage: 'transfer' });
  }
  if (!config.artifactAllowedHosts.has(parsed.host.toLowerCase())) {
    throw new AgentError('artifact_host_not_allowed', 'Host dello storage non autorizzato.', {
      stage: 'transfer',
      details: { host: parsed.host }
    });
  }
  return parsed;
}
