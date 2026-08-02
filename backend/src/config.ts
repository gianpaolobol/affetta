import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendError } from './errors.js';

export interface BackendConfig {
  mode: 'memory' | 'production';
  host: string;
  port: number;
  publicBaseUrl: string;
  databaseUrl: string | null;
  redisUrl: string | null;
  s3: {
    endpoint: string | null;
    region: string;
    bucket: string;
    accessKeyId: string | null;
    secretAccessKey: string | null;
    forcePathStyle: boolean;
    signedUrlTtlSeconds: number;
    verifyMaxBytes: number;
  };
  leaseSeconds: number;
  leaseRenewSeconds: number;
  maxAttempts: number;
  retryBaseSeconds: number;
  retentionHours: number;
  maxJsonBytes: number;
  bootstrapOrganizationId: string;
  bootstrapOrganizationName: string;
  bootstrapApiKey: string | null;
  bootstrapPairingCode: string | null;
  contractsRoot: string;
  allowInsecureMemoryDefaults: boolean;
}

function integer(name: string, value: string | undefined, fallback: number, min = 0): number {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new BackendError('invalid_configuration', `${name} non valido.`, { statusCode: 500 });
  }
  return parsed;
}

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  const mode = env.AFFETTA_BACKEND_MODE === 'production' ? 'production' : 'memory';
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultContractsRoot = path.resolve(moduleDir, '..', '..', '..', 'schemas');

  const config: BackendConfig = {
    mode,
    host: env.AFFETTA_BACKEND_HOST || '127.0.0.1',
    port: integer('AFFETTA_BACKEND_PORT', env.AFFETTA_BACKEND_PORT, 8790, 1),
    publicBaseUrl: (env.AFFETTA_BACKEND_PUBLIC_URL || 'http://127.0.0.1:8790').replace(/\/$/, ''),
    databaseUrl: env.DATABASE_URL || null,
    redisUrl: env.REDIS_URL || null,
    s3: {
      endpoint: env.S3_ENDPOINT || null,
      region: env.S3_REGION || 'eu-central-1',
      bucket: env.S3_BUCKET || 'affetta-artifacts',
      accessKeyId: env.S3_ACCESS_KEY_ID || null,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY || null,
      forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, true),
      signedUrlTtlSeconds: integer('S3_SIGNED_URL_TTL_SECONDS', env.S3_SIGNED_URL_TTL_SECONDS, 900, 60),
      verifyMaxBytes: integer('S3_VERIFY_MAX_BYTES', env.S3_VERIFY_MAX_BYTES, 250_000_000, 1)
    },
    leaseSeconds: integer('AFFETTA_LEASE_SECONDS', env.AFFETTA_LEASE_SECONDS, 180, 30),
    leaseRenewSeconds: integer('AFFETTA_LEASE_RENEW_SECONDS', env.AFFETTA_LEASE_RENEW_SECONDS, 180, 30),
    maxAttempts: integer('AFFETTA_JOB_MAX_ATTEMPTS', env.AFFETTA_JOB_MAX_ATTEMPTS, 3, 1),
    retryBaseSeconds: integer('AFFETTA_RETRY_BASE_SECONDS', env.AFFETTA_RETRY_BASE_SECONDS, 30, 1),
    retentionHours: integer('AFFETTA_ARTIFACT_RETENTION_HOURS', env.AFFETTA_ARTIFACT_RETENTION_HOURS, 72, 1),
    maxJsonBytes: integer('AFFETTA_MAX_JSON_BYTES', env.AFFETTA_MAX_JSON_BYTES, 2_000_000, 1024),
    bootstrapOrganizationId: env.AFFETTA_BOOTSTRAP_ORG_ID || 'org_affetta_local',
    bootstrapOrganizationName: env.AFFETTA_BOOTSTRAP_ORG_NAME || 'Affetta Local',
    bootstrapApiKey: env.AFFETTA_BOOTSTRAP_API_KEY || null,
    bootstrapPairingCode: env.AFFETTA_BOOTSTRAP_PAIRING_CODE || null,
    contractsRoot: env.AFFETTA_CONTRACTS_ROOT || defaultContractsRoot,
    allowInsecureMemoryDefaults: bool(env.AFFETTA_ALLOW_INSECURE_MEMORY_DEFAULTS, mode === 'memory')
  };

  if (mode === 'production') {
    const missing: string[] = [];
    if (!config.databaseUrl) missing.push('DATABASE_URL');
    if (!config.redisUrl) missing.push('REDIS_URL');
    if (!config.s3.accessKeyId) missing.push('S3_ACCESS_KEY_ID');
    if (!config.s3.secretAccessKey) missing.push('S3_SECRET_ACCESS_KEY');
    if (!config.bootstrapApiKey) missing.push('AFFETTA_BOOTSTRAP_API_KEY');
    if (missing.length > 0) {
      throw new BackendError('missing_configuration', `Configurazione produzione incompleta: ${missing.join(', ')}`, {
        statusCode: 500,
        details: { missing }
      });
    }
  }

  return config;
}
