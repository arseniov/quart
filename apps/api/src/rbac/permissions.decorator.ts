import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'rbac:permissions';

export interface PermissionRequirement {
  code: string;
  scope?: 'global' | 'city';
}

/**
 * Marks a handler as requiring one or more permissions. Pass strings for
 * "any of these codes" semantics; pass objects with `scope` to constrain
 * the check to global vs city-scoped permissions.
 *
 * Controllers opt into checking with `@UseGuards(RbacGuard)` on the
 * handler or class. The guard is intentionally NOT registered globally —
 * public endpoints should stay free of an extra DB round-trip.
 */
export const RequirePermission = (...requirements: (string | PermissionRequirement)[]) =>
  SetMetadata(PERMISSIONS_KEY, requirements);