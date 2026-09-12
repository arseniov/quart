import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AuthModule } from './auth/auth.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { TenantContextInterceptor } from './common/tenant-context.interceptor.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggerModule } from './logger/logger.module.js';

@Module({
  imports: [ConfigModule, LoggerModule, HealthModule, DbModule, AuthModule],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    // Global JwtAuthGuard — controllers opt out with @Public(). Future
    // protected controllers opt IN with @UseGuards(JwtAuthGuard) on the
    // specific handler(s) that need the user attached.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}