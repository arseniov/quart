import { createPrivateKey, createPublicKey } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT, type JWTPayload } from 'jose';

// Value (not `import type`) so vitest's decorator-metadata plugin can emit
// `design:paramtypes` for the constructor parameter.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { ConfigService } from '../config/config.service.js';

export type ScopeType = 'city' | 'global' | 'city_area' | 'neighborhood';

export interface JwtClaims {
  sub: string;
  city_id: string;
  scope_type: ScopeType;
  scope_id: string | null;
  role_snapshot: string[];
  device_fingerprint: string | null;
}

export interface SignOptions {
  jti: string;
  ttlSeconds: number;
}

export type VerifiedJwt = JWTPayload & JwtClaims;

// RFC 8410 PKCS#8 prefix for an Ed25519 private key (30 bytes), immediately
// followed by the 32-byte seed. Wrapping the raw seed lets us hand Node a
// real `KeyObject` instead of an OKP JWK, which `jose` does not accept for
// sign() (it requires both `d` and `x`). Public `x` is then derived via
// `createPublicKey()` for the JWK `jose` does accept.
const PKCS8_ED25519_PREFIX = Buffer.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

/**
 * EdDSA (Ed25519) JWT issuer + verifier. The signing key is supplied as
 * 64 hex chars (validated upstream by `EnvSchema.JWT_SIGNING_KEY`) and
 * decoded into an OKP private JWK (`{ kty: 'OKP', crv: 'Ed25519', d, x }`),
 * which is what `jose` consumes for asymmetric sign + verify.
 *
 * `verify()` throws on signature mismatch, expiry, or wrong issuer — callers
 * must not silently accept unverified claims.
 */
@Injectable()
export class JwtService {
  // `jose.sign()` requires a private OKP JWK (d + x); `jose.verify()` requires
  // a public OKP JWK (x only). Cache both, derived from the same Ed25519 seed.
  private readonly signKey: { kty: 'OKP'; crv: 'Ed25519'; d: string; x: string };
  private readonly verifyKey: { kty: 'OKP'; crv: 'Ed25519'; x: string };
  private readonly issuer: string;

  constructor(config: ConfigService) {
    const seed = Buffer.from(config.env.JWT_SIGNING_KEY, 'hex');
    // T2's schema guarantees 64 hex chars → 32 raw bytes (Ed25519 seed).
    // Wrap in PKCS#8 so Node can load a private KeyObject and derive the
    // public `x` we need for both sign and verify JWK shapes.
    const priv = createPrivateKey({
      key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
      format: 'der',
      type: 'pkcs8',
    });
    const { x } = createPublicKey(priv).export({ format: 'jwk' }) as { x: string };
    this.signKey = {
      kty: 'OKP',
      crv: 'Ed25519',
      d: seed.toString('base64url'),
      x,
    };
    this.verifyKey = { kty: 'OKP', crv: 'Ed25519', x };
    this.issuer = config.env.JWT_ISSUER;
  }

  async sign(claims: JwtClaims, opts: SignOptions): Promise<string> {
    return await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
      .setIssuer(this.issuer)
      .setSubject(claims.sub)
      .setJti(opts.jti)
      .setIssuedAt()
      .setExpirationTime(`${opts.ttlSeconds}s`)
      .sign(this.signKey);
  }

  async verify(token: string): Promise<VerifiedJwt> {
    const { payload } = await jwtVerify(token, this.verifyKey, { issuer: this.issuer });
    return payload as VerifiedJwt;
  }
}
