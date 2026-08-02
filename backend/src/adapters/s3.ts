import { createHash } from 'node:crypto';
import { BackendError } from '../errors.js';
import type { ArtifactRecord, ArtifactStorage, SignedTransfer } from '../types.js';

interface S3Config {
  endpoint: string | null;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  signedUrlTtlSeconds: number;
  verifyMaxBytes: number;
}

interface S3ClientLike {
  send(command: unknown): Promise<Record<string, unknown>>;
  destroy(): void;
}

export class S3ArtifactStorage implements ArtifactStorage {
  private constructor(
    private readonly config: S3Config,
    private readonly client: S3ClientLike,
    private readonly commands: {
      PutObjectCommand: new (input: Record<string, unknown>) => unknown;
      GetObjectCommand: new (input: Record<string, unknown>) => unknown;
      HeadObjectCommand: new (input: Record<string, unknown>) => unknown;
    },
    private readonly getSignedUrl: (client: S3ClientLike, command: unknown, options: { expiresIn: number }) => Promise<string>
  ) {}

  static async create(config: S3Config): Promise<S3ArtifactStorage> {
    const s3ModuleName = '@aws-sdk/client-s3';
    const presignerModuleName = '@aws-sdk/s3-request-presigner';
    const s3 = await import(s3ModuleName) as {
      S3Client: new (input: Record<string, unknown>) => S3ClientLike;
      PutObjectCommand: new (input: Record<string, unknown>) => unknown;
      GetObjectCommand: new (input: Record<string, unknown>) => unknown;
      HeadObjectCommand: new (input: Record<string, unknown>) => unknown;
    };
    const presigner = await import(presignerModuleName) as {
      getSignedUrl(client: S3ClientLike, command: unknown, options: { expiresIn: number }): Promise<string>;
    };
    const client = new s3.S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    });
    return new S3ArtifactStorage(config, client, s3, presigner.getSignedUrl);
  }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const command = new this.commands.HeadObjectCommand({ Bucket: this.config.bucket, Key: '__affetta_health__' });
      await this.client.send(command).catch((error: unknown) => {
        const status = typeof error === 'object' && error !== null && '$metadata' in error
          ? Number((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode)
          : 0;
        if (status !== 404) throw error;
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async prepareUpload(artifact: ArtifactRecord): Promise<SignedTransfer> {
    const command = new this.commands.PutObjectCommand({
      Bucket: this.config.bucket,
      Key: artifact.storage_key,
      ContentType: artifact.media_type
    });
    return {
      artifact_id: artifact.id,
      url: await this.getSignedUrl(this.client, command, { expiresIn: this.config.signedUrlTtlSeconds }),
      method: 'PUT',
      headers: { 'content-type': artifact.media_type }
    };
  }

  async prepareDownload(artifact: ArtifactRecord): Promise<SignedTransfer> {
    const command = new this.commands.GetObjectCommand({ Bucket: this.config.bucket, Key: artifact.storage_key });
    return {
      artifact_id: artifact.id,
      url: await this.getSignedUrl(this.client, command, { expiresIn: this.config.signedUrlTtlSeconds }),
      method: 'GET'
    };
  }

  async verify(artifact: ArtifactRecord, expected: { sha256: string; size_bytes: number }): Promise<void> {
    if (expected.size_bytes > this.config.verifyMaxBytes) {
      throw new BackendError('artifact_verification_limit', 'Artefatto oltre il limite di verifica streaming configurato.', {
        statusCode: 422,
        details: { size_bytes: expected.size_bytes, verify_max_bytes: this.config.verifyMaxBytes }
      });
    }
    const head = await this.client.send(new this.commands.HeadObjectCommand({
      Bucket: this.config.bucket,
      Key: artifact.storage_key
    }));
    const contentLength = Number(head.ContentLength ?? -1);
    if (contentLength !== expected.size_bytes) {
      throw new BackendError('artifact_size_mismatch', 'Dimensione S3 diversa da quella dichiarata.', {
        statusCode: 422,
        details: { expected: expected.size_bytes, actual: contentLength }
      });
    }
    const response = await this.client.send(new this.commands.GetObjectCommand({
      Bucket: this.config.bucket,
      Key: artifact.storage_key
    }));
    const body = response.Body as AsyncIterable<Uint8Array> | undefined;
    if (!body || typeof body[Symbol.asyncIterator] !== 'function') {
      throw new BackendError('artifact_body_unavailable', 'Stream S3 non disponibile per la verifica.', { statusCode: 502, retryable: true });
    }
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of body) {
      hash.update(chunk);
      bytes += chunk.byteLength;
      if (bytes > this.config.verifyMaxBytes) {
        throw new BackendError('artifact_verification_limit', 'Limite di verifica artefatto superato.', { statusCode: 422 });
      }
    }
    const actualHash = hash.digest('hex');
    if (bytes !== expected.size_bytes || actualHash !== expected.sha256) {
      throw new BackendError('artifact_checksum_mismatch', 'Checksum o dimensione S3 non corrispondenti.', {
        statusCode: 422,
        details: { expected, actual: { sha256: actualHash, size_bytes: bytes } }
      });
    }
  }

  async close(): Promise<void> { this.client.destroy(); }
}
