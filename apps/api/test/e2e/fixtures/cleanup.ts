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
  'topic_user_subscriptions',
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
  // Geography (0001) — countries + cities are seeded by 0020_seed_italy and
  // shared across specs as reference fixtures. Truncating them (directly or
  // via CASCADE) breaks FKs in user_roles / issues / neighborhoods in the
  // same suite's beforeAll. A spec that needs fresh geographies should seed
  // them itself before truncating.
  'city_areas',
  'neighborhoods',
  'user_neighborhoods',
  // Taxonomy + RBAC — seeded by 0021/0022 and referenced by per-test data
  // (issues.category_id, user_roles.role_id, etc.). A spec that wants fresh
  // taxonomy / roles should re-seed explicitly.
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