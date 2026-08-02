import type { JobRecord, ReadyQueue } from '../types.js';

interface RedisClientLike {
  connect(): Promise<void>;
  ping(): Promise<string>;
  zAdd(key: string, values: Array<{ score: number; value: string }>): Promise<number>;
  zRangeByScore(key: string, min: number | string, max: number | string, options?: Record<string, unknown>): Promise<string[]>;
  hSet(key: string, field: string, value: string): Promise<number>;
  hmGet(key: string, fields: string[]): Promise<Array<string | null>>;
  multi(): { zRem(key: string, member: string): unknown; hDel(key: string, field: string): unknown; exec(): Promise<unknown> };
  quit(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

export class RedisReadyQueue implements ReadyQueue {
  private constructor(private readonly client: RedisClientLike, private readonly prefix: string) {}

  static async connect(url: string, prefix = 'affetta'): Promise<RedisReadyQueue> {
    const moduleName = 'redis';
    const imported = await import(moduleName) as { createClient(options: { url: string }): RedisClientLike };
    const client = imported.createClient({ url });
    client.on('error', () => undefined);
    await client.connect();
    return new RedisReadyQueue(client, prefix);
  }

  private get readyKey(): string { return `${this.prefix}:jobs:ready`; }
  private get priorityKey(): string { return `${this.prefix}:jobs:priority`; }

  async health(): Promise<{ ok: boolean; detail?: string }> {
    try {
      const pong = await this.client.ping();
      return { ok: pong === 'PONG', detail: pong };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  async notifyReady(job: JobRecord): Promise<void> {
    await Promise.all([
      this.client.zAdd(this.readyKey, [{ score: new Date(job.next_attempt_at).getTime(), value: job.id }]),
      this.client.hSet(this.priorityKey, job.id, String(job.priority))
    ]);
  }

  async candidates(limit: number, now: string): Promise<string[]> {
    const ids = await this.client.zRangeByScore(this.readyKey, 0, new Date(now).getTime(), {
      LIMIT: { offset: 0, count: Math.max(limit, limit * 5) }
    });
    if (ids.length <= 1) return ids;
    const priorities = await this.client.hmGet(this.priorityKey, ids);
    return ids
      .map((id, index) => ({ id, priority: Number.parseInt(priorities[index] ?? '0', 10) || 0, index }))
      .sort((left, right) => right.priority - left.priority || left.index - right.index)
      .slice(0, limit)
      .map((item) => item.id);
  }

  async remove(jobId: string): Promise<void> {
    const tx = this.client.multi();
    tx.zRem(this.readyKey, jobId);
    tx.hDel(this.priorityKey, jobId);
    await tx.exec();
  }

  async close(): Promise<void> { await this.client.quit(); }
}
