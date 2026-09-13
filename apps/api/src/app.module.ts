import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AdminIssuesModule } from './admin-issues/admin-issues.module.js';
import { AdminModule } from './admin/admin.module.js';
import { AuditInterceptor } from './audit/audit.interceptor.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { CitiesModule } from './cities/cities.module.js';
import { CommentsModule } from './comments/comments.module.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { TenantContextInterceptor } from './common/tenant-context.interceptor.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { IdeasModule } from './ideas/ideas.module.js';
import { I18nModule } from './i18n/i18n.module.js';
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
import { SelfModule } from './self/self.module.js';
import { TopicsModule } from './topics/topics.module.js';
import { UploadsModule } from './uploads/uploads.module.js';

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
    ObservabilityModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    // Global JwtAuthGuard — controllers opt out with @Public(). Future
    // protected controllers opt IN with @UseGuards(JwtAuthGuard) on the
    // specific handler(s) that need the user attached.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
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