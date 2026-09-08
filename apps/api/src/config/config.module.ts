import { Global, Module } from '@nestjs/common';

import { ConfigService } from './config.service.js';

@Global()
@Module({
  providers: [
    { provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test', PORT: 3000 }) },
    { provide: 'CONFIG', useValue: { NODE_ENV: 'test', PORT: 3000 } },
  ],
  exports: [ConfigService],
})
export class ConfigModule {}
