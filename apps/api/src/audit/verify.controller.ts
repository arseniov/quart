import { Controller, Get, UseGuards } from '@nestjs/common';
import { computeRowHash, GENESIS_PREV_HASH } from '@quart/db';

import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { DbService } from '../db/db.service.js';

// Per-city chain walk — recomputes HMAC for every row and asserts prev_hash
// linkage. Mirrors `quart_security.compute_audit_row_hash` (0013) exactly:
// HMAC-SHA256(key, prev_hash || payload_canonical_sha256).
// ponytail: RBAC + per-city scoping arrive in T22+; for T20 the endpoint is
// JwtAuthGuard-gated and walks the whole table. Add a cityId filter and
// admin.audit.verify permission check when Phase 5 lands.
@Controller('admin/audit')
@UseGuards(JwtAuthGuard)
export class VerifyController {
  constructor(
    private readonly db: DbService,
    private readonly config: ConfigService,
  ) {}

  @Get('verify')
  async verify() {
    const rows = await this.db.kysely
      .selectFrom('audit_log')
      .select(['id', 'prev_hash', 'payload_canonical_sha256', 'row_hash'])
      .orderBy('id', 'asc')
      .execute();

    let expected = GENESIS_PREV_HASH;
    let checked = 0;
    for (const row of rows) {
      const actual = computeRowHash(
        { prev_hash: row.prev_hash, payload_canonical_sha256: row.payload_canonical_sha256 },
        this.config.env.AUDIT_HMAC_KEY,
      );
      if (actual !== row.row_hash || row.prev_hash !== expected) {
        return { status: 'broken', broken_at_id: String(row.id), checked };
      }
      expected = row.row_hash;
      checked++;
    }
    return { status: 'ok', checked };
  }
}