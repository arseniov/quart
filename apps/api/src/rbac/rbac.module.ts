import { Module } from '@nestjs/common';

import { RbacGuard } from './rbac.guard.js';

/**
 * RBAC infrastructure. Guards are NOT registered globally — controllers
 * opt in per-handler via `@UseGuards(RbacGuard)`. This keeps the cost off
 * the public auth/health surfaces and lets controllers that have no
 * admin surface skip the DB round-trip entirely.
 */
@Module({
  providers: [RbacGuard],
  exports: [RbacGuard],
})
export class RbacModule {}