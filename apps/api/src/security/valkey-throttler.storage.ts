import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';

/**
 * Record shape returned by `ThrottlerStorage.increment`. Mirrors
 * `@nestjs/throttler`'s internal `ThrottlerStorageRecord` (which is not
 * re-exported from the public entry, so we re-declare the minimal fields
 * we actually populate). ponytail: copy the four fields; the package
 * reserves the right to add more, but we don't read them.
 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Lua script implementing an atomic increment-and-maybe-block on a single
 * round-trip. ioredis exposes `defineCommand` so the script is cached on
 * the client (SHA1-evalsha after the first EVAL). Three guarantees:
 *
 *   1. **Atomicity** — INCR + first-hit EXPIRE + block check all run
 *      inside one Redis script. Concurrent requests cannot slip past the
 *      limit because they cannot interleave between INCR and PEXPIRE.
 *   2. **First-hit TTL** — PEXPIRE is only set when the counter goes
 *      from 0 -> 1 (i.e. the key was just created). Subsequent hits
 *      leave the TTL alone so a sustained burst of N requests inside
 *      the window does not extend the window.
 *   3. **Block window** — when totalHits > limit, a separate "block"
 *      key is set with the blockDuration TTL. The script reads it back
 *      so the caller sees `isBlocked=true` until the block expires.
 *
 * ponytail: the in-memory ThrottlerStorageService uses setTimeout per hit
 * to decrement on expiry. We can't replicate that cheaply across instances
 * so we lean on Redis keyspace TTLs instead — cheaper, no per-hit timer
 * pressure, and exactly-correct on a Redis restart (keys expire on their
 * own clock).
 */
const INCREMENT_LUA = `
local counter = redis.call('INCR', KEYS[1])
if counter == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttlMs = redis.call('PTTL', KEYS[1])
local blocked = redis.call('EXISTS', KEYS[2])
if blocked == 0 and counter > tonumber(ARGV[2]) then
  redis.call('PSETEX', KEYS[2], ARGV[3], '1')
  blocked = 1
end
local blockTtlMs = redis.call('PTTL', KEYS[2])
return {counter, ttlMs, blocked, blockTtlMs}
`;

/** "Failing open" record — no hits, no block. Returning this lets the
 *  guard's check pass on Valkey errors so a cache outage doesn't take
 *  down auth. The trade-off: an attacker who can both DoS Valkey AND
 *  hit auth harder than the per-IP limit can bypass it briefly; that's
 *  strictly better than locking every legitimate user out. */
const FAIL_OPEN_RECORD: ThrottlerStorageRecord = Object.freeze({
  totalHits: 0,
  timeToExpire: 0,
  isBlocked: false,
  timeToBlockExpire: 0,
});

/**
 * Redis-backed ThrottlerStorage. Counts are shared across instances so a
 * brute-force attacker can't multiply their budget by hitting different
 * replicas behind a load balancer.
 *
 * Key shape:
 *   `throttle:{name}:{key}`       — counter with first-hit PEXPIRE = ttl
 *   `throttle:{name}:{key}:block` — block marker with PSETEX = blockDuration
 *
 * The client is owned by `ValkeyService` (DI-injected) — we don't own the
 * lifecycle, Nest closes it once on shutdown.
 */
@Injectable()
export class ValkeyThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(ValkeyThrottlerStorage.name);

  constructor(private readonly client: Redis) {
    // `defineCommand` returns a typed wrapper; cast because ioredis
    // infers the signature from the script and we don't expose it.
    this.client.defineCommand('throttlerIncrement', { numberOfKeys: 2, lua: INCREMENT_LUA });
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    // Skip the round-trip when Valkey isn't ready (cold start, restart,
    // network blip). ThrottlerGuard's `isBlocked` check sees the
    // FAIL_OPEN_RECORD and lets the request through.
    if (this.client.status !== 'ready') {
      return FAIL_OPEN_RECORD;
    }
    const counterKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `${counterKey}:block`;
    // ttl/blockDuration arrive in milliseconds (per @nestjs/throttler API).
    try {
      const result = (await (this.client as unknown as {
        throttlerIncrement: (k1: string, k2: string, ttl: number, limit: number, block: number) => Promise<[number, number, number, number]>;
      }).throttlerIncrement(counterKey, blockKey, ttl, limit, blockDuration)) as [number, number, number, number];

      const [totalHits, timeToExpireMs, isBlockedRaw, timeToBlockExpireMs] = result;
      // Redis returns -1 (no TTL) or -2 (no key) for PTTL in edge cases;
      // clamp to zero so the guard's Retry-After header is sensible.
      return {
        totalHits,
        timeToExpire: timeToExpireMs > 0 ? Math.ceil(timeToExpireMs / 1000) : 0,
        isBlocked: isBlockedRaw === 1,
        timeToBlockExpire: timeToBlockExpireMs > 0 ? Math.ceil(timeToBlockExpireMs / 1000) : 0,
      };
    } catch (err) {
      // Fail-open: don't take the API down on a Valkey outage. The
      // downstream trade-off is logged so operators can see when this
      // is happening in production (alerts on the log line, not on
      // 500s).
      this.logger.error({ err: String(err) }, '[throttler] Valkey unavailable, failing open');
      return FAIL_OPEN_RECORD;
    }
  }
}