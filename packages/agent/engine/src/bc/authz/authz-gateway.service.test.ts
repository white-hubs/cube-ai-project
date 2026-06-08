/**
 * Unit tests: AuthzGatewayService decision algorithm.
 * ref: P1-05 design doc §7
 *      docs/detailed-design/04-auth-and-authz/authorization-gateway.md §3
 */
import { describe, it, expect } from 'bun:test';
import { TenantIsolationViolation } from '../../infra/errors/agentic-error';
import { SfidService } from '../../infra/sfid/sfid.service';
import { AuthzGatewayService } from './authz-gateway.service';
import { GrantService, createGrantRepository } from './grant.service';
import { ConsentPolicyEngine } from './consent-policy.engine';
import type { AuthzRequest, Grant } from '@cube-ai/contracts';

function makeRequest(overrides: Partial<AuthzRequest> = {}): AuthzRequest {
  return {
    tenant: 101,
    userId: 'usr_test',
    toolName: 'platform.api.invoke',
    args: {},
    consentPolicy: 'ON_FIRST_USE',
    ...overrides,
  };
}

function makeGrant(overrides: Partial<Grant> & { form: Grant['form'] }): Grant {
  return {
    id: `grant_${Math.random().toString(36).slice(2)}`,
    tenant: 101,
    grantorType: overrides.form === 'G_A' ? 'ADMIN' : 'USER',
    subject: { userId: 'usr_test' },
    scope: { toolName: 'platform.api.invoke', action: 'ALLOW' },
    origin: overrides.form === 'G_A' ? 'ADMIN_POLICY' : 'USER_CENTER',
    deleted: 0,
    createTime: Date.now(),
    updateTime: Date.now(),
    ...overrides,
  };
}

function makeGateway(
  adminGrants: Grant[] = [],
  userGrants: Grant[] = [],
): AuthzGatewayService {
  const grantService = new GrantService({
    repository: createGrantRepository(null),
    redis: null,
    sfid: new SfidService(),
  });
  if (adminGrants.length) grantService._l1Set('admin:101', adminGrants);
  if (userGrants.length) grantService._l1Set('user:101:usr_test', userGrants);

  return new AuthzGatewayService(grantService, new ConsentPolicyEngine());
}

describe('AuthzGatewayService', () => {
  it('U5: no grants + NEVER → ALLOW (policy_never)', async () => {
    const gw = makeGateway();
    const result = await gw.check(makeRequest({ consentPolicy: 'NEVER' }));
    expect(result.kind).toBe('ALLOW');
    expect(result.reason).toBe('policy_never');
  });

  it('U6: no grants + ADMIN_ONLY → DENY', async () => {
    const gw = makeGateway();
    const result = await gw.check(makeRequest({ consentPolicy: 'ADMIN_ONLY' }));
    expect(result.kind).toBe('DENY');
    expect(result.reason).toBe('admin_only_not_approved');
  });

  it('U1: G-A DENY overrides G-B ALLOW (admin_deny has highest priority)', async () => {
    const adminDeny = makeGrant({ form: 'G_A', scope: { toolName: 'platform.api.invoke', action: 'DENY' } });
    const userAllow = makeGrant({ form: 'G_B' });
    const gw = makeGateway([adminDeny], [userAllow]);
    const result = await gw.check(makeRequest({ consentPolicy: 'ON_FIRST_USE' }));
    expect(result.kind).toBe('DENY');
    expect(result.reason).toBe('admin_deny');
  });

  it('U2: G-A ALLOW bypasses consent ceremony', async () => {
    const adminAllow = makeGrant({ form: 'G_A' });
    const gw = makeGateway([adminAllow], []);
    const result = await gw.check(makeRequest({ consentPolicy: 'ON_FIRST_USE' }));
    expect(result.kind).toBe('ALLOW');
    expect(result.reason).toBe('admin_allow');
  });

  it('U3: G-B ALLOW + ON_FIRST_USE → ALLOW (user_default)', async () => {
    const userAllow = makeGrant({ form: 'G_B' });
    const gw = makeGateway([], [userAllow]);
    const result = await gw.check(makeRequest({ consentPolicy: 'ON_FIRST_USE' }));
    expect(result.kind).toBe('ALLOW');
    expect(result.reason).toBe('user_default');
  });

  it('no grants + ON_FIRST_USE → REQUIRE_CONSENT PERSISTENT', async () => {
    const gw = makeGateway();
    const result = await gw.check(makeRequest({ consentPolicy: 'ON_FIRST_USE' }));
    expect(result.kind).toBe('REQUIRE_CONSENT');
    if (result.kind === 'REQUIRE_CONSENT') {
      expect(result.scopeHint).toBe('PERSISTENT');
    }
  });

  it('no grants + EACH_CALL → REQUIRE_CONSENT ONCE', async () => {
    const gw = makeGateway();
    const result = await gw.check(makeRequest({ consentPolicy: 'EACH_CALL' }));
    expect(result.kind).toBe('REQUIRE_CONSENT');
    if (result.kind === 'REQUIRE_CONSENT') {
      expect(result.scopeHint).toBe('ONCE');
    }
  });

  it('revoked grant is filtered out → falls through to consent', async () => {
    const revoked = makeGrant({ form: 'G_B', deleted: Date.now() });
    const gw = makeGateway([], [revoked]);
    const result = await gw.check(makeRequest({ consentPolicy: 'ON_FIRST_USE' }));
    // Revoked grant should not match
    expect(result.kind).toBe('REQUIRE_CONSENT');
  });

  it('toolTenant 与 user tenant 不一致 → TenantIsolationViolation', async () => {
    const gw = makeGateway();
    await expect(
      gw.check(makeRequest({ tenant: 101, toolTenant: 999, consentPolicy: 'NEVER' })),
    ).rejects.toThrow(TenantIsolationViolation);
  });
});
