import { describe, expect, it } from 'vitest';

import { cspForAdmin, cspForMobile } from '../../src/security/csp.js';

/** Parse a CSP string into `{name, value}` records. Directives without a
 *  value (e.g. `upgrade-insecure-requests`) yield `{value: ''}`. */
function parseCsp(csp: string): Array<{ name: string; value: string }> {
  return csp
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((directive) => {
      const [name, ...rest] = directive.split(/\s+/);
      return { name, value: rest.join(' ') };
    });
}

function directive(csp: string, name: string): string | undefined {
  return parseCsp(csp).find((d) => d.name === name)?.value;
}

const policies: ReadonlyArray<readonly [string, string]> = [
  ['admin', cspForAdmin()],
  ['mobile', cspForMobile()],
];

/** Run the same assertions against every emitted CSP. Encodes shared
 *  invariants in one place so admin and mobile can't drift. */
const forBoth = (
  suite: string,
  fn: (csp: string, label: string) => void,
): void => {
  describe(suite, () => {
    for (const [label, csp] of policies) {
      it(label, () => fn(csp, label));
    }
  });
};

describe('csp', () => {
  forBoth('parses into named directives', (csp) => {
    const directives = parseCsp(csp);
    expect(directives.length).toBeGreaterThan(0);
    for (const d of directives) {
      expect(d.name).toMatch(/^[a-z-]+$/);
    }
  });

  forBoth("omits 'unsafe-eval'", (csp) => {
    expect(csp).not.toContain("'unsafe-eval'");
  });

  forBoth(
    "ships object-src 'none', frame-ancestors 'none', upgrade-insecure-requests",
    (csp) => {
      expect(directive(csp, 'object-src')).toBe("'none'");
      expect(directive(csp, 'frame-ancestors')).toBe("'none'");
      expect(parseCsp(csp).some((d) => d.name === 'upgrade-insecure-requests')).toBe(
        true,
      );
    },
  );

  forBoth("default-src is 'self'", (csp) => {
    expect(directive(csp, 'default-src')).toBe("'self'");
  });

  it("admin: script-src excludes 'unsafe-inline' (replay loader is external)", () => {
    const ss = directive(cspForAdmin(), 'script-src') ?? '';
    expect(ss).not.toContain("'unsafe-inline'");
    expect(ss).toContain('https://cdn.jsdelivr.net');
  });

  it('mobile: script-src is locked to self (no unsafe-inline, no jsdelivr)', () => {
    expect(directive(cspForMobile(), 'script-src')).toBe("'self'");
  });

  it('admin: connect-src includes api.quart.app and *.sentry.io', () => {
    const cs = directive(cspForAdmin(), 'connect-src') ?? '';
    expect(cs).toContain('https://api.quart.app');
    expect(cs).toContain('https://*.sentry.io');
  });

  it('mobile: connect-src includes api.quart.app and excludes sentry.io', () => {
    const cs = directive(cspForMobile(), 'connect-src') ?? '';
    expect(cs).toContain('https://api.quart.app');
    expect(cs).not.toContain('sentry.io');
  });

  it('mobile: style-src excludes unsafe-inline', () => {
    expect(directive(cspForMobile(), 'style-src')).toBe("'self'");
  });

  it('mobile: frame-src allows Stripe (3DS / Payment Element / Apple Pay sheet)', () => {
    const fs = directive(cspForMobile(), 'frame-src') ?? '';
    expect(fs).toContain('https://js.stripe.com');
    expect(fs).toContain('https://hooks.stripe.com');
  });
});
