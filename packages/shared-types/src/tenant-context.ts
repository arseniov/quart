/**
 * Per-request tenant context used by the API to scope DB access via
 * Postgres RLS GUCs (`app.city_id`, `app.user_id`, `app.is_super_admin`,
 * `app.request_id`).
 *
 * Populated by `TenantContextInterceptor` from request headers (Phase 2
 * stub) and later from a JWT/session by the JwtAuthGuard (Phase 3).
 */
export interface TenantContext {
  cityId: string;
  userId: string | null;
  isSuperAdmin: boolean;
  requestId: string;
}
