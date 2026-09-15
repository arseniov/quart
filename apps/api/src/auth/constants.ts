/**
 * Short TTL for the Valkey session cache lines (positive 'ok' from
 * JwtAuthGuard, negative 'revoked' poison from sign-out / guard misses).
 * JWT lifetime bounds the true expiry; this is just the cache freshness
 * horizon. Drift between the guard's positive cache and the sign-out's
 * poison line would invert fail-open/closed behavior, so the value lives
 * here exactly once.
 */
export const SESSION_CACHE_TTL_SECONDS = 60;
