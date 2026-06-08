/**
 * Unit tests: Grant Zod schema + ArgsConstraint DSL parsing.
 * ref: P1-05 design doc §7 + contracts/src/authz/grant.ts
 */
import { describe, it, expect } from 'bun:test';
import {
  GrantSchema,
  GrantStateSchema,
  GrantFormSchema,
  ConsentPolicySchema,
  ArgsConstraintSchema,
  AuthzRequestSchema,
  AuthzDecisionSchema,
  GrantScopeSchema,
} from './grant';

describe('GrantFormSchema', () => {
  it('accepts valid G_A / G_B / G_D values', () => {
    for (const form of ['G_A', 'G_B', 'G_D'] as const) {
      expect(GrantFormSchema.safeParse(form).success).toBe(true);
    }
  });

  it('rejects G_C (session-only, not in DB)', () => {
    expect(GrantFormSchema.safeParse('G_C').success).toBe(false);
  });

  it('rejects lowercase values (must be SNAKE_CASE per ADR-0011)', () => {
    expect(GrantFormSchema.safeParse('g_a').success).toBe(false);
  });
});

describe('GrantStateSchema', () => {
  it('accepts all 4 states', () => {
    for (const s of ['PENDING', 'GRANTED', 'REVOKED', 'EXPIRED'] as const) {
      expect(GrantStateSchema.safeParse(s).success).toBe(true);
    }
  });

  it('closed set — rejects unknown state', () => {
    expect(GrantStateSchema.safeParse('ACTIVE').success).toBe(false);
    expect(GrantStateSchema.safeParse('UNKNOWN').success).toBe(false);
  });
});

describe('ConsentPolicySchema', () => {
  it('accepts all 4 consent policy values', () => {
    for (const cp of ['NEVER', 'ON_FIRST_USE', 'EACH_CALL', 'ADMIN_ONLY'] as const) {
      expect(ConsentPolicySchema.safeParse(cp).success).toBe(true);
    }
  });
});

describe('GrantScopeSchema', () => {
  it('accepts toolName (without toolPattern)', () => {
    const result = GrantScopeSchema.safeParse({
      toolName: 'platform.api.invoke',
      action: 'ALLOW',
    });
    expect(result.success).toBe(true);
  });

  it('accepts toolPattern (without toolName)', () => {
    const result = GrantScopeSchema.safeParse({
      toolPattern: 'platform.*',
      action: 'ALLOW',
    });
    expect(result.success).toBe(true);
  });

  it('rejects both toolName and toolPattern set simultaneously (INVALID_ARGUMENT_GRANT_SCOPE)', () => {
    const result = GrantScopeSchema.safeParse({
      toolName: 'platform.api.invoke',
      toolPattern: 'platform.*',
      action: 'ALLOW',
    });
    expect(result.success).toBe(false);
  });

  it('rejects neither toolName nor toolPattern set', () => {
    const result = GrantScopeSchema.safeParse({ action: 'ALLOW' });
    expect(result.success).toBe(false);
  });
});

describe('ArgsConstraintSchema (jsonpath-v1)', () => {
  it('accepts a valid eq constraint', () => {
    const result = ArgsConstraintSchema.safeParse({
      version: 'jsonpath-v1',
      all: true,
      matches: [{ path: '$.args.tenant', op: 'eq', value: 101 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an eqCtx constraint with valid ctx reference', () => {
    const result = ArgsConstraintSchema.safeParse({
      version: 'jsonpath-v1',
      all: true,
      matches: [{ path: '$.args.userId', op: 'eqCtx', ctx: 'principal.userId' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown DSL version', () => {
    const result = ArgsConstraintSchema.safeParse({
      version: 'cel-v1',
      all: true,
      matches: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid ctx reference (INVALID_ARGUMENT_GRANT_CTX_REFERENCE)', () => {
    const result = ArgsConstraintSchema.safeParse({
      version: 'jsonpath-v1',
      all: true,
      matches: [{ path: '$.x', op: 'eqCtx', ctx: 'unknown.field' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts empty matches array (always-true constraint)', () => {
    const result = ArgsConstraintSchema.safeParse({
      version: 'jsonpath-v1',
      all: true,
      matches: [],
    });
    expect(result.success).toBe(true);
  });
});

describe('AuthzDecisionSchema', () => {
  it('ALLOW decision is valid', () => {
    expect(AuthzDecisionSchema.safeParse({ kind: 'ALLOW', reason: 'admin_allow' }).success).toBe(true);
  });

  it('DENY decision with violatedGrantId is valid', () => {
    expect(AuthzDecisionSchema.safeParse({
      kind: 'DENY',
      reason: 'admin_deny',
      violatedGrantId: '12345',
    }).success).toBe(true);
  });

  it('REQUIRE_CONSENT with scopeHint ONCE is valid', () => {
    expect(AuthzDecisionSchema.safeParse({
      kind: 'REQUIRE_CONSENT',
      reason: 'policy_each_call',
      scopeHint: 'ONCE',
    }).success).toBe(true);
  });

  it('rejects REQUIRE_CONSENT with invalid scopeHint', () => {
    expect(AuthzDecisionSchema.safeParse({
      kind: 'REQUIRE_CONSENT',
      reason: 'test',
      scopeHint: 'SOMETIMES',
    }).success).toBe(false);
  });
});
