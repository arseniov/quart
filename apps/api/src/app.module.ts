import { Module } from '@nestjs/common';

import { ConfigModule } from './config/config.module.js';
import { LoggerModule } from './logger/logger.module.js';

@Module({
  imports: [ConfigModule, LoggerModule],
})
export class AppModule {}
