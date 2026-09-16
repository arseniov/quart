import { describe, expect, it } from 'vitest';

import { cspForAdmin, cspForMobile } from '../../src/security/csp.js';

describe('csp', () => {
  it('admin CSP allows sentry.io + jsdelivr inline (replay)', () => {
    const v = cspForAdmin();
    expect(v).toContain("script-src 'self' 'unsafe-inline'");
    expect(v).toContain('https://cdn.jsdelivr.net');
    expect(v).toContain('https://*.sentry.io');
    expect(v).toContain("frame-ancestors 'none'");
  });

  it('mobile CSP has no inline scripts', () => {
    const v = cspForMobile();
    const scriptSrc = v.split(';').find((d) => d.trim().startsWith('script-src'))!;
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('mobile CSP does not load Sentry browser bundle', () => {
    const v = cspForMobile();
    expect(v).not.toContain('sentry.io');
    expect(v).not.toContain('jsdelivr');
  });

  it('both policies block framing', () => {
    expect(cspForAdmin()).toContain("frame-ancestors 'none'");
    expect(cspForMobile()).toContain("frame-ancestors 'none'");
  });
});