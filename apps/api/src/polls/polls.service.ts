import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameters below.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { AuditService } from '../audit/audit.service.js';
import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import type { CreatePollInput, ListPollsQuery, UpdatePollInput } from './polls.dto.js';

export interface Poll {
  id: string;
  cityId: string;
  neighborhoodId: string | null;
  title: string;
  body: string | null;
  createdByUserId: string;
  opensAt: Date;
  closesAt: Date;
  status: 'draft' | 'open' | 'closed' | 'cancelled';
  resultsVisibility: 'always' | 'after_close' | 'never';
  createdAt: Date;
}

export interface PollOption {
  id: string;
  pollId: string;
  label: string;
  sortOrder: number;
}

export interface PollVoteCount {
  optionId: string;
  count: number;
}

interface PollRow {
  id: string;
  city_id: string;
  neighborhood_id: string | null;
  title: string;
  body: string | null;
  created_by_user_id: string;
  opens_at: Date;
  closes_at: Date;
  status: 'draft' | 'open' | 'closed' | 'cancelled';
  results_visibility: 'always' | 'after_close' | 'never';
  created_at: Date;
}

interface OptionRow {
  id: string;
  poll_id: string;
  label: string;
  sort_order: number;
}

const toPoll = (r: PollRow): Poll => ({
  id: r.id,
  cityId: r.city_id,
  neighborhoodId: r.neighborhood_id,
  title: r.title,
  body: r.body,
  createdByUserId: r.created_by_user_id,
  opensAt: r.opens_at,
  closesAt: r.closes_at,
  status: r.status,
  resultsVisibility: r.results_visibility,
  createdAt: r.created_at,
});

const toOption = (r: OptionRow): PollOption => ({
  id: r.id,
  pollId: r.poll_id,
  label: r.label,
  sortOrder: r.sort_order,
});

// `audit_log.on_behalf_of_user_id` is null by default; impersonation sets it
// via req.tenant.onBehalfOfUserId in T21. Ponytail: keep null until T31
// threads it through controller params.
@Injectable()
export class PollsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser, q: ListPollsQuery): Promise<Poll[]> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      let query = trx
        .selectFrom('polls')
        .selectAll()
        .where('city_id', '=', q.cityId);
      if (q.status) query = query.where('status', '=', q.status);
      const rows = await query
        .orderBy('opens_at', 'desc')
        .limit(q.limit)
        .offset((q.page - 1) * q.limit)
        .execute();
      return (rows as unknown as PollRow[]).map(toPoll);
    });
  }

  async get(user: AuthUser, id: string) {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const pollRow = await trx
        .selectFrom('polls')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      const optionRows = await trx
        .selectFrom('poll_options')
        .selectAll()
        .where('poll_id', '=', id)
        .orderBy('sort_order', 'asc')
        .execute();
      const countRows = await trx
        .selectFrom('poll_votes')
        .select((eb) => [eb.fn.countAll<string>().as('count'), 'option_id'])
        .where('poll_id', '=', id)
        .groupBy('option_id')
        .execute();
      return {
        poll: toPoll(pollRow as unknown as PollRow),
        options: (optionRows as unknown as OptionRow[]).map(toOption),
        counts: (countRows as { option_id: string; count: string | number }[]).map((r) => ({
          optionId: r.option_id,
          count: Number(r.count),
        })),
      };
    });
  }

  async create(user: AuthUser, body: CreatePollInput) {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const pollRow = await trx
        .insertInto('polls')
        .values({
          city_id: body.cityId,
          neighborhood_id: body.neighborhoodId ?? null,
          created_by_user_id: user.id,
          title: body.title,
          body: body.body ?? null,
          opens_at: body.opensAt,
          closes_at: body.closesAt,
          status: 'draft',
          results_visibility: body.resultsVisibility,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      const optionValues = body.options.map((o, i) => ({
        poll_id: (pollRow as unknown as PollRow).id,
        label: o.label,
        sort_order: o.sortOrder ?? i,
      }));
      const optionRows = await trx
        .insertInto('poll_options')
        .values(optionValues)
        .returningAll()
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'poll.create',
        targetType: 'poll',
        targetId: (pollRow as unknown as PollRow).id,
        payload: { title: body.title, option_count: optionRows.length },
      });

      return {
        ...toPoll(pollRow as unknown as PollRow),
        options: (optionRows as unknown as OptionRow[]).map(toOption),
      };
    });
  }

  async update(user: AuthUser, id: string, body: UpdatePollInput): Promise<Poll> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const existing = await trx
        .selectFrom('polls')
        .select(['status'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!existing) {
        throw new NotFoundException({
          error: { code: 'poll.not_found', message: 'poll not found' },
        });
      }
      if (existing.status !== 'draft') {
        // ponytail: published polls are immutable from the citizen surface;
        // admin moderation can cancel (admin.issues.status equivalent) but
        // that's out of scope for T25 — add admin.polls.update when needed.
        throw new ConflictException({
          error: { code: 'poll.locked', message: 'only draft polls can be modified' },
        });
      }

      const patch: Record<string, unknown> = {};
      if (body.title !== undefined) patch['title'] = body.title;
      if (body.body !== undefined) patch['body'] = body.body;
      if (body.neighborhoodId !== undefined) patch['neighborhood_id'] = body.neighborhoodId;
      if (body.opensAt !== undefined) patch['opens_at'] = body.opensAt;
      if (body.closesAt !== undefined) patch['closes_at'] = body.closesAt;
      if (body.resultsVisibility !== undefined) patch['results_visibility'] = body.resultsVisibility;

      const updated = await trx
        .updateTable('polls')
        .set(patch)
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'poll.update',
        targetType: 'poll',
        targetId: id,
        payload: { changes: Object.keys(patch) },
      });

      return toPoll(updated as unknown as PollRow);
    });
  }

  async delete(user: AuthUser, id: string): Promise<void> {
    await this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const existing = await trx
        .selectFrom('polls')
        .select(['title'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!existing) {
        throw new NotFoundException({
          error: { code: 'poll.not_found', message: 'poll not found' },
        });
      }
      await trx.deleteFrom('polls').where('id', '=', id).execute();
      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'poll.delete',
        targetType: 'poll',
        targetId: id,
        payload: { title: existing.title },
      });
    });
  }

  async publish(user: AuthUser, id: string): Promise<Poll> {
    return this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const existing = await trx
        .selectFrom('polls')
        .select(['status', 'city_id'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!existing) {
        throw new NotFoundException({
          error: { code: 'poll.not_found', message: 'poll not found' },
        });
      }
      if (existing.status === 'open') {
        const row = await trx
          .selectFrom('polls')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        return toPoll(row as unknown as PollRow);
      }
      if (existing.status !== 'draft') {
        throw new ConflictException({
          error: { code: 'poll.not_publishable', message: 'only draft polls can be published' },
        });
      }

      const updated = await trx
        .updateTable('polls')
        .set({ status: 'open' })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'poll.publish',
        targetType: 'poll',
        targetId: id,
        payload: { previous_status: existing.status },
      });

      return toPoll(updated as unknown as PollRow);
    });
  }

  async vote(user: AuthUser, pollId: string, body: { optionId: string }): Promise<void> {
    await this.db.runInTenantTx(this.tenantCtx(user), async (trx) => {
      const poll = await trx
        .selectFrom('polls')
        .select(['id', 'status', 'city_id'])
        .where('id', '=', pollId)
        .executeTakeFirst();
      if (!poll) {
        throw new NotFoundException({
          error: { code: 'poll.not_found', message: 'poll not found' },
        });
      }
      if (poll.status !== 'open') {
        throw new ConflictException({
          error: { code: 'poll.not_open', message: 'poll is not open for voting' },
        });
      }
      const option = await trx
        .selectFrom('poll_options')
        .select(['id', 'poll_id'])
        .where('id', '=', body.optionId)
        .executeTakeFirst();
      if (!option || option.poll_id !== pollId) {
        throw new NotFoundException({
          error: { code: 'poll_option.not_found', message: 'option does not belong to this poll' },
        });
      }

      // Upsert — PK (poll_id, user_id) makes this idempotent so a re-vote
      // simply switches the chosen option. Vote count is derived from
      // poll_votes at read time; no denormalised counter to drift.
      await trx
        .insertInto('poll_votes')
        .values({
          poll_id: pollId,
          option_id: body.optionId,
          user_id: user.id,
          city_id: poll.city_id,
        })
        .onConflict((oc) =>
          oc.columns(['poll_id', 'user_id']).doUpdateSet({ option_id: body.optionId }),
        )
        .execute();

      await this.audit.write(trx, {
        tenant: this.tenantCtx(user),
        action: 'poll.vote',
        targetType: 'poll',
        targetId: pollId,
        payload: { option_id: body.optionId },
      });
    });
  }

  private tenantCtx(user: AuthUser) {
    return {
      cityId: user.cityId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      requestId: '',
    };
  }
}
