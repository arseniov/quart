import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  constructor(@Inject('CONFIG') private readonly env: Record<string, string | number>) {}
  get NODE_ENV(): string {
    return String(this.env.NODE_ENV);
  }
  get PORT(): number {
    return Number(this.env.PORT);
  }
}
