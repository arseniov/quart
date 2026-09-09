import { Injectable, Logger } from '@nestjs/common';

import { EnvSchema, type Env } from './schema.js';

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);
  readonly env: Env;

  constructor() {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      this.logger.error('Invalid env', parsed.error.flatten().fieldErrors);
      throw new Error('Invalid env: see logs');
    }
    this.env = parsed.data;
  }
}
