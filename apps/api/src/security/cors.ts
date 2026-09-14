import type { FastifyCorsOptions } from '@fastify/cors';

import { type SecurityEnv, parseAllowedOrigins } from './security-env.js';

const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const ALLOWED_HEADERS = ['Authorization', 'Content-Type', 'X-Request-ID', 'X-Trace-Context'];
const EXPOSED_HEADERS = ['X-Request-ID', 'X-Trace-Context', 'Retry-After'];
const PREFLIGHT_MAX_AGE_SECONDS = 600;

export interface CorsBuildOptions {
  readonly env: SecurityEnv;
}

/**
 * Build `@fastify/cors` plugin options from a narrow security env.
 *
 * Strictness contract:
 *   - Empty `CORS_ALLOWED_ORIGINS` → no `Access-Control-Allow-Origin` header
 *     emitted. Same-origin / server-to-server traffic only. Browsers will
 *     refuse cross-origin reads.
 *   - Origin match → `Access-Control-Allow-Origin: <echo>` + (when
 *     `CORS_ALLOW_CREDENTIALS=true`) `Access-Control-Allow-Credentials: true`.
 *   - Origin mismatch → `false` from the delegator → no CORS header → browser
 *     blocks. Preflight returns `403` from @fastify/cors.
 *   - We never emit `*`. The delegator returns a specific origin or `false`.
 *   - `*` + credentials is rejected at config time (paranoia guard for the
 *     "I read a tutorial" deployment).
 */
export function buildCorsOptions({ env }: CorsBuildOptions): FastifyCorsOptions {
  const allowed = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

  // ponytail: defensive guard. The delegator never echoes `*`, but a typo
  // that flips it on would expose every credentialed endpoint. Drop the
  // process if a future contributor wires both.
  if (env.CORS_ALLOW_CREDENTIALS && allowed.size === 0) {
    throw new Error(
      'CORS_ALLOW_CREDENTIALS=true requires at least one entry in CORS_ALLOWED_ORIGINS',
    );
  }

  if (allowed.size === 0) {
    // No CORS — pass `false` so @fastify/cors emits no `Access-Control-*` headers.
    return {
      origin: false,
      methods: ALLOWED_METHODS,
      allowedHeaders: ALLOWED_HEADERS,
      exposedHeaders: EXPOSED_HEADERS,
      maxAge: PREFLIGHT_MAX_AGE_SECONDS,
      strictPreflight: true,
      optionsSuccessStatus: 204,
    };
  }

  return {
    // Origin function form: echoes the origin when matched, returns false
    // otherwise (which produces no Access-Control-Allow-Origin header).
    origin: (origin, cb) => {
      if (origin === undefined) {
        // Same-origin / server-to-server (no Origin header). Allow through
        // without CORS headers — caller doesn't need them.
        cb(null, false);
        return;
      }
      cb(null, allowed.has(origin));
    },
    credentials: env.CORS_ALLOW_CREDENTIALS,
    methods: ALLOWED_METHODS,
    allowedHeaders: ALLOWED_HEADERS,
    exposedHeaders: EXPOSED_HEADERS,
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
    strictPreflight: true,
    optionsSuccessStatus: 204,
  };
}

/**
 * Test-friendly snapshot of the configured CORS surface. Pulled out so unit
 * tests can assert against the exact methods / headers without standing up
 * a full Fastify app.
 */
export interface CorsSurface {
  readonly methodsAllowed: ReadonlyArray<string>;
  readonly headersAllowed: ReadonlyArray<string>;
  readonly headersExposed: ReadonlyArray<string>;
  readonly preflightMaxAgeSeconds: number;
}

export function describeCorsSurface(): CorsSurface {
  return {
    methodsAllowed: ALLOWED_METHODS,
    headersAllowed: ALLOWED_HEADERS,
    headersExposed: EXPOSED_HEADERS,
    preflightMaxAgeSeconds: PREFLIGHT_MAX_AGE_SECONDS,
  };
}
