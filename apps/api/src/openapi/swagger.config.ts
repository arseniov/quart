import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentBuilder, type SwaggerCustomOptions } from '@nestjs/swagger';

import { cookieNameFor } from '../auth/cookie.policy.js';
import {
  type SwaggerEnv,
  parseSwaggerServers,
  redactSecretNames,
} from './swagger-env.js';

/**
 * Canonical name for the JWT bearer security scheme. Every controller
 * that needs `@ApiBearerAuth()` must pass this exact string — the
 * document builder registers it under this key, and `@nestjs/swagger`
 * wires the `security` requirement into the operation only when the
 * names line up.
 */
export const SWAGGER_BEARER_NAME = 'bearer';

/**
 * Canonical names for the two session-cookie security schemes. The
 * spec (T45) requires both `__Host-quart-api-session` (mobile client)
 * and `__Host-quart-admin-session` (admin console) — using the same
 * `__Host-` prefix the runtime enforces, so the spec matches the actual
 * cookie name the browser will send.
 *
 * Source of truth: `apps/api/src/auth/cookie.policy.ts`. We import the
 * names from there so a future rename can't drift between the OpenAPI
 * surface and the cookie the server actually sets.
 */
export const SWAGGER_API_COOKIE_NAME = cookieNameFor('mobile');
export const SWAGGER_ADMIN_COOKIE_NAME = cookieNameFor('admin');

/**
 * Build a `DocumentBuilder` from a parsed `SwaggerEnv`. Returns the
 * builder (not the document) so `SwaggerModule.createDocument()` can
 * run in `OpenApiModule` — that keeps the env → options → document
 * pipeline in one place.
 *
 * Security schemes (per T45 spec):
 *   - bearer JWT for programmatic clients / SDKs
 *   - `__Host-quart-api-session` cookie for the mobile PWA
 *   - `__Host-quart-admin-session` cookie for the admin console
 *
 * Per-city server URLs come from `SWAGGER_SERVERS`. Description is
 * run through `redactSecretNames` before it reaches the spec so an
 * operator who pastes `SECRET_FOO=abc` into the env can't leak it.
 *
 * Version falls back to apps/api/package.json when `SWAGGER_VERSION`
 * is empty so dev / CI builds don't have to remember to bump it.
 */
export function buildSwaggerBuilder(env: SwaggerEnv): DocumentBuilder {
  const builder = new DocumentBuilder()
    .setTitle(env.SWAGGER_TITLE)
    .setVersion(env.SWAGGER_VERSION || readAppVersion())
    .setDescription(redactSecretNames(env.SWAGGER_DESCRIPTION));

  for (const url of parseSwaggerServers(env.SWAGGER_SERVERS)) {
    builder.addServer(url);
  }

  builder
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      SWAGGER_BEARER_NAME,
    )
    // Third arg is the `securitySchemes` key. We pass the cookie name so
    // the key matches what `@nestjs/swagger` would emit if you read it
    // back from the spec — operators looking at the spec can grep the
    // cookie name without learning a separate "cookie1/cookie2" alias.
    .addCookieAuth(
      SWAGGER_API_COOKIE_NAME,
      { type: 'apiKey', in: 'cookie', name: SWAGGER_API_COOKIE_NAME },
      SWAGGER_API_COOKIE_NAME,
    )
    .addCookieAuth(
      SWAGGER_ADMIN_COOKIE_NAME,
      { type: 'apiKey', in: 'cookie', name: SWAGGER_ADMIN_COOKIE_NAME },
      SWAGGER_ADMIN_COOKIE_NAME,
    );

  return builder;
}

/**
 * UI-level options passed to `SwaggerModule.setup()`. Kept separate from
 * the document builder because they apply to the HTML shell, not the
 * spec payload.
 *
 *   - `persistAuthorization`: dev convenience — auth survives page
 *     reloads so the operator doesn't re-paste the JWT on every refresh.
 *   - `customSiteTitle`: replaces "Swagger UI" in the browser tab.
 *   - `explorer: false` (default): hides the top-bar search box. Cheap
 *     noise reduction for a per-tenant API where the surface is small.
 *
 * `customCss` / "Try it out" toggle (deviation #7): left enabled by
 * default. Every operation is already JWT-gated, so the "Try it out"
 * button just hits the same authenticated endpoint a real client would.
 * Disable it via a future `SWAGGER_DISABLE_TRY_OUT=true` flag when an
 * untrusted-network deployment actually needs it.
 */
export const swaggerUiOptions: SwaggerCustomOptions = {
  swaggerOptions: {
    persistAuthorization: true,
  },
  customSiteTitle: 'Quart API',
};

function readAppVersion(): string {
  try {
    const pkgPath = join(process.cwd(), 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    // ponytail: failure mode is "spec gets version 0.0.0". Surface this
    // through `info.version` — a missing package.json is a deploy bug
    // worth noticing, not crashing over.
    return '0.0.0';
  }
}