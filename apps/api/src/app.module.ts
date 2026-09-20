import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AdminModule } from './admin/admin.module.js';
import { AdminIssuesModule } from './admin-issues/admin-issues.module.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BaAuthGuard } from './auth/ba-auth.guard.js';
import { CitiesModule } from './cities/cities.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { TenantContextInterceptor } from './common/tenant-context.interceptor.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { I18nModule } from './i18n/i18n.module.js';
import { IdeasModule } from './ideas/ideas.module.js';
import { IssuesModule } from './issues/issues.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SseModule } from './notifications/sse.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { SlowQueryMiddleware } from './observability/slow-query.middleware.js';
import { PollsModule } from './polls/polls.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RbacModule } from './rbac/rbac.module.js';
import { SavedItemsModule } from './saved-items/saved-items.module.js';
import { SearchModule } from './search/search.module.js';
import { ThrottlerEnvSchema } from './security/throttler-env.js';
import { throttlerModuleForRootAsync } from './security/throttler.config.js';
import { SelfModule } from './self/self.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { UploadsModule } from './uploads/uploads.module.js';
import { UsersModule } from './users/users.module.js';

/**
 * Try to parse the throttler env. Wrapped in a try/catch so a missing
 * or malformed env var doesn't kill the whole app boot — the throttler
 * is non-critical and the failure is logged. Nest DI's `useFactory`
 * already runs lazily, so test rigs that pre-set `process.env` will
 * see the right values when the factory is invoked.
 *
 * ponytail: Zod throws on the first issue; we map to `THROTTLE_ENABLED=false`
 * so the throttler degrades to a no-op rather than blocking boot. The
 * cost: a typo in the env silently disables rate limiting — logged
 * loudly so the operator sees it.
 */
function parseThrottlerEnvOrDefault() {
  try {
    return ThrottlerEnvSchema.parse(process.env);
  } catch (err) {
     
    console.error('[throttler] env parse failed; disabling throttler:', err);
    return ThrottlerEnvSchema.parse({ THROTTLE_ENABLED: false });
  }
}

@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    HealthModule,
    DbModule,
    AuthModule,
    AuditModule,
    RbacModule,
    CitiesModule,
    TopicsModule,
    CommentsModule,
    IssuesModule,
    AdminIssuesModule,
    IdeasModule,
    PollsModule,
    QueueModule,
    SearchModule,
    I18nModule,
    NotificationsModule,
    SseModule,
    SavedItemsModule,
    SelfModule,
    AdminModule,
    UploadsModule,
    UsersModule,
    ObservabilityModule,
    // ThrottlerModule is registered AFTER AuthModule so the factory's
    // `inject: [ValkeyService]` resolves. ValkeyService is exported by
    // AuthModule. We register `ThrottlerModule.forRootAsync` in two
    // shapes depending on THROTTLE_ENABLED (parsed lazily inside the
    // factory so process.env edits between module load and NestFactory
    // create still take effect).
    ...buildThrottlerImport(),
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Global BaAuthGuard — controllers opt out with @Public(). Future
    // protected controllers opt IN with `@UseGuards(BaAuthGuard)` on the
    // specific handler(s) that need the user attached. Replaces the
    // GH #33-era JwtAuthGuard; BA session validation runs here so BA's
    // own /auth/* endpoints can reuse the same guard without leaking the
    // Quart JWT pair. GH #44.
    { provide: APP_GUARD, useClass: BaAuthGuard },
    // Conditionally wire ThrottlerGuard. When THROTTLE_ENABLED=false the
    // provider list is empty so the guard is never instantiated and the
    // @Throttle() decorators are effectively metadata-only.
    ...(parseThrottlerEnvOrDefault().THROTTLE_ENABLED
      ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
      : []),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // RequestId runs first so req.id is set when SlowQuery logs; SlowQuery
    // runs second so its `res.on('finish')` observer is registered before
    // downstream handlers can flush the response. Nest 10 doesn't expose
    // `.after()` on the consumer — pass both in order to a single apply().
    consumer.apply(RequestIdMiddleware, SlowQueryMiddleware).forRoutes('*');
  }
}

/**
 * Returns the imports array for the throttler module. When disabled,
 * returns a no-op `ThrottlerModule` import — the decorators stay
 * valid but no work happens.
 */
function buildThrottlerImport() {
  const env = parseThrottlerEnvOrDefault();
  if (!env.THROTTLE_ENABLED) {
    // No-op module — ThrottlerModule is registered as global so the
    // Decorator metadata doesn't error, but with zero throttlers nothing
    // is checked.
    return [{ module: ThrottlerModule, global: true }];
  }
  return [ThrottlerModule.forRootAsync(throttlerModuleForRootAsync(env))];
}