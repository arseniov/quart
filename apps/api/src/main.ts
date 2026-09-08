import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';
import { ConfigService } from './config/config.service.js';

// Full logger/exception wiring arrives in Task 4 / Task 6.
async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter({ trustProxy: true, logger: false });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, adapter, {
    bufferLogs: true,
  });
  const config = app.get(ConfigService);
  await app.listen({ port: config.PORT, host: '0.0.0.0' });
}

bootstrap().catch((err: unknown) => {
   
  console.error('Fatal bootstrap error', err);
  process.exit(1);
});
