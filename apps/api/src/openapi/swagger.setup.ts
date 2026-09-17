import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';

import {
  type SwaggerEnv,
  SwaggerEnvSchema,
  resolveSwaggerEnabled,
} from './swagger-env.js';
import { buildSwaggerBuilder, swaggerUiOptions } from './swagger.config.js';

const openApiLogger = new Logger('OpenApi');

/**
 * Lazy setup hook for the OpenAPI surface. Parses the narrow
 * `SwaggerEnvSchema` independently from the app `EnvSchema` so workers,
 * scripts, and the `export-openapi` job (T46) can reuse the same builder
 * without DB / Valkey / MinIO.
 *
 * Returns `{ enabled, uiPath, jsonPath, document }` so the caller (or
 * test) can decide whether to mount Swagger UI. When disabled we still
 * return `null` for `document` so there's no accidental exposure of the
 * spec.
 *
 * Failure modes:
 *   - env parse fails → warn, return disabled (UI never mounted)
 *   - `resolveSwaggerEnabled` returns false → return disabled (no log)
 *   - `SwaggerModule.createDocument` / `SwaggerModule.setup` throw →
 *     log via pino-shaped logger and skip the surface entirely. Boot
 *     continues; the rest of the API is unaffected.
 */
export interface OpenApiSetupResult {
  readonly enabled: boolean;
  readonly uiPath: string;
  readonly jsonPath: string;
  readonly document: Record<string, unknown> | null;
}

export function setupOpenApi(
  app: INestApplication,
  envInput: NodeJS.ProcessEnv | Partial<SwaggerEnv>,
): OpenApiSetupResult {
  const parsed = SwaggerEnvSchema.safeParse(envInput);
  if (!parsed.success) {
    openApiLogger.warn(
      `swagger env invalid: ${JSON.stringify(parsed.error.flatten().fieldErrors)} — UI disabled`,
    );
    return {
      enabled: false,
      uiPath: '',
      jsonPath: '',
      document: null,
    };
  }
  const env = parsed.data;
  if (!resolveSwaggerEnabled(env)) {
    return {
      enabled: false,
      uiPath: env.SWAGGER_PATH,
      jsonPath: env.SWAGGER_JSON_PATH,
      document: null,
    };
  }

  try {
    const builder = buildSwaggerBuilder(env);
    const document = SwaggerModule.createDocument(app, builder.build());

    // Path normalisation: SwaggerModule.setup expects no leading slash
    // (it normalises internally). The JSON path keeps the leading slash
    // because `@nestjs/swagger`'s `jsonDocumentUrl` accepts it. Both
    // are accepted with or without the leading slash, but we pick one
    // for consistency — leading on JSON, no leading on UI.
    const uiPath = env.SWAGGER_PATH.replace(/^\/+/, '');
    SwaggerModule.setup(uiPath, app, document, {
      ...swaggerUiOptions,
      jsonDocumentUrl: env.SWAGGER_JSON_PATH,
    });

    return {
      enabled: true,
      uiPath: env.SWAGGER_PATH,
      jsonPath: env.SWAGGER_JSON_PATH,
      document: document as unknown as Record<string, unknown>,
    };
  } catch (err) {
    // Boot must not crash on a swagger failure. The rest of the surface
    // (controllers, Fastify, plugins) is independent of the docs UI.
    openApiLogger.error(
      `swagger setup failed: ${err instanceof Error ? err.message : String(err)} — UI disabled`,
    );
    return {
      enabled: false,
      uiPath: env.SWAGGER_PATH,
      jsonPath: env.SWAGGER_JSON_PATH,
      document: null,
    };
  }
}