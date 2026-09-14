import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DocumentBuilder, type SwaggerCustomOptions } from '@nestjs/swagger';

import {
  type SwaggerEnv,
  parseSwaggerServers,
  redactSecrets,
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
 * Build a `DocumentBuilder` from a parsed `SwaggerEnv`. Returns the
 * builder (not the document) so `SwaggerModule.createDocument()` can
 * run in `OpenApiModule` — that keeps the env → options → document
 * pipeline in one place.
 *
 * The default options below match the spec:
 *   - bearer JWT security scheme (deviation #3)
 *   - per-city server URLs from `SWAGGER_SERVERS` (deviation #6)
 *   - redacted description (deviation #9)
 *   - version falls back to apps/api/package.json when `SWAGGER_VERSION`
 *     is empty so dev / CI builds don't have to remember to bump it.
 */
export function buildSwaggerBuilder(env: SwaggerEnv): DocumentBuilder {
  const builder = new DocumentBuilder()
    .setTitle(env.SWAGGER_TITLE)
    .setVersion(env.SWAGGER_VERSION || readAppVersion())
    .setDescription(redactSecrets(env.SWAGGER_DESCRIPTION));

  for (const url of parseSwaggerServers(env.SWAGGER_SERVERS)) {
    builder.addServer(url);
  }

  builder.addBearerAuth(
    { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    SWAGGER_BEARER_NAME,
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
