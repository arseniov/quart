import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { createDb } from '@quart/db';
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { phoneNumber } from 'better-auth/plugins';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';

/** Where shape BA passes to the adapter (subset of the BA 1.x Adapter type). */
type BaWhere = {
  field: string;
  value: unknown;
  operator?:
    | 'eq'
    | 'ne'
    | 'lt'
    | 'lte'
    | 'gt'
    | 'gte'
    | 'in'
    | 'contains'
    | 'starts_with'
    | 'ends_with';
  connector?: 'AND' | 'OR';
};

/** Map BA's operator strings to Kysely operator strings. */
const kyselyOp = (op: BaWhere['operator']): string => {
  switch (op) {
    case 'ne':
      return '<>';
    case 'lt':
      return '<';
    case 'lte':
      return '<=';
    case 'gt':
      return '>';
    case 'gte':
      return '>=';
    case 'in':
      return 'in';
    case 'contains':
    case 'starts_with':
    case 'ends_with':
      return 'like';
    default:
      return '=';
  }
};

/** Apply LIKE wildcards for substring operators. */
const likeValue = (op: BaWhere['operator'], value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  if (op === 'contains') return `%${value}%`;
  if (op === 'starts_with') return `${value}%`;
  if (op === 'ends_with') return `%${value}`;
  return value;
};

/**
 * Chain BA's where array onto a Kysely builder. The first clause is always
 * AND (no prior clause to connect to); subsequent clauses honour the
 * connector (default AND). Ponytail: this is the only operator / connector
 * logic in the adapter; everything else is a thin pass-through to Kysely.
 */
// ponytail: typed `any` because the BA model names don't appear on the
// Quart DB type and Kysely's typed builder chains differ per query kind.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applyWhere = (q: any, where: BaWhere[] | undefined): any => {
  if (!where) return q;
  for (let i = 0; i < where.length; i++) {
    // eslint-disable-next-line security/detect-object-injection
    const w = where[i];
    if (w === undefined) continue;
    const op = kyselyOp(w.operator);
    const value = likeValue(w.operator, w.value);
    if (i === 0 || (w.connector ?? 'AND') === 'AND') {
      q = q.where(w.field, op, value);
    } else {
      q = q.orWhere(w.field, op, value);
    }
  }
  return q;
};

/**
 * Wraps a configured Better Auth instance. The Kysely adapter talks to the
 * BA core schema (`user` / `session` / `account` / `verification`) created
 * by migration 0025. Tenant scoping is intentionally not wired here: BA
 * owns sign-in / session issuance; city scope flows through runInTenantTx
 * once the JWT arrives at a downstream endpoint.
 */
@Injectable()
export class AuthService {
  readonly instance: ReturnType<typeof betterAuth>;

  constructor(config: ConfigService) {
    const db = createDb({ connectionString: config.env.DATABASE_URL });
    const options: BetterAuthOptions = {
      secret: config.env.BETTER_AUTH_SECRET,
      baseURL: config.env.BETTER_AUTH_URL,
      database: this.kyselyAdapter(db),
      emailAndPassword: { enabled: true },
      socialProviders: {
        google: {
          clientId: process.env.GOOGLE_CLIENT_ID ?? '',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
        },
        apple: {
          clientId: process.env.APPLE_CLIENT_ID ?? '',
          clientSecret: process.env.APPLE_CLIENT_SECRET ?? '',
        },
      },
      plugins: [phoneNumber()],
    };
    this.instance = betterAuth(options);
  }

  // ponytail: BA's adapter methods are typed in better-auth; we cast to
  // `never` on the model name because `user` / `session` / etc. don't exist
  // on the Quart DB type. All queries use Kysely's parameterized form.
  private kyselyAdapter(db: ReturnType<typeof createDb>) {
    const table = (model: string) => model as never;
    return () => ({
      id: 'kysely',
      create: async ({
        model,
        data,
      }: {
        model: string;
        data: Record<string, unknown>;
        select?: string[];
      }) => {
        // ponytail: BA's built-in kysely adapter generates IDs via nanoid in
        // its own `transformInput`. Our adapter is hand-rolled, so we fill
        // in `id` here when BA hasn't supplied one. UUIDs work because the
        // migration declares `id` as `text`.
        const values = data.id === undefined ? { ...data, id: randomUUID() } : data;
        const row = await db
          .insertInto(table(model))
          .values(values as never)
          .returningAll()
          .executeTakeFirstOrThrow();
        return row;
      },
      findOne: async <T>({
        model,
        where,
      }: {
        model: string;
        where: BaWhere[];
        select?: string[];
      }): Promise<T | null> => {
        const q = applyWhere(db.selectFrom(table(model)).selectAll(), where);
        return ((await q.executeTakeFirst()) ?? null) as T | null;
      },
      findMany: async <T>({
        model,
        where,
        limit,
        offset,
      }: {
        model: string;
        where?: BaWhere[];
        limit?: number;
        offset?: number;
      }): Promise<T[]> => {
        let q = applyWhere(db.selectFrom(table(model)).selectAll(), where);
        if (limit !== undefined) q = q.limit(limit) as never;
        if (offset !== undefined) q = q.offset(offset) as never;
        return (await q.execute()) as T[];
      },
      update: async <T>({
        model,
        where,
        update,
      }: {
        model: string;
        where: BaWhere[];
        update: Record<string, unknown>;
      }): Promise<T | null> => {
        const q = applyWhere(db.updateTable(table(model)).set(update as never), where);
        const rows = await q.returningAll().execute();
        return (rows[0] as T | undefined) ?? null;
      },
      updateMany: async ({
        model,
        where,
        update,
      }: {
        model: string;
        where: BaWhere[];
        update: Record<string, unknown>;
      }): Promise<number> => {
        const q = applyWhere(db.updateTable(table(model)).set(update as never), where);
        const rows = await q.execute();
        return rows.length;
      },
      delete: async ({ model, where }: { model: string; where: BaWhere[] }): Promise<void> => {
        const q = applyWhere(db.deleteFrom(table(model)), where);
        await q.execute();
      },
      deleteMany: async ({
        model,
        where,
      }: {
        model: string;
        where: BaWhere[];
      }): Promise<number> => {
        const q = applyWhere(db.deleteFrom(table(model)), where);
        const rows = await q.execute();
        return rows.length;
      },
    });
  }
}
