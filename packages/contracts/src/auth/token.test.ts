/**
 * Unit tests: OAuth2 token Zod schema validation.
 * ref: P1-05 design doc §7 + contracts/src/auth/token.ts
 */
import { describe, it, expect } from 'bun:test';
import {
  OAuth2IntrospectResponseSchema,
  OboTokenPayloadSchema,
  ExchangedTokenSchema,
} from './token';

describe('OAuth2IntrospectResponseSchema', () => {
  it('accepts a valid active introspect response', () => {
    const result = OAuth2IntrospectResponseSchema.safeParse({
      active: true,
      user_name: 'usr_test_01',
      tenant_id: '101',
      scope: 'engine.use orders.read',
      exp: Math.floor(Date.now() / 1000) + 3600,
      jti: 'abc-123',
    });
    expect(result.success).toBe(true);
  });

  it('accepts an inactive response (token revoked)', () => {
    const result = OAuth2IntrospectResponseSchema.safeParse({ active: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.active).toBe(false);
  });

  it('rejects missing active field', () => {
    const result = OAuth2IntrospectResponseSchema.safeParse({ user_name: 'user' });
    expect(result.success).toBe(false);
  });

  it('accepts aud as array or string', () => {
    const withArray = OAuth2IntrospectResponseSchema.safeParse({
      active: true,
      aud: ['app.orders', 'app.kb'],
    });
    expect(withArray.success).toBe(true);

    const withString = OAuth2IntrospectResponseSchema.safeParse({
      active: true,
      aud: 'app.orders',
    });
    expect(withString.success).toBe(true);
  });
});

describe('OboTokenPayloadSchema', () => {
  it('accepts a valid mock OBO JWT payload', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = OboTokenPayloadSchema.safeParse({
      iss: 'agentic-engine-mock-obo',
      sub: 'usr_test',
      tenant_id: '101',
      scope: 'orders.read',
      iat: now,
      exp: now + 600,
      nbf: now,
      jti: 'obo_12345',
      act: { sub: 'cube-agentic-engine' },
      _mock: true,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing mandatory claims', () => {
    const result = OboTokenPayloadSchema.safeParse({
      iss: 'agentic-engine-mock-obo',
      // missing sub, tenant_id, etc.
    });
    expect(result.success).toBe(false);
  });

  it('act.sub must be present', () => {
    const now = Math.floor(Date.now() / 1000);
    const result = OboTokenPayloadSchema.safeParse({
      iss: 'agentic-engine-mock-obo',
      sub: 'usr',
      tenant_id: '1',
      scope: 'read',
      iat: now, exp: now + 60, nbf: now,
      jti: 'j1',
      // missing act
    });
    expect(result.success).toBe(false);
  });
});

describe('ExchangedTokenSchema', () => {
  it('validates a mock exchanged token', () => {
    const result = ExchangedTokenSchema.safeParse({
      token: 'mock.xxx.sig',
      issuer: 'agentic-engine-mock-obo',
      scope: ['orders.read'],
      expiresAt: Date.now() + 600_000,
      source: 'mock',
      kid: 'agentic-engine-mock-obo-v1',
      cached: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown source value', () => {
    const result = ExchangedTokenSchema.safeParse({
      token: 't', issuer: 'i', scope: [], expiresAt: 1, source: 'unknown', kid: 'k', cached: false,
    });
    expect(result.success).toBe(false);
  });
});
