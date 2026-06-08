/**
 * dual-subject.service unit tests — P3-02 §5
 */
import { describe, it, expect } from 'bun:test';
import { DualSubjectService } from './dual-subject.service';

describe('DualSubjectService.fromIntrospectResponse', () => {
  it('maps Spring-style introspection JSON → DualSubject', () => {
    const svc = new DualSubjectService();
    const rawToken = 'access-token-raw';
    const subject = svc.fromIntrospectResponse(
      {
        active: true,
        user_name: 'user-99',
        tenant_id: '7',
        scope: 'a b',
        exp: Math.floor(Date.now() / 1000) + 600,
        jti: 'jti-1',
        client_id: 'cid-1',
      },
      rawToken,
      { xTraceId: 'tid-xyz' },
    );

    expect(subject.user.userId).toBe('user-99');
    expect(subject.user.tenant).toBe(7);
    expect(subject.service?.clientId).toBe('cid-1');
    expect(subject.traceId).toBe('tid-xyz');
    expect(subject.user.rawTokenSha256).toBe(svc.sha256Hex(rawToken));
  });

  it('OAuth2IntrospectResponse.parse rejects malformed payload', () => {
    const svc = new DualSubjectService();
    expect(() =>
      svc.fromIntrospectResponse({ active: true }, 'tok', {}),
    ).toThrow();
  });
});
