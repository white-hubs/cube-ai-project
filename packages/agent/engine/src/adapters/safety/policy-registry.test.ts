import { describe, test, expect } from 'bun:test';
import { SafetyPolicyRegistry } from './policy-registry';
import type { SafetyPolicy, SafetyInput, SafetyResult } from '@cube-ai/contracts';

function makePolicy(name: string, result: SafetyResult): SafetyPolicy {
  return {
    name,
    evaluate: (_input: SafetyInput) => result,
  };
}

describe('SafetyPolicyRegistry', () => {
  test('register() + policyNames() returns registered name', () => {
    const reg = new SafetyPolicyRegistry();
    reg.register(makePolicy('p1', { kind: 'allow' }));
    expect(reg.policyNames()).toContain('p1');
  });

  test('evaluateAll() with all-allow returns [allow, allow]', () => {
    const reg = new SafetyPolicyRegistry();
    reg.register(makePolicy('p1', { kind: 'allow' }));
    reg.register(makePolicy('p2', { kind: 'allow' }));
    const results = reg.evaluateAll({ text: 'safe input' });
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.kind === 'allow')).toBe(true);
  });

  test('evaluateAll() short-circuits on first deny', () => {
    const reg = new SafetyPolicyRegistry();
    reg.register(makePolicy('p1', { kind: 'deny', reason: 'blocked' }));
    reg.register(makePolicy('p2', { kind: 'allow' })); // should not be reached
    const results = reg.evaluateAll({ text: 'bad input' });
    // only 1 result since we short-circuited
    expect(results).toHaveLength(1);
    expect(results[0]?.kind).toBe('deny');
  });

  test('decide() returns deny when any policy denies', () => {
    const reg = new SafetyPolicyRegistry();
    reg.register(makePolicy('p1', { kind: 'allow' }));
    reg.register(makePolicy('p2', { kind: 'deny', reason: 'too long' }));
    const result = reg.decide({ text: 'test' });
    expect(result.kind).toBe('deny');
  });

  test('decide() returns mask when any policy masks (no deny)', () => {
    const reg = new SafetyPolicyRegistry();
    reg.register(makePolicy('p1', { kind: 'allow' }));
    reg.register(makePolicy('p2', { kind: 'mask', masked: 'redacted' }));
    const result = reg.decide({ text: 'test' });
    expect(result.kind).toBe('mask');
    expect((result as { kind: 'mask'; masked: string }).masked).toBe('redacted');
  });

  test('decide() returns allow when all policies allow', () => {
    const reg = new SafetyPolicyRegistry();
    reg.register(makePolicy('p1', { kind: 'allow' }));
    reg.register(makePolicy('p2', { kind: 'allow' }));
    const result = reg.decide({ text: 'safe' });
    expect(result.kind).toBe('allow');
  });

  test('getPolicy() returns registered policy by name', () => {
    const reg = new SafetyPolicyRegistry();
    const p = makePolicy('my-policy', { kind: 'allow' });
    reg.register(p);
    expect(reg.getPolicy('my-policy')).toBe(p);
  });

  test('getPolicy() returns undefined for unknown name', () => {
    const reg = new SafetyPolicyRegistry();
    expect(reg.getPolicy('unknown')).toBeUndefined();
  });
});
