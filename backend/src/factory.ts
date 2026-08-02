import { DefaultIdFactory, DefaultTokenFactory } from './crypto.js';
import { createAjvContractValidator, StructuralContractValidator } from './contracts.js';
import type { BackendConfig } from './config.js';
import { BackendHttpApi } from './http.js';
import { BackendService, SystemClock, type BackendDependencies } from './service.js';
import { MemoryArtifactStorage, MemoryBackendRepository, MemoryReadyQueue } from './adapters/memory.js';
import { PgBackendRepository } from './adapters/postgres.js';
import { RedisReadyQueue } from './adapters/redis.js';
import { S3ArtifactStorage } from './adapters/s3.js';
import type { ArtifactStorage, BackendRepository, ContractValidator, ReadyQueue } from './types.js';
import { MetricsRegistry } from './metrics.js';

export interface BackendRuntime {
  service: BackendService;
  api: BackendHttpApi;
  repository: BackendRepository;
  queue: ReadyQueue;
  storage: ArtifactStorage;
  metrics: MetricsRegistry;
  close(): Promise<void>;
}

export async function createBackendRuntime(config: BackendConfig, overrides: Partial<BackendDependencies> = {}): Promise<BackendRuntime> {
  const repository = overrides.repository ?? (config.mode === 'production'
    ? await PgBackendRepository.connect(config.databaseUrl!)
    : new MemoryBackendRepository());
  const queue = overrides.queue ?? (config.mode === 'production'
    ? await RedisReadyQueue.connect(config.redisUrl!)
    : new MemoryReadyQueue());
  const storage = overrides.storage ?? (config.mode === 'production'
    ? await S3ArtifactStorage.create({
        ...config.s3,
        accessKeyId: config.s3.accessKeyId!,
        secretAccessKey: config.s3.secretAccessKey!
      })
    : new MemoryArtifactStorage());
  let validator: ContractValidator;
  if (overrides.validator) validator = overrides.validator;
  else {
    try { validator = await createAjvContractValidator(config.contractsRoot); }
    catch (error) {
      if (config.mode === 'production') throw error;
      validator = new StructuralContractValidator();
    }
  }
  const metrics = overrides.metrics ?? new MetricsRegistry();
  const service = new BackendService({
    config,
    repository,
    queue,
    storage,
    validator,
    clock: overrides.clock ?? new SystemClock(),
    ids: overrides.ids ?? new DefaultIdFactory(),
    tokens: overrides.tokens ?? new DefaultTokenFactory(),
    metrics
  });
  await service.bootstrap();
  return {
    service,
    api: new BackendHttpApi(service, metrics),
    repository,
    queue,
    storage,
    metrics,
    async close(): Promise<void> {
      await Promise.allSettled([repository.close(), queue.close(), storage.close()]);
    }
  };
}
