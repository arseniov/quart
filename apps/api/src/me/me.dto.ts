// apps/api/src/me/me.dto.ts
// GH #51: Zod schemas for /me/devices.

import { z } from 'zod';

// Mobile sends `device_platform` (snake_case, mirroring `Platform.OS`).
// Spec uses `platform`. Accept both so existing callers work without a
// mobile-side change.
const RegisterBody = z.object({
  // Optional — the controller derives a stable device_id from the
  // expo_push_token when the mobile doesn't send one. Once the mobile
  // generates a UUID per install, this can be required.
  device_id: z.string().min(1).max(128).optional(),
  platform: z.enum(['ios', 'android']).optional(),
  device_platform: z.enum(['ios', 'android']).optional(),
  expo_push_token: z.string().min(1).max(512),
  app_version: z.string().min(1).max(64),
  locale: z.string().min(2).max(16),
});
export type RegisterBody = z.infer<typeof RegisterBody>;

const DeviceIdParam = z.object({
  // :id in DELETE /me/devices/:id is the client-generated device_id
  // (UUID or our sha256-derived token fingerprint), not a row PK.
  id: z.string().min(1).max(128),
});
export type DeviceIdParam = z.infer<typeof DeviceIdParam>;

export const RegisterDeviceSchema = RegisterBody;
export const DeviceIdSchema = DeviceIdParam;