/**
 * mock-obo.service unit tests — P3-02 §5
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { jwtVerify, createLocalJWKSet, exportJWK } from 'jose';
import { MockOboService, MOCK_OBO_ISSUER } from './mock-obo.service';

describe('MockOboService', () => {
  let svc: MockOboService;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
    delete process.env.AGENTIC_ENGINE_MOCK_OBO_PRIVATE_KEY_PEM;
    svc = new MockOboService();
  });

  it('exchange() returns verifiable RS256 JWT + matching kid', async () => {
    const out = await svc.exchange({
      subjectUserId: '281474976710800',
      tenant: 101,
      targetScope: ['orders.read'],
      audience: 'app.orders',
      ttlHintSeconds: 120,
      traceId: 'trace-1',
    });

    expect(out.token.split('.')).toHaveLength(3);
    expect(out.source).toBe('mock');

    const jwks = await svc.getJwksBody();
    const JWKS = createLocalJWKSet(jwks);
    const { payload } = await jwtVerify(out.token, JWKS, {
      issuer: MOCK_OBO_ISSUER,
    });

    expect(payload.sub).toBe('281474976710800');
    expect(String(payload['tenant_id'])).toBe('101');
    expect(payload['act']).toEqual({ sub: 'cube-agentic-engine' });
  });

  it('getJwksBody returns RSA keys with kid + alg', async () => {
    const jwks = await svc.getJwksBody();
    expect(jwks.keys.length).toBeGreaterThanOrEqual(1);
    expect(jwks.keys[0]?.kid).toBeTruthy();
    expect(jwks.keys[0]?.alg).toBe('RS256');
  });

  it('fakeSubject exposes tenant from X-Mock-Tenant header', () => {
    const sub = svc.fakeSubject({
      headers: { 'x-mock-user': 'alice', 'x-mock-tenant': '55' },
    });
    expect(sub.user.userId).toBe('alice');
    expect(sub.tenant).toBe(55);
  });

  describe('fakeSubject — standard headers first (oauth2 形态收敛)', () => {
    /** 构造合法三段式 JWT 串（仅用于 mock：不验签，仅 base64 解码 payload） */
    function buildJwt(payload: Record<string, unknown>): string {
      const enc = (s: string): string =>
        Buffer.from(s, 'utf8')
          .toString('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      const header = enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const body = enc(JSON.stringify(payload));
      return `${header}.${body}.dev-not-signed`;
    }

    it('standard `tenant` header takes precedence over x-mock-tenant', () => {
      const sub = svc.fakeSubject({
        headers: {
          tenant: '58197260',
          'x-mock-tenant': '55',
        },
      });
      expect(sub.tenant).toBe(58197260);
    });

    it('userId comes from Authorization Bearer JWT sub', () => {
      const token = buildJwt({ sub: 'client_2', tenants: ['58197260'] });
      const sub = svc.fakeSubject({
        headers: {
          authorization: `Bearer ${token}`,
          tenant: '58197260',
        },
      });
      expect(sub.user.userId).toBe('client_2');
      expect(sub.tenant).toBe(58197260);
    });

    it('userId comes from JWT id when sub is absent (ghcloud token shape)', () => {
      const token = buildJwt({ id: 42, tenants: ['58197260'] });
      const sub = svc.fakeSubject({
        headers: {
          authorization: `Bearer ${token}`,
          tenant: '58197260',
        },
      });
      expect(sub.user.userId).toBe('42');
    });

    it('JWT id takes precedence over sub (aligns with ghcloud payloadToSecurityContext)', () => {
      const token = buildJwt({ id: 42, sub: 'client_2' });
      const sub = svc.fakeSubject({
        headers: { authorization: `Bearer ${token}` },
      });
      expect(sub.user.userId).toBe('42');
    });

    it('numeric sub in JWT is stringified', () => {
      const token = buildJwt({ sub: 123456 as unknown as string });
      const sub = svc.fakeSubject({
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      expect(sub.user.userId).toBe('123456');
    });

    it('falls back to x-mock-user when Authorization is malformed', () => {
      const sub = svc.fakeSubject({
        headers: {
          authorization: 'Bearer not.a.jwt',
          'x-mock-user': 'fallback-user',
        },
      });
      expect(sub.user.userId).toBe('fallback-user');
    });

    it('falls back to default mock-user when no auth/no header', () => {
      const sub = svc.fakeSubject({ headers: {} });
      expect(sub.user.userId).toBe('mock-user');
      expect(sub.tenant).toBe(1);
    });

    it('non-Bearer Authorization is ignored (no crash)', () => {
      const sub = svc.fakeSubject({
        headers: { authorization: 'Basic dXNlcjpwYXNz' },
      });
      expect(sub.user.userId).toBe('mock-user');
    });
  });
});
