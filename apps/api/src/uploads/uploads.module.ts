import { Module } from '@nestjs/common';
import { Client as MinioClient } from 'minio';

import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ConfigService } from '../config/config.service.js';
import { DbModule } from '../db/db.module.js';

import { MINIO_CLIENT, UploadsService } from './uploads.service.js';
import { UploadsController } from './uploads.controller.js';

@Module({
  imports: [AuthModule, AuditModule, DbModule],
  controllers: [UploadsController],
  providers: [
    UploadsService,
    {
      provide: MINIO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): MinioClient =>
        new MinioClient({
          endPoint: config.env.MINIO_ENDPOINT,
          useSSL: false,
          accessKey: config.env.MINIO_ACCESS_KEY,
          secretKey: config.env.MINIO_SECRET_KEY,
        }),
    },
  ],
})
export class UploadsModule {}