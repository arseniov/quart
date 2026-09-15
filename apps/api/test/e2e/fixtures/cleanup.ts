import type { DB } from '@quart/db';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * All public-schema tables created by `infrastructure/postgres/migrations`.
 * Used between tests to reset the e2e DB to a known empty state.
 * `TRUNCATE ... CASCADE` ignores FK ordering, so the flat list is enough.
 *
 * ponytail: source of truth for "what state must be reset between e2e
 * tests". When a new tenant-scoped table appears in migrations, add it
 * here so cross-test isolation stays hermetic.
 */
const TENANT_TABLES: readonly string[] = [
  // Better Auth (0025)
  'user',
  'session',
  'account',
  'verification',
  // Identity / MFA (0002, 0026)
  'users',
  'user_identities',
  'auth_sessions',
  'mfa_factors',
  'mfa_challenges',
  'mfa_credentials',
  // Content (0004, 0005)
  'topics',
  'topic_categories',
  'topic_user_subscriptions',
  'issue_categories',
  'issues',
  'issue_photos',
  'issue_events',
  'ideas',
  'idea_votes',
  'polls',
  'poll_options',
  'poll_votes',
  'comments',
  'comment_reactions',
  // Geography (0001)
  'countries',
  'cities',
  'city_areas',
  'neighborhoods',
  'user_neighborhoods',
  // Notifications (0008, 0032)
  'notifications',
  'push_subscriptions',
  'notification_deliveries',
  // Audit + PII (0006, 0007, 0029, 0030)
  'audit_log',
  'audit_anchors',
  'pii_columns',
  'pii_key_versions',
  // Saved items (0027)
  'saved_items',
  // DSAR / KV (0009)
  'dsar_requests',
  'feature_flags',
  'app_settings',
];

/**
 * Truncate every public-schema table in one shot so each test starts
 * from an empty DB. CASCADE handles FK chains; RESTART IDENTITY resets
 * sequences so subsequent INSERTs get id=1 again.
 *
 * Skipped if no tenants tables exist (the fixture's beforeAll never ran,
 * e.g. when Docker is unavailable — the caller short-circuits the test
 * before reaching here).
 */
export async function truncateAllTables(db: Kysely<DB>): Promise<void> {
  if (TENANT_TABLES.length === 0) return;
  const list = TENANT_TABLES.map((t) => `"${t}"`).join(', ');
  await sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`).execute(db);
}