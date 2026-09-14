import type { INestApplication } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { SwaggerModule } from '@nestjs/swagger';

import {
  type SwaggerEnv,
  SwaggerEnvSchema,
  resolveSwaggerEnabled,
} from './swagger-env.js';
import { buildSwaggerBuilder, swaggerUiOptions } from './swagger.config.js';

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
 * Failure mode: env parse throws on a malformed `SWAGGER_PATH` /
 * `SWAGGER_JSON_PATH` — caught here only for the narrow "env is
 * structurally invalid" case so a misconfigured `SWAGGER_*` doesn't
 * crash the rest of the app. Boot logs the details; the rest of the
 * API keeps running.
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
    new Logger('OpenApi').warn(
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

  const builder = buildSwaggerBuilder(env);
  const document = SwaggerModule.createDocument(app, builder.build());

  // Path normalisation: SwaggerModule.setup expects no leading slash
  // (it normalises internally). The JSON path keeps the leading slash
  // because `@nestjs/swagger`'s `jsonDocumentUrl` accepts it.
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
}
