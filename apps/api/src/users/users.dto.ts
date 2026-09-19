import { z } from 'zod';

/**
 * Public profile projection for `GET /users/:id`.
 *
 * PII discipline: every field is whitelisted explicitly. The DTO carries
 * NONE of `email`, `phone_e164`, `password_hash`, MFA factors, sessions,
 * audit log, votes, or other authenticated-user internals. The service
 * selects a fixed column set and maps through `toPublicUser()` — never
 * spread the raw row into the response.
 */
export const PublicUserSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  joinedAt: z.string().datetime(),
  publicStats: z.object({
    ideasCount: z.number().int().nonnegative(),
    issuesCount: z.number().int().nonnegative(),
    pollsCount: z.number().int().nonnegative(),
  }),
});
export type PublicUserDto = z.infer<typeof PublicUserSchema>;
