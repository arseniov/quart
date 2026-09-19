/**
 * OpenAPI export to `packages/shared-contracts/src/openapi.json` (T46).
 *
 * Builds the OpenAPI document from controller metadata WITHOUT booting the
 * Nest DI graph — that path needs Postgres / Valkey / MinIO / BullMQ / OTel,
 * which we explicitly avoid here.
 *
 * The trick: `@nestjs/swagger`'s `SwaggerExplorer.exploreController` only
 * reads decorator metadata on controller methods (route path, @ApiOperation,
 * @ApiBody, @ApiResponse, etc.). It doesn't invoke any handler. So we feed
 * it `InstanceWrapper`s whose `instance` is `Object.create(prototype)`
 * — a "ghost" instance that has all the prototype methods but never ran the
 * constructor. Decorators fire when `Reflect.getMetadata` walks the class
 * shape, so route paths / schemas / tags are all captured correctly.
 *
 * Linux-only: paths use POSIX separators and `git` is invoked without a
 * `.exe` suffix. Windows runners are out of scope for now.
 *
 * Usage:
 *   pnpm --filter @quart/api run export:openapi
 *
 * Env overrides (all optional):
 *   OPENAPI_OUTPUT_PATH — defaults to packages/shared-contracts/src/openapi.json
 *   OPENAPI_BEAUTIFY    — 'false' to emit minified JSON (default true)
 *   SWAGGER_TITLE / SWAGGER_DESCRIPTION / SWAGGER_VERSION / SWAGGER_SERVERS
 *                     — narrow env, parsed via SwaggerEnvSchema
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
import { AdminDashboardController } from '../admin/admin-dashboard.controller.js';
import { AdminDlqController } from '../admin/admin-dlq.controller.js';
import { AdminI18nController } from '../admin/admin-i18n.controller.js';
import { AdminIdeasController } from '../admin/admin-ideas.controller.js';
import { AdminOfficersController } from '../admin/admin-officers.controller.js';
import { AdminPollsController } from '../admin/admin-polls.controller.js';
import { AdminRolesController } from '../admin/admin-roles.controller.js';
import { AdminSettingsController } from '../admin/admin-settings.controller.js';
import { AdminTaxonomiesController } from '../admin/admin-taxonomies.controller.js';
import { AdminUsersController } from '../admin/admin-users.controller.js';
import { AdminIssuesController } from '../admin-issues/admin-issues.controller.js';
import { VerifyController } from '../audit/verify.controller.js';
import { AuthController } from '../auth/auth.controller.js';
import { MfaController } from '../auth/mfa.controller.js';
import { PhoneOtpController } from '../auth/phone-otp.controller.js';
import { CitiesController } from '../cities/cities.controller.js';
import { CommentsController } from '../comments/comments.controller.js';
import { readAppVersion } from '../common/app-version.js';
import { HealthController } from '../health/health.controller.js';
import { I18nController } from '../i18n/i18n.controller.js';
import { IdeasController } from '../ideas/ideas.controller.js';
import { IssuesController } from '../issues/issues.controller.js';
import { NotificationsController } from '../notifications/notifications.controller.js';
import { SseController } from '../notifications/sse.controller.js';
import { MetricsController } from '../observability/metrics.controller.js';
import {
  atomicWriteJson,
  diffOpenApi,
  readExistingSpec,
  readGitShortSha,
  resolveOutputPath,
  sortOpenApiKeys,
} from '../openapi/spec-export.js';
import { parseSwaggerServers, SwaggerEnvSchema } from '../openapi/swagger-env.js';
import {
  SWAGGER_ADMIN_COOKIE_NAME,
  SWAGGER_API_COOKIE_NAME,
  SWAGGER_BEARER_NAME,
} from '../openapi/swagger.config.js';
import { PollsController } from '../polls/polls.controller.js';
import { SavedItemsController } from '../saved-items/saved-items.controller.js';
import { SearchController } from '../search/search.controller.js';
import { SelfController } from '../self/self.controller.js';
import { TopicsController } from '../topics/topics.controller.js';
import { UploadsController } from '../uploads/uploads.controller.js';
import { UsersController } from '../users/users.controller.js';

export const DEFAULT_OPENAPI_OUTPUT_PATH = 'packages/shared-contracts/src/openapi.json';

// Metadata key `@nestjs/swagger` writes for `@ApiTags('foo')`. We read it
// directly off each controller class to populate the top-level `tags` array
// without re-parsing every operation. Mirrors the constant in
// `node_modules/@nestjs/swagger/dist/constants.js`.
const API_TAGS_METADATA = 'swagger/apiUseTags';

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
  AdminDashboardController,
  AdminDlqController,
  AdminI18nController,
  AdminIdeasController,
  AdminOfficersController,
  AdminPollsController,
  AdminRolesController,
  AdminSettingsController,
  AdminTaxonomiesController,
  AdminUsersController,
  AdminIssuesController,
  VerifyController,
  AuthController,
  MfaController,
  PhoneOtpController,
  CitiesController,
  CommentsController,
  HealthController,
  I18nController,
  IdeasController,
  IssuesController,
  NotificationsController,
  SseController,
  MetricsController,
  PollsController,
  SavedItemsController,
  SearchController,
  SelfController,
  TopicsController,
  UploadsController,
  UsersController,
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
}

interface ExplorerLike {
  exploreController(
    wrapper: InstanceWrapper,
    config: ApplicationConfig,
    modulePath: string,
    globalPrefix: string,
  ): unknown;
  getSchemas(): Record<string, unknown>;
}

function buildDocument(input: SwaggerBuilderInput): Record<string, unknown> {
  const applicationConfig = new ApplicationConfig();
  const schemaFactory = new SchemaObjectFactory(
    new ModelPropertiesAccessor(),
    new SwaggerTypesMapper(),
  );
  const explorer = new SwaggerExplorer(schemaFactory) as unknown as ExplorerLike;

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
    try {
      const result = explorer.exploreController(
        wrapper,
        applicationConfig,
        '' /* modulePath */,
        '' /* globalPrefix */,
      ) as unknown as unknown[];
      denormalized.push(...result);
    } catch (err) {
      // A single malformed decorator shouldn't lose every other controller's
      // paths. Log and skip — the spec is still useful for the routes that
      // did parse, and the operator sees the failure in CI logs.
      const ctorName = (wrapper.metatype as { name?: string })?.name ?? 'unknown';
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack?.split('\n').slice(0, 5).join('\n') : '';
      process.stderr.write(`export-openapi: skipping ${ctorName}: ${msg}\n${stack}\n`);
    }
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

  // Security schemes — bearer JWT plus the two canonical cookie names,
  // mirroring `swagger.config.ts` exactly. Drift between the runtime
  // Swagger UI and the exported spec would make the cookie names an
  // operator-facing lie.
  const securitySchemes: Record<string, unknown> = {
    [SWAGGER_BEARER_NAME]: {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'EdDSA',
      description: 'Ed25519-signed JWT issued by /auth/login.',
    },
    [SWAGGER_API_COOKIE_NAME]: {
      type: 'apiKey',
      in: 'cookie',
      name: SWAGGER_API_COOKIE_NAME,
      description: 'Better Auth session cookie for the mobile PWA (HTTP-only).',
    },
    [SWAGGER_ADMIN_COOKIE_NAME]: {
      type: 'apiKey',
      in: 'cookie',
      name: SWAGGER_ADMIN_COOKIE_NAME,
      description: 'Better Auth session cookie for the admin console (HTTP-only).',
    },
  };

  // Top-level `tags` — the union of every `@ApiTags('foo')` declaration on
  // the registered controllers, sorted for stable diffs. Pulled directly
  // from class metadata so adding a new controller automatically extends
  // the list (no separate registry to maintain).
  const tags = collectTags();

  const document: Record<string, unknown> = {
    openapi: '3.0.3',
    info: {
      title: input.title,
      description: input.description,
      version: input.version,
    },
    servers: input.servers ?? [],
    tags,
    paths,
    components: {
      securitySchemes,
      schemas,
      // Zod-based DTOs aren't introspectable via `@nestjs/swagger`'s
      // class-decorator scan. They are validated at the controller
      // boundary via the global ZodValidationPipe but their JSON-Schema
      // shape isn't auto-registered into `components.schemas`. This
      // extension flag exists so a downstream generator can detect the
      // gap and either (a) skip schema generation or (b) hand-wire the
      // missing `components.schemas` entries via `@ApiExtraModels`.
      'x-schemas-note':
        'DTOs use Zod schemas (see apps/api/src/**/*.dto.ts). Wire `zod-to-openapi` or annotate with @ApiExtraModels to populate components.schemas.',
    },
  };

  return document;
}

function collectTags(): Array<{ name: string }> {
  const seen = new Set<string>();
  for (const ControllerCtor of CONTROLLERS) {
    const tags = Reflect.getMetadata(API_TAGS_METADATA, ControllerCtor) as unknown;
    if (Array.isArray(tags)) {
      for (const t of tags) {
        if (typeof t === 'string') seen.add(t);
      }
    }
  }
  return [...seen].sort().map((name) => ({ name }));
}

/**
 * Generate the OpenAPI document from controller metadata, normalised
 * for stable diffs. Reused by the `export:openapi` writer and the
 * `check:openapi-drift` script — same input → same bytes.
 *
 * Reads from `process.env` via `SwaggerEnvSchema`. Pure relative to env:
 * no I/O outside `readAppVersion()` (which reads `apps/api/package.json`
 * from `cwd`), no writes.
 */
export function generateSpec(): Record<string, unknown> {
  const swaggerEnv = SwaggerEnvSchema.parse(process.env);

  // `info.version` — env override wins, else pull from apps/api/package.json,
  // else fall back to a labelled placeholder so a missing manifest is loud
  // (not silent) in the exported spec.
  const envVersion = swaggerEnv.SWAGGER_VERSION;
  const pkgVersion = readAppVersion();
  const version = envVersion || pkgVersion || '0.0.0';
  if (!envVersion && pkgVersion === null) {
    process.stderr.write(
      'export-openapi: SWAGGER_VERSION unset and package.json unreadable — falling back to 0.0.0\n',
    );
  }

  const rawDocument = buildDocument({
    title: swaggerEnv.SWAGGER_TITLE,
    description: swaggerEnv.SWAGGER_DESCRIPTION,
    version,
    servers: parseSwaggerServers(swaggerEnv.SWAGGER_SERVERS).map((url) => ({ url })),
  });

  return sortOpenApiKeys(rawDocument);
}

async function main(): Promise<void> {
  const sorted = generateSpec();

  const workspaceRoot = resolve(process.cwd(), '../..');

  const rawPath =
    process.env.OPENAPI_OUTPUT_PATH?.trim() || DEFAULT_OPENAPI_OUTPUT_PATH;
  const beautify = (process.env.OPENAPI_BEAUTIFY ?? 'true') !== 'false';
  const { absolute, relative: relativePath } = resolveOutputPath(rawPath, workspaceRoot);

  const previous = readExistingSpec(absolute);
  const { bytes } = await atomicWriteJson(absolute, sorted, beautify ? 2 : undefined);

  const delta = diffOpenApi(previous, sorted);

  const summary = {
    outputPath: relativePath,
    bytes,
    beautify,
    paths: Object.keys((sorted.paths as Record<string, unknown> | undefined) ?? {}).length,
    controllers: CONTROLLERS.length,
    tags: (sorted.tags as Array<{ name: string }>).length,
    securitySchemes: Object.keys(
      (sorted.components as { securitySchemes?: Record<string, unknown> })?.securitySchemes ?? {},
    ),
    delta,
    gitSha: readGitShortSha(workspaceRoot),
  };
  process.stdout.write(JSON.stringify(summary) + '\n');
}

main().catch((err: unknown) => {
  if (err instanceof Error) {
    process.stderr.write(`export-openapi failed: ${err.message}\n${err.stack}\n`);
  } else {
    process.stderr.write(`export-openapi failed: ${String(err)}\n`);
  }
  process.exit(1);
});
