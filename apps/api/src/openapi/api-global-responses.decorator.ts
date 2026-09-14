import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';

/**
 * Class-level decorator that declares the three error responses every
 * authenticated JSON endpoint can return. Applied at the controller
 * level so each operation inherits the docs — saves 60+ per-operation
 * lines vs. annotating every handler individually.
 *
 *   - 401: no/invalid/expired session (cookie or JWT)
 *   - 403: authenticated but lacks the required permission / role
 *   - 429: rate-limited (every protected route is gated by the global
 *     throttler; some auth routes carry per-route tighter limits)
 *
 * Public controllers (auth, phone-otp, health, metrics) opt out — they
 * don't return 403, and applying the decorator anyway would lie about
 * the 401 contract for routes that genuinely are anonymous.
 */
export function ApiGlobalResponses(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiResponse({ status: 401, description: 'Unauthenticated' }),
    ApiResponse({ status: 403, description: 'Forbidden' }),
    ApiResponse({ status: 429, description: 'Too Many Requests' }),
  );
}