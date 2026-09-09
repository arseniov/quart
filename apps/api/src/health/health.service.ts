import { Injectable } from '@nestjs/common';
import { createDb, sql } from '@quart/db';
import { Redis } from 'ioredis';
import { Client as MinioClient } from 'minio';

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';

export type ProbeStatus = 'ok' | 'down';

export interface ProbeResult {
  postgres: ProbeStatus;
  valkey: ProbeStatus;
  minio: ProbeStatus;
}

const PROBE_TIMEOUT_MS = 5000;

const withTimeout = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), PROBE_TIMEOUT_MS),
    ),
  ]);

@Injectable()
export class HealthService {
  private readonly redis: Redis;
  private readonly minio: MinioClient;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis(config.env.VALKEY_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
    this.minio = new MinioClient({
      endPoint: config.env.MINIO_ENDPOINT,
      useSSL: false,
      accessKey: config.env.MINIO_ACCESS_KEY,
      secretKey: config.env.MINIO_SECRET_KEY,
    });
    this.bucket = config.env.MINIO_BUCKET_PRIVATE;
  }

  async probe(): Promise<ProbeResult> {
    const [pg, vk, mn] = await Promise.all([
      this.checkPg(),
      this.checkValkey(),
      this.checkMinio(),
    ]);
    return { postgres: pg, valkey: vk, minio: mn };
  }

  private async checkPg(): Promise<ProbeStatus> {
    const db = createDb({ connectionString: this.config.env.DATABASE_URL });
    try {
      await withTimeout(sql`select 1`.execute(db));
      return 'ok';
    } catch {
      return 'down';
    } finally {
      await db.destroy();
    }
  }

  private async checkValkey(): Promise<ProbeStatus> {
    try {
      const pong = await withTimeout(this.redis.ping());
      return pong === 'PONG' ? 'ok' : 'down';
    } catch {
      return 'down';
    }
  }

  private async checkMinio(): Promise<ProbeStatus> {
    try {
      const exists = await withTimeout(this.minio.bucketExists(this.bucket));
      return exists ? 'ok' : 'down';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.redis.disconnect();
  }
}
