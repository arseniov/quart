import type { RedisOptions } from 'bullmq';

/** Parse a Valkey/Redis URL into the connection options BullMQ/ioredis expects.
 *  URL shape: `redis://[user:pass@]host:port[/db]`. */
export function parseValkeyUrl(url: string): RedisOptions {
  const u = new URL(url);
  const db = u.pathname && u.pathname !== '/' ? Number.parseInt(u.pathname.slice(1), 10) : 0;
  const opts: RedisOptions = {
    host: u.hostname,
    port: u.port ? Number.parseInt(u.port, 10) : 6379,
    db: Number.isFinite(db) ? db : 0,
  };
  if (u.username) opts.username = decodeURIComponent(u.username);
  if (u.password) opts.password = decodeURIComponent(u.password);
  return opts;
}