import type { ColumnType, Generated } from 'kysely';

// ============================================================================
// 0001 Geography
// ============================================================================

export interface CountriesTable {
  id: Generated<string>;
  code: string; // char(2)
  name: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface CitiesTable {
  id: Generated<string>;
  slug: string;
  country_code: string; // char(2)
  name: string;
  locale_default: string;
  timezone: string;
  // geography(Polygon, 4326) — PostGIS WKT/EWKT
  bounds: ColumnType<unknown | null, unknown | null | undefined, unknown | null>;
  status: 'active' | 'inactive';
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface CityAreasTable {
  id: Generated<string>;
  city_id: string;
  slug: string;
  name: string;
  // geography(MultiPolygon, 4326)
  geometry: ColumnType<unknown | null, unknown | null | undefined, unknown | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface NeighborhoodsTable {
  id: Generated<string>;
  city_id: string;
  area_id: string | null;
  slug: string;
  name: string;
  // geography(MultiPolygon, 4326)
  geometry: ColumnType<unknown | null, unknown | null | undefined, unknown | null>;
  // geography(Point, 4326)
  centroid: ColumnType<unknown | null, unknown | null | undefined, unknown | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface UserNeighborhoodsTable {
  user_id: string;
  neighborhood_id: string;
  city_id: string;
}

// ============================================================================
// 0002 Identity
// ============================================================================

export interface UsersTable {
  id: Generated<string>;
  handle: string;
  email: string | null; // citext
  phone_e164: string | null;
  password_hash: string | null;
  display_name: string;
  avatar_url: string | null;
  locale: string;
  default_city_id: string | null;
  status: 'active' | 'suspended' | 'deleted';
  created_at: ColumnType<Date, Date | string | undefined, never>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface UserIdentitiesTable {
  user_id: string;
  provider: 'email' | 'phone' | 'google' | 'apple' | 'invite';
  provider_subject: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface AuthSessionsTable {
  id: Generated<string>;
  user_id: string;
  device_fingerprint: string | null;
  ip: string | null; // inet
  user_agent: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  last_seen_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  absolute_expires_at: ColumnType<Date, Date | string, Date | string>;
  revoked_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  revoke_reason: string | null;
}

export interface MfaFactorsTable {
  id: Generated<string>;
  user_id: string;
  type: 'totp' | 'backup_code';
  secret_encrypted: Buffer;
  enrolled_at: ColumnType<Date, Date | string | undefined, never>;
  last_used_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface MfaChallengesTable {
  id: Generated<string>;
  user_id: string;
  code_hash: string;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  consumed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

// 0026 — backup codes + TOTP replay protection.
// The TOTP secret itself is carried in the verified JWT (stateless), so
// this row holds only backup-code hashes and a last_used_step timestamp.
export interface MfaCredentialsTable {
  id: Generated<string>;
  user_id: string;
  city_id: string;
  type: 'totp';
  label: string;
  backup_codes_hash: string[];
  backup_codes_used_at: ColumnType<unknown, unknown | undefined, unknown>; // jsonb
  created_at: ColumnType<Date, Date | string | undefined, never>;
  enrolled_at: ColumnType<Date, Date | string | undefined, never>;
  last_used_step: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

// ============================================================================
// 0003 RBAC
// ============================================================================

export interface PermissionsTable {
  id: Generated<string>;
  code: string;
  description: string | null;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface RolesTable {
  id: Generated<string>;
  code: string;
  name: string;
  description: string | null;
  is_officer: Generated<boolean>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface RolePermissionsTable {
  role_id: string;
  permission_id: string;
  scope_filter: ColumnType<unknown, unknown | undefined, unknown>; // jsonb
}

export interface UserRolesTable {
  id: Generated<string>;
  user_id: string;
  role_id: string;
  city_id: string;
  area_id: string | null;
  neighborhood_id: string | null;
  granted_by_user_id: string | null;
  granted_at: ColumnType<Date, Date | string | undefined, never>;
  expires_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  revoked_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface UserPermissionsTable {
  user_id: string;
  permission_id: string;
  city_id: string;
  expires_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface RbacPoliciesTable {
  id: Generated<string>;
  code: string;
  effect: 'allow' | 'deny';
  priority: number;
  condition: ColumnType<unknown, unknown | undefined, unknown>; // jsonb
}

// ============================================================================
// 0004 Taxonomies
// ============================================================================

export interface TopicCategoriesTable {
  id: Generated<string>;
  city_id: string | null;
  code: string;
  name_i18n: ColumnType<unknown, unknown, unknown>; // jsonb (locale -> name)
  parent_id: string | null;
  sort_order: Generated<number>;
  status: 'active' | 'archived';
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface TopicsTable {
  id: Generated<string>;
  category_id: string;
  city_id: string;
  code: string;
  name_i18n: ColumnType<unknown, unknown, unknown>; // jsonb (locale -> name)
  status: 'active' | 'archived';
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface IssueCategoriesTable {
  id: Generated<string>;
  city_id: string;
  code: string;
  name_i18n: ColumnType<unknown, unknown, unknown>; // jsonb
  default_sla_hours: number | null;
  default_assignee_role_id: string | null;
  icon_name: string | null;
  color_hex: string | null;
  status: 'active' | 'archived';
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface TopicUserSubscriptionsTable {
  user_id: string;
  topic_id: string;
  city_id: string;
  push_enabled: Generated<boolean>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// ============================================================================
// 0005 Content
// ============================================================================

export interface IssuesTable {
  id: Generated<string>;
  city_id: string;
  neighborhood_id: string;
  category_id: string | null;
  author_user_id: string;
  title: string;
  description: string;
  // geography(Point, 4326)
  location: ColumnType<unknown, unknown, unknown>;
  address_hint: string | null;
  status: 'open' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed' | 'rejected';
  status_changed_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
  assigned_officer_id: string | null;
  sla_due_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  // Added in 0009 (FTS)
  search_tsv: ColumnType<unknown, unknown | null | undefined, unknown | null>;
}

export interface IssuePhotosTable {
  id: Generated<string>;
  issue_id: string;
  object_key: string;
  sort_order: Generated<number>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface IssueEventsTable {
  id: Generated<string>;
  issue_id: string;
  actor_user_id: string | null;
  event_type: 'created' | 'status_changed' | 'assigned' | 'commented' | 'photo_added';
  payload: ColumnType<unknown, unknown | undefined, unknown>; // jsonb
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface IdeasTable {
  id: Generated<string>;
  city_id: string;
  neighborhood_id: string | null;
  author_user_id: string;
  title: string;
  body: string;
  status: 'draft' | 'published' | 'hidden' | 'rejected';
  published_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  // Added in 0009 (FTS)
  search_tsv: ColumnType<unknown, unknown | null | undefined, unknown | null>;
}

export interface IdeaVotesTable {
  idea_id: string;
  user_id: string;
  city_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface PollsTable {
  id: Generated<string>;
  city_id: string;
  neighborhood_id: string | null;
  title: string;
  body: string | null;
  created_by_user_id: string;
  opens_at: ColumnType<Date, Date | string, Date | string>;
  closes_at: ColumnType<Date, Date | string, Date | string>;
  status: 'draft' | 'open' | 'closed' | 'cancelled';
  results_visibility: 'always' | 'after_close' | 'never';
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface PollOptionsTable {
  id: Generated<string>;
  poll_id: string;
  label: string;
  sort_order: Generated<number>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface PollVotesTable {
  poll_id: string;
  option_id: string;
  user_id: string;
  city_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface CommentsTable {
  id: Generated<string>;
  city_id: string;
  parent_type: 'idea' | 'issue' | 'poll';
  parent_id: string;
  author_user_id: string;
  body: string;
  status: 'visible' | 'hidden' | 'deleted';
  created_at: ColumnType<Date, Date | string | undefined, never>;
  deleted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  // Added in 0009 (FTS)
  search_tsv: ColumnType<unknown, unknown | null | undefined, unknown | null>;
}

export interface CommentReactionsTable {
  comment_id: string;
  user_id: string;
  reaction: 'up' | 'down';
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// ============================================================================
// 0006 Audit
// ============================================================================

export interface AuditLogTable {
  // pg returns int8 (bigserial) as a JS string at runtime, even though this is
  // typed `number` for the Kysely builder. Callers cast through `as never` /
  // `String(...)` when they need a stable representation.
  id: Generated<number>; // bigserial
  city_id: string;
  actor_user_id: string | null;
  on_behalf_of_user_id: string | null;
  impersonation_session_id: string | null;
  action: string; // varchar(64)
  target_type: string; // varchar(64)
  target_id: string; // varchar(64)
  request_id: string | null;
  ip: string | null; // inet
  user_agent: string | null;
  payload_canonical_sha256: string; // char(64)
  payload_redacted: ColumnType<unknown, unknown, unknown>; // jsonb
  payload_raw_encrypted: Buffer | null;
  prev_hash: string; // char(64)
  row_hash: string; // char(64)
  key_version_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  pii_redacted_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

export interface AuditAnchorsTable {
  id: Generated<string>;
  // SHA-256 concatenation hash of the latest audit_log row_hash sequence.
  // Renamed from `merkle_root` in 0029: it's not a Merkle tree root.
  // pg returns int8 (bigserial) as a JS string — see the audit_log.id comment above.
  anchor_hash: string; // char(64)
  row_range_start: string; // bigint — pg returns int8 as string
  row_range_end: string; // bigint — pg returns int8 as string
  tsa_response: Buffer;
  tsa_url: string;
  tsa_cert_sha256: string; // char(64)
  anchored_at: ColumnType<Date, Date | string | undefined, never>;
}

// quart_security.kek_versions (0006)
export interface KekVersionsTable {
  id: Generated<string>;
  version: number;
  status: 'active' | 'rotating' | 'retired' | 'pending'; // quart_security.key_status
  key_encrypted: Buffer;
  provider: string; // varchar(32)
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// quart_security.audit_key_versions (0006)
export interface AuditKeyVersionsTable {
  id: Generated<string>;
  version: number;
  status: 'active' | 'rotating' | 'retired' | 'pending';
  kek_id: string;
  hmac_key_encrypted: Buffer;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  activated_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  retired_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

// ============================================================================
// 0007 PII
// ============================================================================

export interface PiiColumnsTable {
  id: Generated<string>;
  table_name: string;
  column_name: string;
  encryption_mode: 'pgp_sym' | 'app_envelope';
  kek_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface PiiKeyVersionsTable {
  id: Generated<string>;
  city_id: string;
  version: number;
  status: 'active' | 'retiring' | 'retired'; // quart_security.key_status
  dek_encrypted: Buffer;
  kek_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
  activated_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  retired_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

// ============================================================================
// 0008 Notifications
// ============================================================================

export interface NotificationsTable {
  id: Generated<string>;
  city_id: string;
  recipient_user_id: string;
  type: string; // varchar(64)
  title: string;
  body: string;
  target_url: string | null;
  payload: ColumnType<unknown, unknown | undefined, unknown>; // jsonb
  read_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface PushSubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  city_id: string;
  expo_push_token: string;
  locale: string;
  app_version: string;
  device_platform: 'ios' | 'android' | 'web';
  // 'invalid' is set by the push worker when Expo rejects the token
  // (DeviceNotRegistered / InvalidCredentials). Default 'active' for new rows.
  status: Generated<'active' | 'invalid'>;
  // Tracks when the worker last marked the token invalid (0031).
  // Revocation (`revoked_at`) is user-initiated and orthogonal.
  invalidated_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  revoked_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

export interface NotificationDeliveriesTable {
  id: Generated<string>;
  notification_id: string;
  // Nullable from migration 0032 onward: email-channel rows don't reference a
  // push_subscription. Channel discriminates push vs email rows.
  push_subscription_id: string | null;
  // Per-channel fan-out (T38): 'push' for Expo, 'email' for SES.
  channel: Generated<'push' | 'email'>;
  // Captured at fan-out time so the email worker is stateless and a later
  // user.email change can't invalidate a pending retry.
  recipient_email: string | null;
  status: 'pending' | 'delivered' | 'failed';
  error_code: string | null;
  attempts: Generated<number>;
  last_attempt_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
}

// 0033 — single-use email sign-in tokens. TTL 15 min from issuance;
// consumed_at marks the row as used. Admin-managed (no tenant RLS).
export interface MagicLinksTable {
  id: Generated<string>;
  email: string;
  token: string;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  consumed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// 0034 — single-use password reset tokens. TTL 60 min. The token column
// is unique; consumption is atomic via UPDATE-WHERE-RETURNING.
export interface PasswordResetsTable {
  id: Generated<string>;
  user_id: string;
  token: string;
  expires_at: ColumnType<Date, Date | string, Date | string>;
  consumed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// ============================================================================
// 0027 Saved items
// ============================================================================

export interface SavedItemsTable {
  id: Generated<string>;
  city_id: string;
  user_id: string;
  kind: 'issue' | 'idea' | 'poll';
  target_id: string;
  created_at: ColumnType<Date, Date | string | undefined, never>;
}

// ============================================================================
// 0009 KV / FTS / DSAR
// ============================================================================

export interface DsarRequestsTable {
  id: Generated<string>;
  user_id: string;
  type: 'export' | 'delete' | 'restrict';
  status: 'pending' | 'processing' | 'completed' | 'rejected';
  requested_at: ColumnType<Date, Date | string | undefined, never>;
  completed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  payload: ColumnType<unknown, unknown | undefined, unknown>; // jsonb
}

export interface FeatureFlagsTable {
  code: string; // text PK
  enabled: Generated<boolean>;
  rollout_percent: Generated<number>;
  conditions: ColumnType<unknown, unknown | undefined, unknown>; // jsonb
  updated_by_user_id: string | null;
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
}

export interface AppSettingsTable {
  key: string; // text PK
  value: ColumnType<unknown, unknown, unknown>; // jsonb
  updated_at: ColumnType<Date, Date | string | undefined, Date | string | undefined>;
}

// ============================================================================
// DB
// ============================================================================

export interface DB {
  countries: CountriesTable;
  cities: CitiesTable;
  city_areas: CityAreasTable;
  neighborhoods: NeighborhoodsTable;
  user_neighborhoods: UserNeighborhoodsTable;

  users: UsersTable;
  user_identities: UserIdentitiesTable;
  auth_sessions: AuthSessionsTable;
  mfa_factors: MfaFactorsTable;
  mfa_challenges: MfaChallengesTable;
  mfa_credentials: MfaCredentialsTable;

  permissions: PermissionsTable;
  roles: RolesTable;
  role_permissions: RolePermissionsTable;
  user_roles: UserRolesTable;
  user_permissions: UserPermissionsTable;
  rbac_policies: RbacPoliciesTable;

  topic_categories: TopicCategoriesTable;
  topics: TopicsTable;
  issue_categories: IssueCategoriesTable;
  topic_user_subscriptions: TopicUserSubscriptionsTable;

  issues: IssuesTable;
  issue_photos: IssuePhotosTable;
  issue_events: IssueEventsTable;
  ideas: IdeasTable;
  idea_votes: IdeaVotesTable;
  polls: PollsTable;
  poll_options: PollOptionsTable;
  poll_votes: PollVotesTable;
  comments: CommentsTable;
  comment_reactions: CommentReactionsTable;

  audit_log: AuditLogTable;
  audit_anchors: AuditAnchorsTable;
  kek_versions: KekVersionsTable;
  audit_key_versions: AuditKeyVersionsTable;

  pii_columns: PiiColumnsTable;
  pii_key_versions: PiiKeyVersionsTable;

  notifications: NotificationsTable;
  push_subscriptions: PushSubscriptionsTable;
  notification_deliveries: NotificationDeliveriesTable;
  saved_items: SavedItemsTable;
  magic_links: MagicLinksTable;
  password_resets: PasswordResetsTable;

  dsar_requests: DsarRequestsTable;
  feature_flags: FeatureFlagsTable;
  app_settings: AppSettingsTable;
}
