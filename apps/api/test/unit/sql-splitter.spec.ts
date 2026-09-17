import { describe, expect, it } from 'vitest';

// Inlined from apps/api/test/e2e/fixtures/boot-app.ts:splitStatements so
// the regression test doesn't depend on the e2e fixture file. If the
// fixture's splitter drifts, copy the new version into here.
const splitStatements = (sql: string): string[] => {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  let inDollar = false;
  let quote: "'" | '"' | null = null;
  while (i < sql.length) {
    const c = sql[i] ?? '';
    const next = sql[i + 1] ?? '';
    if (quote) {
      buf += c;
      if (c === quote && next === quote) {
        buf += next;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') {
        buf += sql[i];
        i += 1;
      }
      continue;
    }
    if (c === '$' && next === '$') {
      inDollar = !inDollar;
      buf += '$$';
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      buf += c;
      i += 1;
      continue;
    }
    if (c === ';' && !inDollar) {
      buf += ';';
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
      i += 1;
      continue;
    }
    buf += c;
    i += 1;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
};

describe('splitStatements (e2e boot-app fixture SQL splitter)', () => {
  it('splits on `;` outside of any context', () => {
    expect(splitStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1;', 'SELECT 2;']);
  });

  it('ignores `;` inside $$...$$ dollar-quoted bodies', () => {
    const sql = "DO $$ BEGIN RAISE NOTICE 'a;'; END $$; SELECT 1;";
    expect(splitStatements(sql)).toEqual([
      "DO $$ BEGIN RAISE NOTICE 'a;'; END $$;",
      'SELECT 1;',
    ]);
  });

  it('ignores `;` inside single-quoted strings (gh #4 regression)', () => {
    // Migration 0038 seeded a sentinel city whose name literally contains `;`.
    // The naive splitter broke the INSERT INTO cities (...) VALUES (...); statement
    // at the embedded `;`, leaving the literal unterminated and Postgres
    // returning "unterminated quoted string".
    const sql = `INSERT INTO cities (id, slug, name, country_code, default_locale, timezone, status) VALUES (
  '00000000-0000-0000-0000-000000000099',
  '__system',
  '__system (admin-managed; never user-facing)',
  'IT', 'it', 'UTC', 'inactive'
);`;
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toContain('(admin-managed; never user-facing)');
    expect(stmts[0]?.trimEnd().endsWith(';')).toBe(true);
  });

  it('handles SQL doubled-quote escape for empty string and quote-in-quote', () => {
    // '' is an empty string; 'don''t' is the literal "don't". The splitter must
    // not split a string at the escape boundary.
    const sql = `SELECT '' AS empty, 'don''t' AS squished, nullif(x, '');`;
    expect(splitStatements(sql)).toEqual([
      `SELECT '' AS empty, 'don''t' AS squished, nullif(x, '');`,
    ]);
  });

  it('ignores `;` inside -- line comments', () => {
    const sql = `-- this ; is in a comment\nSELECT 1; -- trailing ; comment\nSELECT 2;`;
    expect(splitStatements(sql)).toEqual([
      '-- this ; is in a comment\nSELECT 1;',
      '-- trailing ; comment\nSELECT 2;',
    ]);
  });

  it('ignores `;` inside "double-quoted" identifiers', () => {
    expect(splitStatements('CREATE TABLE "weird;name" (id int);')).toEqual([
      'CREATE TABLE "weird;name" (id int);',
    ]);
  });

  it('handles all 35 migrations without producing unbalanced quotes', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const dir = '/home/giacomo/coding/quart/infrastructure/postgres/migrations';
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.up.sql'))
      .sort();
    expect(files.length).toBeGreaterThan(30);
    // Strip comments + $$ bodies before counting quotes (apostrophes in
    // comments are not actually quote characters).
    const strip = (sql: string): string => {
      let out = '';
      let i = 0;
      let inDollar = false;
      while (i < sql.length) {
        const c = sql[i] ?? '';
        const next = sql[i + 1] ?? '';
        if (inDollar) {
          if (c === '$' && next === '$') {
            inDollar = false;
            i += 2;
            continue;
          }
          i += 1;
          continue;
        }
        if (c === '-' && next === '-') {
          while (i < sql.length && sql[i] !== '\n') i += 1;
          continue;
        }
        if (c === '$' && next === '$') {
          inDollar = true;
          i += 2;
          continue;
        }
        out += c;
        i += 1;
      }
      return out;
    };
    for (const f of files) {
      const sql = readFileSync(path.join(dir, f), 'utf8');
      const stmts = splitStatements(sql);
      for (const s of stmts) {
        const cleaned = strip(s);
        const sq = (cleaned.match(/'/g) ?? []).length;
        const dq = (cleaned.match(/"/g) ?? []).length;
        expect(sq % 2, `unbalanced ' in ${f}: ${s.slice(0, 100)}`).toBe(0);
        expect(dq % 2, `unbalanced " in ${f}: ${s.slice(0, 100)}`).toBe(0);
      }
    }
  });
});
