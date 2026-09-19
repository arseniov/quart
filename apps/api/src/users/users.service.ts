import { GoneException, Injectable, NotFoundException } from '@nestjs/common';

// Value (not `import type`) so vitest's decorator-metadata plugin emits
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

import type { PublicUserDto } from './users.dto.js';

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  created_at: Date;
  status: 'active' | 'suspended' | 'deleted';
}

/**
 * Map the DB row to the public DTO. Field whitelist — do NOT `Object.assign`
 * the raw row here. Anything missing from this map is excluded from the
 * response by construction.
 */
function toPublicUser(
  row: UserRow,
  stats: { ideasCount: number; issuesCount: number; pollsCount: number },
): PublicUserDto {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    joinedAt: row.created_at.toISOString(),
    publicStats: stats,
  };
}

@Injectable()
export class UsersService {
  constructor(private readonly db: DbService) {}

  /**
   * Lookup a user by id and return a sanitized public projection.
   *
   * We return 200 for `suspended` (treated like `active`) — only `deleted` deserves the explicit gone signal.
   *
   * The stats counts run as three parallel `countAll`s on the per-user
   * content tables. They're unfiltered by status — including drafts
   * would leak unpublished content existence; include only published/visible
   * rows so the public sees the same numbers the user sees in their own
   * dashboard.
   */
  async findPublicById(id: string): Promise<PublicUserDto> {
    const row = await this.db.kysely
      .selectFrom('users')
      .select(['id', 'handle', 'display_name', 'avatar_url', 'created_at', 'status'])
      .where('id', '=', id)
      .executeTakeFirst();

    if (!row) throw new NotFoundException({ error: { code: 'user.not_found', message: 'user not found' } });
    if (row.status === 'deleted') {
      throw new GoneException({ error: { code: 'user.gone', message: 'user deleted' } });
    }

    const [ideasCountRow, issuesCountRow, pollsCountRow] = await Promise.all([
      this.db.kysely
        .selectFrom('ideas')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('author_user_id', '=', id)
        .where('status', '=', 'published')
        .executeTakeFirst(),
      this.db.kysely
        .selectFrom('issues')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('author_user_id', '=', id)
        .executeTakeFirst(),
      this.db.kysely
        .selectFrom('polls')
        .select((eb) => eb.fn.countAll<string>().as('c'))
        .where('created_by_user_id', '=', id)
        .executeTakeFirst(),
    ]);

    return toPublicUser(row as unknown as UserRow, {
      ideasCount: Number(ideasCountRow?.c ?? 0),
      issuesCount: Number(issuesCountRow?.c ?? 0),
      pollsCount: Number(pollsCountRow?.c ?? 0),
    });
  }
}
