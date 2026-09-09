import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { TenantContextInterceptor } from './common/tenant-context.interceptor.js';
import { ConfigModule } from './config/config.module.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggerModule } from './logger/logger.module.js';

@Module({
  imports: [ConfigModule, LoggerModule, HealthModule, DbModule],
  providers: [{ provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
