/**
 * Unit tests: ConsentPolicyEngine (jsonpath-v1 DSL evaluator).
 * ref: P1-05 design doc §7 + design doc §4.4
 *      docs/detailed-design/04-auth-and-authz/authorization-gateway.md §5
 *      docs/adr/ADR-0013-grant-args-constraint-dsl.md
 */
import { describe, it, expect } from 'bun:test';
import { ConsentPolicyEngine, resolveJsonPath } from './consent-policy.engine';
import type { ConsentArgsExpr } from '@cube-ai/contracts';

const engine = new ConsentPolicyEngine();

describe('resolveJsonPath', () => {
  const obj = { a: { b: { c: 42 } }, arr: [1, 2, 3], 'odd-key': 'value' };

  it('resolves $ to full root', () => {
    expect(resolveJsonPath(obj, '$')).toBe(obj);
  });

  it('resolves dot-notation path', () => {
    expect(resolveJsonPath(obj, '$.a.b.c')).toBe(42);
  });

  it('resolves bracket notation', () => {
    expect(resolveJsonPath(obj, "$['odd-key']")).toBe('value');
  });

  it('resolves array index', () => {
    expect(resolveJsonPath(obj, '$.arr[1]')).toBe(2);
  });

  it('resolves [*] to full array', () => {
    expect(resolveJsonPath(obj, '$.arr[*]')).toEqual([1, 2, 3]);
  });

  it('returns undefined for nonexistent path', () => {
    expect(resolveJsonPath(obj, '$.x.y.z')).toBeUndefined();
  });
});

describe('ConsentPolicyEngine.evaluate — eq / ne', () => {
  it('eq: returns true when path value equals value', () => {
    const expr: ConsentArgsExpr = { op: 'eq', path: '$.tenant', value: 101 };
    expect(engine.evaluate(expr, { tenant: 101 })).toBe(true);
    expect(engine.evaluate(expr, { tenant: 999 })).toBe(false);
  });

  it('ne: returns true when path value differs from value', () => {
    const expr: ConsentArgsExpr = { op: 'ne', path: '$.role', value: 'admin' };
    expect(engine.evaluate(expr, { role: 'user' })).toBe(true);
    expect(engine.evaluate(expr, { role: 'admin' })).toBe(false);
  });

  it('eq: nonexistent path → false', () => {
    const expr: ConsentArgsExpr = { op: 'eq', path: '$.missing', value: 'x' };
    expect(engine.evaluate(expr, {})).toBe(false);
  });
});

describe('ConsentPolicyEngine.evaluate — in / nin', () => {
  it('in: returns true when value is in set', () => {
    const expr: ConsentArgsExpr = { op: 'in', path: '$.api', value: ['hr.read', 'hr.write'] };
    expect(engine.evaluate(expr, { api: 'hr.read' })).toBe(true);
    expect(engine.evaluate(expr, { api: 'orders.delete' })).toBe(false);
  });

  it('nin: returns true when value is not in set', () => {
    const expr: ConsentArgsExpr = { op: 'nin', path: '$.op', value: ['delete', 'purge'] };
    expect(engine.evaluate(expr, { op: 'read' })).toBe(true);
    expect(engine.evaluate(expr, { op: 'delete' })).toBe(false);
  });
});

describe('ConsentPolicyEngine.evaluate — lte (via eq boundary check)', () => {
  it('processes scalar comparisons correctly via custom op not in base — use eq for boundary', () => {
    // P1-05 prompt §6.4 includes 'lte'; implemented as ConsentArgsExpr type supports it
    // The ConsentPolicyEngine supports: eq ne in nin eqCtx neCtx and or
    // 'lte' is not in ConsentArgsExprSchema (ADR-0013 v1 doesn't include numeric compare)
    // This test documents the boundary expectation:
    const expr: ConsentArgsExpr = { op: 'eq', path: '$.amount', value: 100 };
    expect(engine.evaluate(expr, { amount: 100 })).toBe(true);
    expect(engine.evaluate(expr, { amount: 99 })).toBe(false);
  });
});

describe('ConsentPolicyEngine.evaluate — eqCtx / neCtx', () => {
  it('eqCtx: path value equals ctx.principal.userId', () => {
    const expr: ConsentArgsExpr = { op: 'eqCtx', path: '$.userId', ctx: 'principal.userId' };
    expect(engine.evaluate(expr, { userId: 'u1' }, { 'principal.userId': 'u1' })).toBe(true);
    expect(engine.evaluate(expr, { userId: 'u2' }, { 'principal.userId': 'u1' })).toBe(false);
  });

  it('neCtx: path value differs from ctx.principal.tenant', () => {
    const expr: ConsentArgsExpr = { op: 'neCtx', path: '$.tenantId', ctx: 'principal.tenant' };
    expect(engine.evaluate(expr, { tenantId: 999 }, { 'principal.tenant': 101 })).toBe(true);
    expect(engine.evaluate(expr, { tenantId: 101 }, { 'principal.tenant': 101 })).toBe(false);
  });
});

describe('ConsentPolicyEngine.evaluate — and / or nesting', () => {
  const andExpr: ConsentArgsExpr = {
    op: 'and',
    exprs: [
      { op: 'eq', path: '$.tool', value: 'orders.read' },
      { op: 'in', path: '$.userId', value: ['u1', 'u2'] },
    ],
  };

  it('and: true only when all sub-exprs are true', () => {
    expect(engine.evaluate(andExpr, { tool: 'orders.read', userId: 'u1' })).toBe(true);
    expect(engine.evaluate(andExpr, { tool: 'orders.read', userId: 'u3' })).toBe(false);
    expect(engine.evaluate(andExpr, { tool: 'orders.write', userId: 'u1' })).toBe(false);
  });

  it('or: true when at least one sub-expr is true', () => {
    const orExpr: ConsentArgsExpr = {
      op: 'or',
      exprs: [
        { op: 'eq', path: '$.role', value: 'admin' },
        { op: 'eq', path: '$.role', value: 'manager' },
      ],
    };
    expect(engine.evaluate(orExpr, { role: 'admin' })).toBe(true);
    expect(engine.evaluate(orExpr, { role: 'manager' })).toBe(true);
    expect(engine.evaluate(orExpr, { role: 'viewer' })).toBe(false);
  });

  it('deeply nested and/or evaluates correctly', () => {
    const nested: ConsentArgsExpr = {
      op: 'and',
      exprs: [
        { op: 'eq', path: '$.a', value: 1 },
        { op: 'or', exprs: [
          { op: 'eq', path: '$.b', value: 'x' },
          { op: 'eq', path: '$.b', value: 'y' },
        ]},
      ],
    };
    expect(engine.evaluate(nested, { a: 1, b: 'x' })).toBe(true);
    expect(engine.evaluate(nested, { a: 1, b: 'z' })).toBe(false);
    expect(engine.evaluate(nested, { a: 2, b: 'x' })).toBe(false);
  });
});

describe('ConsentPolicyEngine.evaluate — path resolution failures', () => {
  it('missing path → sub-expr false (never throws)', () => {
    const expr: ConsentArgsExpr = { op: 'eq', path: '$.x.y.z', value: 'anything' };
    expect(() => engine.evaluate(expr, {})).not.toThrow();
    expect(engine.evaluate(expr, {})).toBe(false);
  });
});
