import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the AuditService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the DbService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import type {
  CreateBody,
  ListQuery,
  ModerateBody,
  UpdateBody,
} from './ideas.dto.js';

export interface Idea {
  id: string;
  cityId: string;
  authorUserId: string;
  title: string;
  body: string;
  status: 'draft' | 'published' | 'hidden' | 'rejected';
  upvoteCount: number;
  createdAt: Date;
}

interface IdeaRow {
  id: string;
  city_id: string;
  author_user_id: string;
  title: string;
  body: string;
  status: 'draft' | 'published' | 'hidden' | 'rejected';
  created_at: Date;
}

export interface IdeaComment {
  id: string;
  parentType: 'idea' | 'issue' | 'poll';
  parentId: string;
  authorUserId: string;
  body: string;
  createdAt: Date;
}

interface CommentRow {
  id: string;
  parent_type: 'idea' | 'issue' | 'poll';
  parent_id: string;
  author_user_id: string;
  body: string;
  created_at: Date;
}

const ADMIN_MODERATE = 'admin.ideas.moderate';
const ADMIN_ROLE_CODES = ['moderator', 'quart_admin', 'super_admin'];

// Ponytail: scope.roleSnapshot contains role *codes* — admin override is the
// presence of any officer role (mirrors the seed: only moderator/quart_admin/
// super_admin hold admin.ideas.moderate).
function isAdminModerator(roleSnapshot: string[] | undefined): boolean {
  return (roleSnapshot ?? []).some((r) => ADMIN_ROLE_CODES.includes(r));
}

@Injectable()
export class IdeasService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(_user: AuthUser, q: ListQuery): Promise<Idea[]> {
    return this.db.runInTenantTx(this.tenantCtx(_user), async (trx) => {
      // Public listing: status filter is optional; default = published-only.
      // The `deleted_at IS NULL` predicate mirrors the soft-delete contract
      // callers rely on (no row resurrection via deleted_at).
      const statusFilter = q.status ?? 'published';
      const limit = q.limit;
      const offset = (q.page - 1) * q.limit;
      const rows = await trx
        .selectFrom('ideas')
        .select(['id', 'city_id', 'author_user_id', 'title', 'body', 'status', 'created_at'])
        .where('city_id', '=', q.cityId)
        .where('status', '=', statusFilter)
        .where('deleted_at', 'is', null)
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset)
        .execute();
      return this.hydrate(trx, rows as unknown as IdeaRow[]);
    });
  }

  async get(_user: AuthUser, id: string): Promise<Idea> {
    return this.db.runInTenantTx(this.tenantCtx(_user), async (trx) => {
      const row = await trx
        .selectFrom('ideas')
        .select(['id', 'city_id', 'author_user_id', 'title', 'body', 'status', 'created_at'])
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      const [hydrated] = await this.hydrate(trx, [row as unknown as IdeaRow]);
      if (!hydrated) throw new Error('hydration failed');
      return hydrated;
    });
  }

  async create(user: AuthUser, body: CreateBody): Promise<Idea> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const row = await trx
        .insertInto('ideas')
        .values({
          city_id: user.cityId,
          neighborhood_id: body.neighborhoodId ?? null,
          author_user_id: user.id,
          title: body.title,
          body: body.body,
          status: 'draft',
        })
        .returning(['id', 'city_id', 'author_user_id', 'title', 'body', 'status', 'created_at'])
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'idea.create',
        targetType: 'idea',
        targetId: (row as unknown as IdeaRow).id,
        payload: { title: body.title },
      });

      const [hydrated] = await this.hydrate(trx, [row as unknown as IdeaRow]);
      if (!hydrated) throw new Error('hydration failed');
      return hydrated;
    });
  }

  async update(user: AuthUser, id: string, body: UpdateBody): Promise<Idea> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const existing = await trx
        .selectFrom('ideas')
        .select(['id', 'city_id', 'author_user_id', 'title', 'body', 'status', 'created_at'])
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();

      const isOwner = (existing as unknown as IdeaRow).author_user_id === user.id;
      const isAdmin = user.isSuperAdmin || isAdminModerator(user.roleSnapshot);
      if (!isOwner && !isAdmin) {
        throw new ForbiddenException({
          error: { code: 'idea.not_owner', message: 'only the author or an admin may edit this idea' },
        });
      }

      const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch['title'] = body.title;
      if (body.body !== undefined) patch['body'] = body.body;

      const row = await trx
        .updateTable('ideas')
        .set(patch)
        .where('id', '=', id)
        .returning(['id', 'city_id', 'author_user_id', 'title', 'body', 'status', 'created_at'])
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'idea.update',
        targetType: 'idea',
        targetId: id,
        payload: { changes: Object.keys(patch), actor: isAdmin && !isOwner ? 'admin' : 'author' },
      });

      const [hydrated] = await this.hydrate(trx, [row as unknown as IdeaRow]);
      if (!hydrated) throw new Error('hydration failed');
      return hydrated;
    });
  }

  async delete(user: AuthUser, id: string): Promise<void> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const existing = await trx
        .selectFrom('ideas')
        .select('author_user_id')
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      const isOwner = (existing as { author_user_id: string }).author_user_id === user.id;
      const isAdmin = user.isSuperAdmin || isAdminModerator(user.roleSnapshot);
      if (!isOwner && !isAdmin) {
        throw new ForbiddenException({
          error: { code: 'idea.not_owner', message: 'only the author or an admin may delete this idea' },
        });
      }

      // Soft delete: flip `deleted_at` so list/get filters naturally hide it
      // and the row survives audit joins. Hard delete is admin-only and out
      // of scope for citizen flow.
      await trx
        .updateTable('ideas')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'idea.delete',
        targetType: 'idea',
        targetId: id,
        payload: { actor: isAdmin && !isOwner ? 'admin' : 'author' },
      });
    });
  }

  // Toggle: idempotent insert. The schema's PK is (idea_id, user_id) so a
  // duplicate vote 23505s — we treat that as "already upvoted" and no-op.
  // Vote insertion + audit are atomic in the same transaction.
  async vote(user: AuthUser, id: string): Promise<{ ideaId: string; userId: string; upvoted: true }> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const idea = await trx
        .selectFrom('ideas')
        .select('city_id')
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();

      try {
        await trx
          .insertInto('idea_votes')
          .values({
            idea_id: id,
            user_id: user.id,
            city_id: (idea as { city_id: string }).city_id,
          })
          .execute();
      } catch (e) {
        // 23505 unique_violation = (idea_id, user_id) already exists.
        if ((e as { code?: string }).code === '23505') {
          return { ideaId: id, userId: user.id, upvoted: true as const };
        }
        throw e;
      }

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'idea.vote',
        targetType: 'idea',
        targetId: id,
        payload: { value: 1 },
      });

      return { ideaId: id, userId: user.id, upvoted: true as const };
    });
  }

  async unvote(user: AuthUser, id: string): Promise<void> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const r = await trx
        .deleteFrom('idea_votes')
        .where('idea_id', '=', id)
        .where('user_id', '=', user.id)
        .execute();
      const numDeleted = Number((r as { numDeletedRows?: bigint | number }).numDeletedRows ?? 0);
      if (numDeleted === 0) {
        throw new NotFoundException({
          error: { code: 'idea.no_vote', message: 'no active vote for this user' },
        });
      }
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'idea.unvote',
        targetType: 'idea',
        targetId: id,
        payload: {},
      });
    });
  }

  async moderate(
    user: AuthUser,
    id: string,
    body: ModerateBody,
  ): Promise<{ id: string; status: 'published' | 'hidden' | 'rejected' }> {
    // Defense in depth: the controller already gates this with
    // admin.ideas.moderate, but a stale JWT or RBAC cache hit shouldn't
    // escalate — re-check inside the transaction.
    if (!user.isSuperAdmin && !isAdminModerator(user.roleSnapshot)) {
      throw new ForbiddenException({
        error: { code: 'rbac.permission_denied', message: ADMIN_MODERATE },
      });
    }

    const status: 'published' | 'hidden' | 'rejected' =
      body.action === 'publish' ? 'published' : body.action === 'hide' ? 'hidden' : 'rejected';

    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      await trx
        .updateTable('ideas')
        .set({
          status,
          // Set published_at on first publish so downstream feeds can
          // surface it; null on hide/reject keeps semantics simple.
          published_at: status === 'published' ? new Date() : null,
        })
        .where('id', '=', id)
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'idea.moderate',
        targetType: 'idea',
        targetId: id,
        payload: { action: body.action, status },
      });

      return { id, status };
    });
  }

  async listComments(_user: AuthUser, id: string): Promise<IdeaComment[]> {
    return this.db.runInTenantTx(this.tenantCtx(_user), async (trx) => {
      const rows = await trx
        .selectFrom('comments')
        .select(['id', 'parent_type', 'parent_id', 'author_user_id', 'body', 'created_at'])
        .where('parent_type', '=', 'idea')
        .where('parent_id', '=', id)
        .where('status', '=', 'visible')
        .orderBy('created_at', 'desc')
        .execute();
      return (rows as unknown as CommentRow[]).map((r) => ({
        id: r.id,
        parentType: r.parent_type,
        parentId: r.parent_id,
        authorUserId: r.author_user_id,
        body: r.body,
        createdAt: r.created_at,
      }));
    });
  }

  async createComment(
    user: AuthUser,
    id: string,
    body: { body: string },
  ): Promise<{ id: string; parentType: 'idea'; parentId: string; authorUserId: string; body: string }> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      // Confirm idea exists in the same tx so FK violation surfaces as a
      // clean 404 instead of a Postgres error.
      const idea = await trx
        .selectFrom('ideas')
        .select('city_id')
        .where('id', '=', id)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();

      const row = await trx
        .insertInto('comments')
        .values({
          city_id: (idea as { city_id: string }).city_id,
          parent_type: 'idea',
          parent_id: id,
          author_user_id: user.id,
          body: body.body,
          status: 'visible',
        })
        .returning(['id', 'parent_type', 'parent_id', 'author_user_id', 'body'])
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'idea.comment',
        targetType: 'idea',
        targetId: id,
        payload: { comment_id: (row as { id: string }).id },
      });

      const r = row as unknown as CommentRow;
      return {
        id: r.id,
        parentType: 'idea',
        parentId: r.parent_id,
        authorUserId: r.author_user_id,
        body: r.body,
      };
    });
  }

  // Batch hydrate: N idea rows = 1 vote-count query, not N. Avoids the
  // N+1 you'd get from fetching counts per row in list().
  private async hydrate(trx: Db, rows: IdeaRow[]): Promise<Idea[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const counts = await (trx as unknown as {
      selectFrom: (t: string) => {
        select: (s: unknown) => {
          where: (c: string, op: string, v: unknown) => {
            groupBy: (c: string) => {
              execute: () => Promise<Array<{ idea_id: string; vote_count: bigint | number }>>;
            };
          };
        };
      };
    })
      .selectFrom('idea_votes')
      .select((eb: unknown) => ({
        idea_id: (eb as { ref: (c: string) => unknown }).ref('idea_id'),
        vote_count: (eb as { fn: (n: string) => { as: (a: string) => unknown } }).fn('count').as('vote_count'),
      }))
      .where('idea_id', 'in', ids)
      .groupBy('idea_id')
      .execute();

    const countById = new Map(counts.map((c) => [c.idea_id, Number(c.vote_count)]));
    return rows.map((r) => ({
      id: r.id,
      cityId: r.city_id,
      authorUserId: r.author_user_id,
      title: r.title,
      body: r.body,
      status: r.status,
      upvoteCount: countById.get(r.id) ?? 0,
      createdAt: r.created_at,
    }));
  }

  private tenantCtx(user: AuthUser) {
    return {
      cityId: user.cityId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      requestId: user.requestId ?? '',
    };
  }
}

// Keep DbService['kysely'] type alias for the hydrate helper below.
type Db = DbService['kysely'];