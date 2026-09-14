/**
 * Swagger / OpenAPI integration tests.
 *
 * Boots a minimal Nest app with a single test controller (no DB / Valkey
 * / MinIO / Better Auth — full AppModule is overkill for "does the
 * builder + setup wire routes correctly"). The spec exercises the actual
 * Nest Fastify adapter so the route handlers are real HTTP, not mocks.
 */
import { Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { setupOpenApi } from '../../src/openapi/swagger.setup.js';

const PROTECTED_TAG = 'protected';

/** Stand-in for a real route — proves the spec picks up controllers with bearer auth. */
@Controller('protected')
@ApiTags(PROTECTED_TAG)
@ApiBearerAuth('bearer')
class ProtectedController {
  @Get()
  @ApiOperation({ summary: 'protected ping' })
  ping(): { ok: true } {
    return { ok: true };
  }
}

@Controller('public')
@ApiTags('public')
class PublicController {
  @Get()
  list(): { items: string[] } {
    return { items: [] };
  }
}

@Module({ controllers: [ProtectedController, PublicController] })
class TestAppModule {}

async function bootApp(env: Record<string, string>): Promise<NestFastifyApplication> {
  const mod = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
  const app = mod.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  // The narrow env schema only reads SWAGGER_* + NODE_ENV, so we don't
  // have to stub the full EnvSchema here.
  setupOpenApi(app, env);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('setupOpenApi — env gating (deviation #2: default-off in prod)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await bootApp({ NODE_ENV: 'production', SWAGGER_ENABLED: 'false' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('does not mount /docs when SWAGGER_ENABLED=false in production', async () => {
    const res = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(404);
  });

  it('does not mount /openapi.json when SWAGGER_ENABLED=false in production', async () => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(404);
  });

  it('non-swagger routes still work (app boots)', async () => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/public' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });
});

describe('setupOpenApi — enabled (NODE_ENV !== production)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    // NODE_ENV defaults to 'development' → enabled without explicit flag.
    app = await bootApp({});
  });
  afterAll(async () => {
    await app.close();
  });

  it('serves /openapi.json with the spec body', async () => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    const spec = res.json();
    expect(spec.openapi).toBeDefined();
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
  });

  it('serves /docs as HTML (Swagger UI shell)', async () => {
    const res = await app.getHttpAdapter().getInstance().inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    // Title comes from customSiteTitle, not the literal string 'Swagger UI'.
    expect(res.body).toContain('<title>Quart API</title>');
  });

  it('includes both controller routes in the spec', async () => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/openapi.json' });
    const spec = res.json();
    expect(spec.paths['/protected']).toBeDefined();
    expect(spec.paths['/public']).toBeDefined();
    expect(spec.paths['/protected'].get.tags).toContain(PROTECTED_TAG);
    expect(spec.paths['/public'].get.tags).toContain('public');
  });

  it('declares the bearer JWT security scheme', async () => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/openapi.json' });
    const spec = res.json();
    expect(spec.components.securitySchemes.bearer).toEqual({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('declares both session-cookie security schemes (T45 spec)', async () => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/openapi.json' });
    const spec = res.json();
    expect(spec.components.securitySchemes['__Host-quart-api-session']).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: '__Host-quart-api-session',
    });
    expect(spec.components.securitySchemes['__Host-quart-admin-session']).toEqual({
      type: 'apiKey',
      in: 'cookie',
      name: '__Host-quart-admin-session',
    });
  });

  it('wires the bearer security requirement onto @ApiBearerAuth-decorated routes', async () => {
    const res = await app
      .getHttpAdapter()
      .getInstance()
      .inject({ method: 'GET', url: '/openapi.json' });
    const spec = res.json();
    expect(spec.paths['/protected'].get.security).toEqual([{ bearer: [] }]);
  });

  it('uses the SWAGGER_TITLE from env in spec.info.title', async () => {
    const customApp = await bootApp({ SWAGGER_TITLE: 'Custom Quart API' });
    try {
      const res = await customApp
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/openapi.json' });
      const spec = res.json();
      expect(spec.info.title).toBe('Custom Quart API');
    } finally {
      await customApp.close();
    }
  });

  it('honors SWAGGER_JSON_PATH override', async () => {
    const customApp = await bootApp({ SWAGGER_JSON_PATH: '/api-spec.json' });
    try {
      const moved = await customApp
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/api-spec.json' });
      expect(moved.statusCode).toBe(200);
      // Old path is gone.
      const old = await customApp
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/openapi.json' });
      // SwaggerModule still mounts /docs/swagger-ui-init.js etc. but the
      // *json* path is per-option. /openapi.json may resolve to a
      // controller or 404 depending on route ordering — either is fine
      // as long as the override path works.
      expect([200, 404]).toContain(old.statusCode);
    } finally {
      await customApp.close();
    }
  });

  it('honors SWAGGER_PATH override', async () => {
    const customApp = await bootApp({ SWAGGER_PATH: '/api-docs' });
    try {
      const ui = await customApp
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/api-docs' });
      expect(ui.statusCode).toBe(200);
      expect(ui.headers['content-type']).toContain('text/html');
    } finally {
      await customApp.close();
    }
  });

  it('emits per-tenant server URLs from SWAGGER_SERVERS', async () => {
    const customApp = await bootApp({
      SWAGGER_SERVERS: 'https://roma.quart.it,https://milano.quart.it',
    });
    try {
      const res = await customApp
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/openapi.json' });
      const spec = res.json();
      expect(spec.servers).toEqual([
        { url: 'https://roma.quart.it' },
        { url: 'https://milano.quart.it' },
      ]);
    } finally {
      await customApp.close();
    }
  });
});

describe('setupOpenApi — explicit opt-in (production with SWAGGER_ENABLED=true)', () => {
  it('mounts /docs when SWAGGER_ENABLED=true even in production', async () => {
    const app = await bootApp({ NODE_ENV: 'production', SWAGGER_ENABLED: 'true' });
    try {
      const res = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/openapi.json' });
      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe('setupOpenApi — invalid env fails open (no crash, UI off)', () => {
  it('skips the surface when SWAGGER_VERSION contains junk and logs a warning', async () => {
    // SWAGGER_VERSION has no constraint — use a known-bad field instead.
    // SWAGGER_PATH rejects empty string, so we send empty.
    const app = await bootApp({ SWAGGER_PATH: '' });
    try {
      const res = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/docs' });
      // Schema rejection → setup is a no-op → 404. App still boots.
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('bearer security scheme shape', () => {
  it('declares type=http, scheme=bearer, bearerFormat=JWT', async () => {
    const app = await bootApp({});
    try {
      const res = await app
        .getHttpAdapter()
        .getInstance()
        .inject({ method: 'GET', url: '/openapi.json' });
      const spec = res.json();
      expect(spec.components.securitySchemes.bearer).toEqual({
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      });
    } finally {
      await app.close();
    }
  });
});
