import { Test } from '@nestjs/testing';
import { describe, it, expect } from 'vitest';

import { AppModule } from '../../src/app.module.js';

describe('AppModule', () => {
  it('compiles without missing provider errors', async () => {
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider('CONFIG')
      .useValue({ NODE_ENV: 'test', PORT: 3000 })
      .compile();
    expect(mod).toBeDefined();
  });
});
