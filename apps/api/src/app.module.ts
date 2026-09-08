import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';

import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { ConfigModule } from './config/config.module.js';
import { LoggerModule } from './logger/logger.module.js';

@Module({
  imports: [ConfigModule, LoggerModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}