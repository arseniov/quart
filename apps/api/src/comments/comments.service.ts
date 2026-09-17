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
import type { TenantContext } from '../db/run-in-tenant-tx.js';

import type {
  CreateCommentBody,
  ListCommentsQuery,
  ReactBody,
  ReactionType,
  UpdateCommentBody,
} from './comments.dto.js';

interface CommentRow {
  id: string;
  city_id: string;
  parent_type: string;
  parent_id: string;
  author_user_id: string;
  body: string;
  status: string;
  created_at: Date;
  deleted_at: Date | null;
}

interface ReactionRow {
  reaction: ReactionType;
  user_id?: string;
  count?: number;
}

/**
 * Roles that bypass author-only enforcement on update/delete. Matches the
 * `moderator` and `quart_admin` role grants in 0021_seed_roles_permissions.
 * `super_admin` bypass is handled via `isSuperAdmin` on the AuthUser.
 */
const MODERATOR_ROLES = new Set(['moderator', 'quart_admin']);

@Injectable()
export class CommentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /**
   * List visible comments for a polymorphic target. Soft-deleted rows are
   * excluded at the SQL boundary (status filter); the `deleted_at` column
   * is kept for audit timeline reconstruction.
   */
  async list(
    query: ListCommentsQuery,
    tenant: TenantContext,
  ): Promise<CommentRow[]> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const rows = await trx
        .selectFrom('comments')
        .selectAll()
        .where('parent_type', '=', query.targetType as never)
        .where('parent_id', '=', query.targetId)
        .where('status', '=', 'visible')
        .orderBy('created_at', 'desc')
        .limit(query.limit)
        .offset(query.offset)
        .execute();
      return rows as CommentRow[];
    });
  }

  async get(id: string, tenant: TenantContext): Promise<CommentRow & { reactions: ReactionRow[] }> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const row = await trx
        .selectFrom('comments')
        .selectAll()
        .where('id', '=', id)
        .where('status', '=', 'visible')
        .executeTakeFirst();
      if (!row) throw new NotFoundException({ error: { code: 'comment.not_found', message: 'comment not found' } });
      const reactions = await trx
        .selectFrom('comment_reactions')
        .selectAll()
        .where('comment_id', '=', id)
        .execute();
      return { ...(row as CommentRow), reactions: reactions as ReactionRow[] };
    });
  }

  async create(
    body: CreateCommentBody,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<CommentRow> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const row = await trx
        .insertInto('comments')
        .values({
          city_id: tenant.cityId,
          parent_type: body.targetType,
          parent_id: body.targetId,
          author_user_id: user.id,
          body: body.body,
          status: 'visible',
        } as never)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant,
        action: 'comment.create',
        targetType: 'comment',
        targetId: row.id,
        payload: {
          parent_type: body.targetType,
          parent_id: body.targetId,
          author_user_id: user.id,
        },
      });

      return row as CommentRow;
    });
  }

  async update(
    id: string,
    body: UpdateCommentBody,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<CommentRow> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const existing = await this.requireAuthorOrModerator(trx, id, user, 'comment.update_denied');
      const row = await trx
        .updateTable('comments')
        .set({ body: body.body } as never)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant,
        action: 'comment.update',
        targetType: 'comment',
        targetId: id,
        payload: { author_user_id: existing.author_user_id, edited_by: user.id },
      });

      return row as CommentRow;
    });
  }

  /**
   * Soft-delete: sets `status='deleted'` + `deleted_at=now()`. Author-only
   * by default; moderators and super-admins may delete any comment.
   */
  async delete(id: string, user: AuthUser, tenant: TenantContext): Promise<void> {
    await this.db.runInTenantTx(tenant, async (trx) => {
      await this.requireAuthorOrModerator(trx, id, user, 'comment.delete_denied');
      await trx
        .updateTable('comments')
        .set({ status: 'deleted', deleted_at: new Date() } as never)
        .where('id', '=', id)
        .execute();

      await this.audit.write(trx, {
        tenant,
        action: 'comment.delete',
        targetType: 'comment',
        targetId: id,
        payload: { deleted_by: user.id },
      });
    });
  }

  /**
   * Toggle a reaction (up/down) for a comment. If the (comment, user, reaction)
   * row already exists, remove it; otherwise insert it. Audit row carries
   * the resulting action ('comment.react.add' or 'comment.react.remove') so
   * downstream analytics don't need to diff state.
   */
  async react(
    id: string,
    body: ReactBody,
    user: AuthUser,
    tenant: TenantContext,
  ): Promise<{ status: 'added' | 'removed' }> {
    return this.db.runInTenantTx(tenant, async (trx) => {
      const comment = await trx
        .selectFrom('comments')
        .select(['id', 'status'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!comment || comment.status !== 'visible') {
        throw new NotFoundException({ error: { code: 'comment.not_found', message: 'comment not found' } });
      }

      const existing = await trx
        .selectFrom('comment_reactions')
        .selectAll()
        .where('comment_id', '=', id)
        .where('user_id', '=', user.id)
        .where('reaction', '=', body.reaction as never)
        .executeTakeFirst();

      if (existing) {
        await trx
          .deleteFrom('comment_reactions')
          .where('comment_id', '=', id)
          .where('user_id', '=', user.id)
          .where('reaction', '=', body.reaction as never)
          .execute();

        await this.audit.write(trx, {
          tenant,
          action: 'comment.react.remove',
          targetType: 'comment',
          targetId: id,
          payload: { user_id: user.id, reaction: body.reaction },
        });
        return { status: 'removed' };
      }

      await trx
        .insertInto('comment_reactions')
        .values({
          comment_id: id,
          user_id: user.id,
          reaction: body.reaction,
        } as never)
        .execute();

      await this.audit.write(trx, {
        tenant,
        action: 'comment.react.add',
        targetType: 'comment',
        targetId: id,
        payload: { user_id: user.id, reaction: body.reaction },
      });
      return { status: 'added' };
    });
  }

  /**
   * Author-or-moderator enforcement. Reads the existing row to compare
   * `author_user_id`. The thrown ForbiddenException is the same shape as
   * Nest's built-in so the AllExceptionsFilter renders it as the standard
   * error envelope.
   */
  private async requireAuthorOrModerator(
    trx: { selectFrom: (t: string) => unknown },
    id: string,
    user: AuthUser,
    code: string,
  ): Promise<{ author_user_id: string }> {
    const row = await (trx as unknown as { selectFrom: (t: string) => { selectAll: () => { where: (col: string, op: string, val: string) => { executeTakeFirst: () => Promise<unknown> } } } })
      .selectFrom('comments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) {
      throw new NotFoundException({ error: { code: 'comment.not_found', message: 'comment not found' } });
    }
    const isAuthor = (row as { author_user_id: string }).author_user_id === user.id;
    const isMod = !!user.roleSnapshot?.some((r) => MODERATOR_ROLES.has(r));
    if (!isAuthor && !isMod && !user.isSuperAdmin) {
      throw new ForbiddenException({ error: { code, message: 'comment may only be modified by its author or a moderator' } });
    }
    return row as { author_user_id: string };
  }
}
