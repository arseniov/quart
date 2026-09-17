import { Injectable } from '@nestjs/common';

import type { AuthUser } from '../auth/decorators/current-user.decorator.js';
// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the DbService constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import type { SearchKind, SearchQuery } from './search.dto.js';

export interface SearchHit {
  id: string;
  kind: SearchKind;
  cityId: string;
  createdAt: Date;
  // `ts_rank` for FTS matches; null for the ILIKE fallback (polls has no
  // `search_tsv` column — 0009 only adds it to issues/ideas/comments).
  rank: number | null;
  title: string;
}

interface IssueHit {
  id: string;
  city_id: string;
  created_at: Date;
  rank: number;
  title: string;
}
interface PollHit {
  id: string;
  city_id: string;
  created_at: Date;
  title: string;
}

/**
 * Ponytail: per-table SELECT chain — the kinds diverge (FTS vs ILIKE,
 * different column projections) and a single generic builder is more code
 * than three short branches. tsvector uses `simple` config per 0009's
 * comment; switch to 'italian'/'english' when locale-aware ranking matters.
 */
@Injectable()
export class SearchService {
  constructor(private readonly db: DbService) {}

  async search(user: AuthUser, q: SearchQuery): Promise<SearchHit[]> {
    const tenant = {
      cityId: user.cityId,
      userId: user.id,
      isSuperAdmin: user.isSuperAdmin,
      requestId: user.requestId ?? '',
    };
    const offset = (q.page - 1) * q.limit;
    const kind: SearchKind = q.kind ?? 'issue';
    return this.db.runInTenantTx(tenant, async (trx) => {
      if (kind === 'poll') {
        return this.ilikeSearch(trx, q.q, q.cityId, q.limit, offset);
      }
      return this.tsvectorSearch(trx, kind, q.q, q.cityId, q.limit, offset);
    });
  }

  private async tsvectorSearch(
    trx: { selectFrom: (t: string) => unknown },
    kind: SearchKind,
    q: string,
    cityId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<SearchHit[]> {
    const table = kind === 'issue' ? 'issues' : kind === 'idea' ? 'ideas' : 'comments';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = trx as any;
    const titleCol = kind === 'comment' ? 'body' : 'title';
    const rows = (await builder
      .selectFrom(table)
      .select([
        'id',
        'city_id',
        titleCol,
        'created_at',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (eb: any) => eb.fn('ts_rank', ['search_tsv', eb.fn('to_tsquery', ['simple', q])]).as('rank'),
      ])
      .where('search_tsv', '@@', (eb: { fn: (s: string, args: unknown[]) => unknown }) =>
        eb.fn('to_tsquery', ['simple', q]),
      )
      .$if(cityId !== undefined, (qb: { where: (col: string, op: string, val: string) => unknown }) =>
        qb.where('city_id', '=', cityId as string),
      )
      .orderBy('rank', 'desc')
      .limit(limit)
      .offset(offset)
      .execute()) as IssueHit[];
    return rows.map((r) => ({
      id: r.id,
      kind,
      cityId: r.city_id,
      createdAt: r.created_at,
      rank: Number(r.rank),
      title: (r as { title?: string }).title ?? '',
    }));
  }

  private async ilikeSearch(
    trx: { selectFrom: (t: string) => unknown },
    q: string,
    cityId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<SearchHit[]> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder = trx as any;
    const like = `%${q}%`;
    const rows = (await builder
      .selectFrom('polls')
      .select(['id', 'city_id', 'title', 'created_at'])
      .where('title', 'ILIKE', like)
      .$if(cityId !== undefined, (qb: { where: (col: string, op: string, val: string) => unknown }) =>
        qb.where('city_id', '=', cityId as string),
      )
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute()) as PollHit[];
    return rows.map((r) => ({
      id: r.id,
      kind: 'poll',
      cityId: r.city_id,
      createdAt: r.created_at,
      rank: null,
      title: r.title,
    }));
  }
}