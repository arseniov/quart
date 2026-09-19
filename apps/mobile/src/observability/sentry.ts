// src/observability/sentry.ts
// GH #12 / mobile spec §12 — PII scrubber wired before any event leaves the device.
// ponytail: keep this module dependency-light (expo-constants + @sentry/react-native only)
//          so it can be imported from the root layout and unit tests without pulling in
//          the entire RN runtime.
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

const PII_KEYS = [
  'email', 'phone', 'phone_e164', 'password', 'token', 'access_token',
  'refresh_token', 'address', 'lat', 'lng', 'location',
];

export function scrubPII(input: unknown): unknown {
  if (input == null) return input;
  if (Array.isArray(input)) return input.map(scrubPII);
  if (typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (PII_KEYS.includes(k)) {
      out[k] = '[REDACTED]';
    } else {
      out[k] = scrubPII(v);
    }
  }
  return out;
}

export function initSentry(): void {
  const dsn = (Constants.expoConfig?.extra as { EXPO_PUBLIC_SENTRY_DSN?: string } | undefined)?.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return; // silent no-op when DSN not configured (POC builds)

  Sentry.init({
    dsn,
    release: Constants.expoConfig?.version,
    environment: __DEV__ ? 'development' : 'production',
    beforeSend(event) {
      if (event.user) {
        const u = event.user as { id?: string };
        event.user = u.id ? { id: u.id } : {};
      }
      if (event.request) {
        delete (event.request as { cookies?: unknown }).cookies;
        delete (event.request as { data?: unknown }).data;
      }
      event.breadcrumbs = (event.breadcrumbs ?? []).map((b) => {
        const scrubbed = scrubPII(b.data) as Record<string, unknown> | undefined;
        return scrubbed ? { ...b, data: scrubbed } : { ...b };
      });
      return event;
    },
  });
}

// Re-export the bits ErrorBoundary uses directly without a separate import path.
export const captureException = Sentry.captureException;
export { Sentry };
