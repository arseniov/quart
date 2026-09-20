// apps/api/src/auth/ba-audit.hook.ts
// GH #34: BA's `databaseHooks` (session.create.after) + plugin-level
// `hooks.after` matcher for `/sign-out` both write HMAC chain rows so
// every auth event lands in the §3.8 audit trail.
//
// Two flows, two hook surfaces (BA 1.0.20 has no `databaseHooks.session
// .delete.after`, so BA-driven sign-out is intercepted via the plugin
// matcher instead):
//
//   1. Session creation (databaseHooks.session.create.after)
//      Fires for every successful BA session row — social, BA-email
//      sign-in, and BA sign-up with auto-signin. Reads the BA account
//      table to derive the provider discriminator ('credential' /
//      'google' / 'apple') and delegates to SessionService.createSession
//      so the chain row is written atomically with our auth_sessions
//      row. Mirrors LoginService's email-login path (GH #33) — same
//      SessionService helper, same write order.
//
//   2. Sign-out (plugin.hooks.after, path === '/sign-out')
//      BA 1.0.20 has no session-delete hook; the plugin matcher is the
//      only seam that lets us observe a BA-driven sign-out. Writes
//      `auth.sign_out` under the sentinel city (no Quart auth_sessions
//      row to revoke; the BA session token tags the targetId so a
//      chain walk can correlate). Skip when no token — the matcher
//      fires on /sign-out even if the caller wasn't authenticated.
//
// Discriminator naming (auditPayload.via) — GH #33 vs GH #34:
//   GH #33 /auth/login          → 'email_login'
//   GH #34 BA /sign-in/email    → 'ba_email_login'
//   GH #34 BA /sign-up/email    → 'ba_email_signup'
//   GH #34 BA /sign-in/google   → 'ba_google'
//   GH #34 BA /sign-in/apple    → 'ba_apple'
//   GH #34 BA /sign-up/google   → 'ba_google'
//   GH #34 BA /sign-up/apple    → 'ba_apple'
//   GH #34 BA /sign-out         → 'ba_sign_out'
// Sign-in vs sign-up is collapsed to one provider tag for OAuth —
// the most recent account row reflects the flow that just produced
// this session, and a single `ba_<provider>` tag keeps the chain
// read-side group-by small. Email sign-in vs sign-up is kept distinct
// because BA's auto-signin toggle (default off per spec) makes the
// two flows semantically different (sign-up provisioning vs authn).

import { Logger } from '@nestjs/common';
import type { BetterAuthOptions, BetterAuthPlugin } from 'better-auth';

import type { AuditService } from '../audit/audit.service.js';
import type { DbService } from '../db/db.service.js';

import type { SessionService } from './session.service.js';

/** Subset of BA's `Session` row that the hook actually reads. */
interface BaSessionRow {
  id: string;
  userId: string;
  expiresAt: Date | string;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  token?: string;
}

interface BaUserRow {
  id: string;
  email: string;
}

interface BaAccountRow {
  providerId: string;
  userId: string;
  createdAt: Date | string;
}

interface BaUserRowWithCreatedAt extends BaUserRow {
  createdAt: Date | string;
}

const log = new Logger('BaAuditHook');

/**
 * Map BA `account.providerId` → `auditPayload.via` discriminator.
 *
 * `credential` is BA's name for the email-password account row. Google
 * and Apple match their social-provider keys. Anything else falls
 * through to `ba_<provider>` so the chain still records the event.
 */
function viaForProvider(providerId: string | null | undefined): string {
  switch (providerId) {
    case 'credential':
      return 'ba_email_login';
    case 'google':
      return 'ba_google';
    case 'apple':
      return 'ba_apple';
    default:
      return `ba_${providerId ?? 'unknown'}`;
  }
}

/**
 * Sign-up vs sign-in discriminator for the credential (email-password)
 * flow. We don't have ctx.path inside BA 1.0.20's databaseHook, so we
 * infer from how fresh the BA user row is — a sign-up just created
 * the row, a sign-in reuses an existing one. 30s is a comfortable
 * margin (BA's sign-up + password hash + session mint is well under
 * that on any realistic infra).
 *
 * Returns `null` for non-credential providers (social collapses to
 * `ba_<provider>` regardless of sign-in / sign-up — see header).
 */
function viaForCredential(
  baUserCreatedAt: Date | string | undefined,
  isFreshUser: boolean,
): string {
  if (!isFreshUser) return 'ba_email_login';
  // social never reaches here, but keep the discriminator stable.
  void baUserCreatedAt;
  return 'ba_email_signup';
}

export interface BaSessionCreateHookDeps {
  db: DbService;
  sessions: SessionService;
}

/**
 * Returns the `databaseHooks.session.create.after` callback. Closes
 * over the deps so the hook has them at fire time without needing a
 * Nest ModuleRef lookup. BA 1.0.20 passes only the session row (no
 * ctx) — see GH #34 header for why we accept that and derive the
 * provider from the BA account table.
 */
export function baSessionCreateHook(deps: BaSessionCreateHookDeps) {
  const { db, sessions } = deps;
  return async (session: BaSessionRow): Promise<void> => {
    try {
      // 1. Find the BA user (provides email — the canonical join key
      //    between BA and Quart, same as login.service.ts:83-97).
      const baUser = await db.kysely
        .selectFrom('user' as never)
        .select(['id', 'email', 'createdAt'] as never)
        .where('id' as never, '=', session.userId as never)
        .executeTakeFirst() as BaUserRowWithCreatedAt | undefined;
      if (!baUser) {
        log.warn({ sessionId: session.id }, 'ba_session_created: BA user row missing');
        return;
      }

      // 2. Most recent account row → provider discriminator. BA
      //    appends a row on every OAuth link / sign-up and updates
      //    on every sign-in, so the latest row reflects the flow
      //    that just produced this session. Indexed by `userId` (see
      //    0025_better_auth_tables.up.sql:50).
      const account = await db.kysely
        .selectFrom('account' as never)
        .select(['providerId', 'createdAt'] as never)
        .where('userId' as never, '=', session.userId as never)
        .orderBy('createdAt' as never, 'desc')
        .limit(1)
        .executeTakeFirst() as BaAccountRow | undefined;

      // 3. Sign-up detection: BA user just created → credential
      //    signup. Existing user → credential sign-in. Social is
      //    collapsed (see header).
      const now = Date.now();
      const baCreatedMs = new Date(baUser.createdAt).getTime();
      const isFreshUser = now - baCreatedMs < 30_000;
      const providerId = account?.providerId ?? null;
      const via =
        providerId === 'credential'
          ? viaForCredential(account?.createdAt, isFreshUser)
          : viaForProvider(providerId);

      // 4. Look up the Quart projection by email. If it doesn't exist
      //    (BA-orphan — BA user exists but no Quart `users` row), the
      //    chain can't anchor under any city; skip. BA's own `session`
      //    table still records the auth for BA-internal purposes.
      const quartUser = await db.kysely
        .selectFrom('users')
        .select([
          'id',
          'handle',
          'display_name',
          'email',
          'phone_e164',
          'avatar_url',
          'locale',
          'default_city_id',
          'status',
        ])
        .where('email', '=', baUser.email)
        .executeTakeFirst();
      if (!quartUser || quartUser.status !== 'active') {
        log.warn(
          { baEmail: baUser.email, baUserId: baUser.id },
          'ba_session_created: Quart user row missing or inactive; skipping chain row',
        );
        return;
      }

      // 5. Role snapshot for the JWT role_snapshot claim (matches the
      //    other controllers' shape — see login.service.ts:108-115).
      const roleRows = await db.kysely
        .selectFrom('user_roles')
        .innerJoin('roles', 'roles.id', 'user_roles.role_id')
        .select('roles.code')
        .where('user_roles.user_id', '=', quartUser.id)
        .execute();
      const roles = roleRows.map((r) => r.code);

      // 6. Mint the Quart session + chain row. SessionService is the
      //    shared helper from GH #30 — same write order, same atomic
      //    transaction. The discriminator + the BA session id land
      //    in the payload so a chain walk can correlate to BA's side.
      await sessions.createSession({
        user: {
          id: quartUser.id,
          handle: quartUser.handle,
          display_name: quartUser.display_name,
          email: quartUser.email,
          phone_e164: quartUser.phone_e164,
          avatar_url: quartUser.avatar_url,
          locale: quartUser.locale,
          default_city_id: quartUser.default_city_id,
        },
        roles,
        ip: session.ipAddress ?? null,
        userAgent: session.userAgent ?? null,
        // BA's session row doesn't carry the mobile's
        // x-device-fingerprint header — only IP and UA. The guard
        // layer doesn't require device_fingerprint, just records it
        // when present.
        deviceFingerprint: null,
        requestId: null,
        auditPayload: { via, ba_session_id: session.id },
      });
    } catch (err) {
      // Audit failures must not break BA's sign-in response. Log and
      // swallow; the chain row is best-effort from this path.
      log.warn(
        { err: String(err), baSessionId: session.id },
        'ba_session_created: audit hook failed (non-fatal)',
      );
    }
  };
}

/**
 * Subset of BA's `HookEndpointContext` that the matcher / handler
 * actually reads. BA's full type is wider; we accept the superset
 * via `unknown` cast in the plugin wiring.
 */
interface BaHookCtx {
  path: string;
  context?: {
    session?: {
      session?: { token?: string; userId?: string };
      user?: { id?: string; email?: string };
    };
  };
}

export interface BaSignOutAuditPluginDeps {
  audit: AuditService;
  db: DbService;
}

/** Plugin id — kept stable for any future introspection / disable. */
export const BA_SIGN_OUT_AUDIT_PLUGIN_ID = 'quart-sign-out-audit';

/**
 * Returns a BetterAuthPlugin whose `hooks.after` matcher fires only on
 * `/sign-out`. Writes a sentinel-city `auth.sign_out` row so a BA-
 * driven sign-out (third-party client, admin web app, anything not
 * going through SignOutController) still lands in the §3.8 chain.
 *
 * No in-tenant write: BA's session has no Quart `auth_sessions`
 * binding, so there's no city to anchor under. The BA session token
 * tags the targetId so the row is still attributable.
 */
export function baSignOutAuditPlugin(deps: BaSignOutAuditPluginDeps): BetterAuthPlugin {
  const { audit, db } = deps;
  return {
    id: BA_SIGN_OUT_AUDIT_PLUGIN_ID,
    hooks: {
      after: [
        {
          matcher: (ctx: unknown) => (ctx as BaHookCtx).path === '/sign-out',
          handler: async (ctx: unknown): Promise<void> => {
            try {
              const c = ctx as BaHookCtx;
              const baSession = c.context?.session?.session;
              const baUser = c.context?.session?.user;
              // The matcher can fire on an unauthenticated /sign-out
              // (BA returns success without checking session in some
              // paths). Skip when we have nothing to anchor.
              const token = baSession?.token ?? baUser?.id ?? null;
              if (!token) return;
              const userId = baSession?.userId ?? baUser?.id ?? 'unknown';
              const targetId = `ba:${token}`.slice(0, 64);
              await audit.writeSystem(db.kysely, {
                action: 'auth.sign_out',
                targetType: 'session',
                targetId,
                payload: { via: 'ba_sign_out', ba_user_id: userId },
                requestId: null,
                ip: null,
                userAgent: null,
              });
            } catch (err) {
              log.warn({ err: String(err) }, 'ba_sign_out: audit hook failed (non-fatal)');
            }
          },
        },
      ],
    },
  };
}

/**
 * Re-export the `databaseHooks` shape for AuthService's options. Kept
 * here so AuthService doesn't have to import the hook factory just to
 * splice it into the options bag.
 */
export function baDatabaseHooks(
  deps: BaSessionCreateHookDeps,
): NonNullable<BetterAuthOptions['databaseHooks']> {
  return {
    session: {
      create: {
        after: baSessionCreateHook(deps),
      },
    },
  };
}