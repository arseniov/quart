// src/observability/sentry.ts
// GH #12 / mobile spec §12 — PII scrubber wired before any event leaves the device.
// ponytail: keep this module dependency-light (expo-constants + @sentry/react-native only)
//          so it can be imported from the root layout and unit tests without pulling in
//          the entire RN runtime.
import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

import { SENTRY_DSN } from '@/lib/env';

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
  if (!SENTRY_DSN) return; // silent no-op when DSN not configured (POC builds)

  Sentry.init({
    dsn: SENTRY_DSN,
    release: Constants.expoConfig?.version,
    environment: __DEV__ ? 'development' : 'production',
    beforeSend(event) {
      if (event.user) {
        event.user = event.user.id ? { id: event.user.id } : {};
      }
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
      }
      event.breadcrumbs = (event.breadcrumbs ?? []).map((b) => {
        const scrubbed = scrubPII(b.data) as Record<string, unknown> | undefined;
        return scrubbed ? { ...b, data: scrubbed } : { ...b };
      });
      return event;
    },
  });
}

export const captureException = Sentry.captureException;