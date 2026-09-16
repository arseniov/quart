/**
 * CI assertion (T60): a synthetic Sentry event built from every shape the
 * `beforeSend` scrubber claims to cover is fed through `beforeSendForSentry`,
 * then walked to confirm no PII strings/keys remain. Fails CI on regression
 * — every PR must keep this green.
 *
 * Mirrors T58's `check-openapi-drift.ts` shape: a pure helper
 * (`verifyRedaction`) exported for vitest, plus a `main()` entry-point
 * guarded by `process.argv[1]` so the unit suite can import the helper
 * without `process.exit` aborting the runner.
 *
 * No Sentry DSN required — the script calls the scrubber function directly,
 * bypassing `Sentry.init`. No real PII in fixtures (use obvious fake values
 * so a regex match failure is unambiguous).
 */
import { strict as assert } from 'node:assert';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  beforeSendForSentry,
  CYCLE_MARKER,
  DEPTH_CAPPED_MARKER,
  REDACTED,
} from '../observability/sentry.js';

/**
 * Fixture PII — obvious fake values, intentionally NOT a real domain
 * (`user@example.com`) and NOT the docs RFC5737 IP (`203.0.113.42`) so a
 * leak shows up unambiguously in the substring scan.
 *
 * Calibrated to what `beforeSendForSentry` actually scrubs (per its
 * docstring + the regex set + PII_KEYS):
 *   - email/IP/Italian CF/Italian VAT get regex-scrubbed from free text
 *   - phone numbers get redacted only when they sit under a `phone` key
 *     (no phone regex exists in the scrubber)
 *   - password / token / etc. are PII keys → value replaced wholesale
 */
const FAKE_EMAIL = 'pii-leak@example.test';
const FAKE_EMAIL_2 = 'second-leak@example.test';
const FAKE_IPV4 = '198.51.100.42';
const FAKE_IPV6 = '2001:db8::1';
const FAKE_PHONE = '+391234567890';
// 6L + 2D + 1L + 2D + 1L + 3D + 1L — matches the scrubber's CF regex.
const FAKE_CF = 'ABCDEF12A34A567B';
const FAKE_VAT = '12345678901';
const FAKE_PASSWORD = 'hunter2-pii-leak';
const FAKE_TOKEN = 'eyJpii-leak-token';

const FORBIDDEN_SUBSTRINGS: readonly string[] = [
  FAKE_EMAIL,
  FAKE_EMAIL_2,
  FAKE_IPV4,
  FAKE_IPV6,
  FAKE_PHONE,
  FAKE_CF,
  FAKE_VAT,
  FAKE_PASSWORD,
  FAKE_TOKEN,
];

const FORBIDDEN_KEYS: readonly string[] = [
  'password',
  'token',
  'jwt',
  'authorization',
  'secret',
  'api_key',
  'apikey',
  'cookie',
  'set-cookie',
  'set_cookie',
  'totp_code',
  'access_token',
  'refresh_token',
  'fiscal_code',
  'codice_fiscale',
  'vat',
  'partita_iva',
  'bearer',
  'private_key',
  'client_secret',
];

/**
 * Build a synthetic Sentry event covering every shape `beforeSendForSentry`
 * claims to scrub: request, exception, transaction, breadcrumbs, tags,
 * extra, contexts, user.
 */
export function buildSyntheticEvent(): Record<string, unknown> {
  const request = {
    cookies: `sid=${FAKE_TOKEN}`,
    data: { password: FAKE_PASSWORD, email: FAKE_EMAIL },
    url: `https://api.example.com/x?email=${FAKE_EMAIL}&ip=${FAKE_IPV4}`,
    query_string: { email: FAKE_EMAIL, token: FAKE_TOKEN, safe: 'ok' },
    headers: {
      authorization: `Bearer ${FAKE_TOKEN}`,
      cookie: `sid=${FAKE_TOKEN}`,
      'set-cookie': `sid=${FAKE_TOKEN}`,
      'x-trace-id': 'safe-trace',
    },
  };

  const exception = {
    values: [
      {
        value: `invalid email ${FAKE_EMAIL} with VAT ${FAKE_VAT}`,
        stacktrace: {
          frames: [
            {
              vars: { password: FAKE_PASSWORD, email: FAKE_EMAIL },
            },
          ],
        },
      },
    ],
  };

  const breadcrumbs = [
    {
      message: `lookup ${FAKE_EMAIL} at ${FAKE_IPV4}`,
      data: {
        password: FAKE_PASSWORD,
        token: FAKE_TOKEN,
        phone: FAKE_PHONE,
        nested: { jwt: FAKE_TOKEN, deeper: { api_key: FAKE_TOKEN, safe: 'ok' } },
      },
    },
  ];

  return {
    event_id: 'synthetic-event',
    timestamp: 1700000000,
    message: `Failed for ${FAKE_EMAIL} from ${FAKE_IPV6} cf ${FAKE_CF}`,
    transaction: `GET /users/${FAKE_EMAIL}`,
    request,
    user: { id: 'u-1', email: FAKE_EMAIL, ip_address: FAKE_IPV4, username: FAKE_EMAIL_2 },
    exception,
    breadcrumbs,
    tags: {
      user_email: FAKE_EMAIL,
      client_ip: FAKE_IPV4,
      build: '1.2.3',
    },
    extra: {
      password: FAKE_PASSWORD,
      nested: { refresh_token: FAKE_TOKEN, safe: 'ok' },
    },
    contexts: {
      app: { build: '1' },
      trace: { phone: FAKE_PHONE },
    },
  };
}

/**
 * Pure verification. Exported for unit tests; subprocess CI calls via
 * `main()` below. Returns the list of failures (empty list = pass).
 *
 * Covers every claim the `beforeSend` scrubber makes:
 *   1. synthetic-event pass (all PII keys + regex scrubbed text)
 *   2. cycle-safe (self-ref → `[cycle]`)
 *   3. depth-safe (deep tree → `[depth-capped]`)
 *   4. fail-closed (scrubber throws → event dropped, not leaked)
 */
export function verifyRedaction(): string[] {
  const failures: string[] = [];
  failures.push(...verifyScrubPass());
  failures.push(...verifyCycleSafety());
  failures.push(...verifyDepthCap());
  failures.push(...verifyFailClosed());
  return failures;
}

function verifyScrubPass(): string[] {
  const failures: string[] = [];
  const event = buildSyntheticEvent();
  const scrubbed = beforeSendForSentry(event as never, {} as never) as
    | Record<string, unknown>
    | null;
  if (scrubbed === null) {
    failures.push('beforeSend returned null on a normal synthetic event');
    return failures;
  }

  const serialized = JSON.stringify(scrubbed);
  for (const needle of FORBIDDEN_SUBSTRINGS) {
    if (serialized.includes(needle)) {
      failures.push(`raw PII "${needle}" survived scrubbing in scrubbed event`);
    }
  }

  walkForUnredactedPIIValues(scrubbed, '', failures);
  return failures;
}

function verifyCycleSafety(): string[] {
  const cycleRoot: Record<string, unknown> = { kind: 'cycle' };
  cycleRoot.self = cycleRoot;
  const out = beforeSendForSentry({ extra: { loop: cycleRoot } } as never, {} as never) as
    | Record<string, unknown>
    | null;
  if (out === null) return ['cycle fixture was dropped instead of being scrubbed'];
  const loop = ((out.extra as Record<string, unknown>) ?? {}).loop as
    | Record<string, unknown>
    | undefined;
  if (loop?.self !== CYCLE_MARKER) {
    return [`cycle marker missing on self-ref; got ${JSON.stringify(loop?.self)}`];
  }
  return [];
}

function verifyDepthCap(): string[] {
  let deep: Record<string, unknown> = { j: 'leaf' };
  for (const k of ['i', 'h', 'g', 'f', 'e', 'd', 'c', 'b', 'a']) {
    deep = { [k]: deep };
  }
  const out = beforeSendForSentry({ extra: deep } as never, {} as never) as
    | Record<string, unknown>
    | null;
  if (out === null) return ['depth fixture was dropped instead of being scrubbed'];

  let cur: unknown = out.extra;
  const path = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  for (const k of path) {
    // eslint-disable-next-line security/detect-object-injection -- fixed key list built above
    cur = (cur as Record<string, unknown>)[k];
  }
  const expected = { h: DEPTH_CAPPED_MARKER };
  if (JSON.stringify(cur) !== JSON.stringify(expected)) {
    return [
      `depth cap marker missing; walked path ${path.join('.')} got ${JSON.stringify(cur)} (expected ${JSON.stringify(expected)})`,
    ];
  }
  return [];
}

function verifyFailClosed(): string[] {
  // Proxy with throwing ownKeys forces the scrubber into its catch path.
  // ponytail: a hand-rolled `boom` injection would be one line shorter,
  // but Proxy is the canonical "throw inside Object.keys" trap and
  // exercises the same fail-closed branch the real logger would hit on
  // a hostile event.
  const evil = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('boom');
      },
    },
  );
  const out = beforeSendForSentry({ extra: evil } as never, {} as never);
  if (out !== null) return ['beforeSend did not fail-closed (returned non-null on throw)'];
  return [];
}

/**
 * The scrubber preserves PII keys (`password`, `email`, ...) and replaces
 * their values with `[redacted]`. The user object is whitelisted to `id`
 * only. So a "raw PII key" is one that survives with a non-`[redacted]`
 * value — anything else is the expected post-scrub shape.
 */
function walkForUnredactedPIIValues(node: unknown, path: string, failures: string[]): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkForUnredactedPIIValues(item, `${path}[${i}]`, failures));
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const lower = k.toLowerCase();
    if (FORBIDDEN_KEYS.includes(lower) && v !== REDACTED) {
      failures.push(
        `PII key "${k}" present at ${path || '<root>'}.${k} with non-redacted value ${JSON.stringify(v)}`,
      );
    }
    walkForUnredactedPIIValues(v, `${path || '<root>'}.${k}`, failures);
  }
}

function main(): void {
  const failures = verifyRedaction();

  if (failures.length === 0) {
    process.stdout.write('Sentry redaction: all synthetic PII was scrubbed.\n');
    process.exit(0);
  }

  process.stderr.write(`Sentry redaction: ${failures.length} regression(s) detected:\n`);
  for (const f of failures) process.stderr.write(`  - ${f}\n`);
  process.stderr.write('\n');
  process.stderr.write(
    'A regression slipped PII past apps/api/src/observability/sentry.ts beforeSend.\n' +
      'Fix the scrubber; do not edit this script to weaken assertions.\n',
  );
  process.exit(1);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = resolve(fileURLToPath(import.meta.url));
if (entryPath === selfPath) {
  // Ponytail: assert smoke check before main() to fail fast on import errors.
  assert.equal(typeof beforeSendForSentry, 'function');
  main();
}