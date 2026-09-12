import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a controller or handler as public — the global JwtAuthGuard will
 * skip auth for it. Used for routes that must run before authentication
 * (sign-in, magic-link, OTP, health).
 *
 * Future protected controllers opt-IN with `@UseGuards(JwtAuthGuard)`;
 * the global APP_GUARD provider denies by default.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);