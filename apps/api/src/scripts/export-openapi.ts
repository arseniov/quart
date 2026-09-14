/**
 * OpenAPI export to `packages/shared-contracts/openapi.json` (T46).
 *
 * Builds the OpenAPI document from controller metadata WITHOUT booting the
 * Nest DI graph — that path needs Postgres / Valkey / MinIO / BullMQ / OTel,
 * which we explicitly avoid here.
 *
 * The trick: `@nestjs/swagger`'s `SwaggerExplorer.exploreController` only
 * reads decorator metadata on controller methods (route path, @ApiOperation,
 * @ApiBody, @ApiResponse, etc.). It doesn't invoke any handler. So we feed
 * it `InstanceWrapper`s whose `instance` is `Object.create(controller.prototype)`
 * — a "ghost" instance that has all the prototype methods but never ran the
 * constructor. Decorators fire when `Reflect.getMetadata` walks the class
 * shape, so route paths / schemas / tags are all captured correctly.
 *
 * Usage:
 *   pnpm --filter @quart/api run export:openapi
 *
 * Env overrides (all optional):
 *   OPENAPI_OUTPUT_PATH — defaults to packages/shared-contracts/openapi.json
 *   OPENAPI_BEAUTIFY    — 'false' to emit minified JSON (default true)
 *
 * No side-effects: writes only to `OPENAPI_OUTPUT_PATH`. CI compares the
 * committed copy to this run's output and fails if they differ.
 */
import 'reflect-metadata';

import { resolve } from 'node:path';

import { ApplicationConfig } from '@nestjs/core';
// Deep imports — these classes aren't part of @nestjs/* public API, but they
// are exactly what `SwaggerModule.createDocument` uses internally. We import
// them directly to skip Nest DI entirely (see file header).
import { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper.js';
import { ModelPropertiesAccessor } from '@nestjs/swagger/dist/services/model-properties-accessor.js';
import { SchemaObjectFactory } from '@nestjs/swagger/dist/services/schema-object-factory.js';
import { SwaggerTypesMapper } from '@nestjs/swagger/dist/services/swagger-types-mapper.js';
import { SwaggerExplorer } from '@nestjs/swagger/dist/swagger-explorer.js';

import { AdminAuditController } from '../admin/admin-audit.controller.js';
import { AdminCitiesController } from '../admin/admin-cities.controller.js';
import { AdminI18nController } from '../admin/admin-i18n.controller.js';
import { AdminIdeasController } from '../admin/admin-ideas.controller.js';
import { AdminOfficersController } from '../admin/admin-officers.controller.js';
import { AdminPollsController } from '../admin/admin-polls.controller.js';
import { AdminRolesController } from '../admin/admin-roles.controller.js';
import { AdminSettingsController } from '../admin/admin-settings.controller.js';
import { AdminTaxonomiesController } from '../admin/admin-taxonomies.controller.js';
import { AdminUsersController } from '../admin/admin-users.controller.js';
import { AdminIssuesController } from '../admin-issues/admin-issues.controller.js';
import { CitiesController } from '../cities/cities.controller.js';
import { CommentsController } from '../comments/comments.controller.js';
import { HealthController } from '../health/health.controller.js';
import { I18nController } from '../i18n/i18n.controller.js';
import { IdeasController } from '../ideas/ideas.controller.js';
import { IssuesController } from '../issues/issues.controller.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { SseController } from '../notifications/sse.controller.js';
import { MetricsController } from '../observability/metrics.controller.js';
import {
  annotateWithGitSha,
  atomicWriteJson,
  diffOpenApi,
  readExistingSpec,
  readGitShortSha,
  resolveOutputPath,
  sortOpenApiKeys,
} from '../openapi/spec-export.js';
import { SwaggerEnvSchema } from '../openapi/swagger-env.js';
import { PollsController } from '../polls/polls.controller.js';
import { SavedItemsController } from '../saved-items/saved-items.controller.js';
import { SearchController } from '../search/search.controller.js';
import { SelfController } from '../self/self.controller.js';
import { TopicsController } from '../topics/topics.controller.js';
import { UploadsController } from '../uploads/uploads.controller.js';

export const DEFAULT_OPENAPI_OUTPUT_PATH = 'packages/shared-contracts/openapi.json';

// ---------------------------------------------------------------------------
// Controller registry — the explicit list of controllers that participate in
// the export. Adding a controller means adding the line below; nothing else.
// We deliberately DON'T import the module classes (they'd pull in services).
// Importing just the controller class is enough — `reflect-metadata` is loaded
// once at the top of this file so decorator metadata is available.
// ---------------------------------------------------------------------------

const CONTROLLERS: Array<new (...args: never[]) => unknown> = [
  AdminAuditController,
  AdminCitiesController,
  AdminI18nController,
  AdminIdeasController,
  AdminOfficersController,
  AdminPollsController,
  AdminRolesController,
  AdminSettingsController,
  AdminTaxonomiesController,
  AdminUsersController,
  AdminIssuesController,
  CitiesController,
  CommentsController,
  HealthController,
  IdeasController,
  IssuesController,
  I18nController,
  NotificationsController,
  SseController,
  PollsController,
  SavedItemsController,
  SearchController,
  SelfController,
  TopicsController,
  UploadsController,
  MetricsController,
];

// ---------------------------------------------------------------------------
// Spec assembly — `ApplicationConfig` + `SwaggerExplorer` are the same pieces
// `SwaggerModule.createDocument` uses internally; we just bypass the module
// resolver and feed the explorer our hand-built wrappers.
// ---------------------------------------------------------------------------

interface SwaggerBuilderInput {
  title: string;
  description: string;
  version: string;
  servers?: Array<{ url: string; description?: string }>;
  bearerSecurityName?: string;
}

function buildDocument(input: SwaggerBuilderInput): Record<string, unknown> {
  const applicationConfig = new ApplicationConfig();
  const schemaFactory = new SchemaObjectFactory(
    new ModelPropertiesAccessor(),
    new SwaggerTypesMapper(),
  );
  const explorer = new SwaggerExplorer(schemaFactory);

  const wrappers: InstanceWrapper[] = CONTROLLERS.map((ControllerCtor) => {
    // Ghost instance — `Object.create(prototype)` skips constructor but keeps
    // all prototype methods so `Object.getPrototypeOf(instance)` works for
    // the metadata scanner. Decorator metadata is class-level (attached to
    // the prototype via `Reflect.defineMetadata`), so it's preserved.
    const ghost = Object.create(ControllerCtor.prototype) as Record<string, unknown>;
    const wrapper = new InstanceWrapper({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      metatype: ControllerCtor as unknown as any,
      instance: ghost,
    });
    return wrapper;
  });

  const denormalized: unknown[] = [];
  for (const wrapper of wrappers) {
    const result = explorer.exploreController(
      wrapper,
      applicationConfig,
      '' /* modulePath */,
      '' /* globalPrefix */,
    ) as unknown as unknown[];
    denormalized.push(...result);
  }

  // The explorer's `exploreController` returns denormalized paths — one entry
  // per (controller.method, route) — with the shape `{ root, security, tags,
  // responses, ... }`. We re-normalize into `{ paths, components }`.
  const paths: Record<string, Record<string, unknown>> = {};
  const schemas = explorer.getSchemas();

  for (const entry of denormalized) {
    const e = entry as { root?: { path?: string; method?: string } };
    const path = e.root?.path;
    const method = e.root?.method;
    if (!path || !method) continue;
    const op: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) {
      if (k !== 'root') op[k] = v;
    }
    if (!paths[path]) paths[path] = {};
    paths[path][method] = op;
  }

  // Security schemes — bearer JWT plus cookie auth, matching T45.
  const bearerName = input.bearerSecurityName ?? 'bearer';
  const securitySchemes: Record<string, unknown> = {
    [bearerName]: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'EdDSA',
      description: 'Ed25519-signed JWT issued by /auth/login.',
    },
    'cookie-auth': {
      type: 'apiKey',
      in: 'cookie',
      name: 'quart_session',
      description: 'Better Auth session cookie (HTTP-only).',
    },
  };

  const document: Record<string, unknown> = {
    openapi: '3.0.3',
    info: {
      title: input.title,
      description: input.description,
      version: input.version,
    },
    servers: input.servers ?? [],
    paths,
    components: {
      securitySchemes,
      schemas,
    },
    tags: [],
  };

  return document;
}

async function main(): Promise<void> {
  const swaggerEnv = SwaggerEnvSchema.parse(process.env);

  const rawDocument = buildDocument({
    title: swaggerEnv.SWAGGER_TITLE,
    description: swaggerEnv.SWAGGER_DESCRIPTION,
    version: swaggerEnv.SWAGGER_VERSION || '0.0.0',
    servers: parseSwaggerServers(swaggerEnv.SWAGGER_SERVERS),
  });

  const workspaceRoot = resolve(process.cwd(), '../..');
  const sorted = sortOpenApiKeys(rawDocument);
  const withSha = annotateWithGitSha(sorted, readGitShortSha(workspaceRoot));

  const rawPath =
    process.env.OPENAPI_OUTPUT_PATH?.trim() || DEFAULT_OPENAPI_OUTPUT_PATH;
  const beautify = (process.env.OPENAPI_BEAUTIFY ?? 'true') !== 'false';
  const { absolute, relative: relativePath } = resolveOutputPath(rawPath, workspaceRoot);

  const previous = readExistingSpec(absolute);
  const { bytes } = await atomicWriteJson(absolute, withSha, beautify ? 2 : undefined);

  const delta = diffOpenApi(previous, withSha);

  const summary = {
    outputPath: relativePath,
    bytes,
    beautify,
    paths: Object.keys((withSha.paths as Record<string, unknown> | undefined) ?? {}).length,
    delta,
    gitSha: readGitShortSha(workspaceRoot),
  };
  process.stdout.write(JSON.stringify(summary) + '\n');
}

function parseSwaggerServers(raw: string): Array<{ url: string; description?: string }> {
  if (!raw.trim()) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => ({ url }));
}

main().catch((err: unknown) => {
  if (err instanceof Error) {
    process.stderr.write(`export-openapi failed: ${err.message}\n${err.stack}\n`);
  } else {
    process.stderr.write(`export-openapi failed: ${String(err)}\n`);
  }
  process.exit(1);
});
