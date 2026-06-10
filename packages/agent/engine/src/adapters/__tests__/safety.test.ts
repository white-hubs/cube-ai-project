/**
 * Unit tests — P1-04 BaselineSafetyAdapter
 * ref: docs/technical-design/prompts/phase-1/P1-04-adapters.md §6 unit tests
 * ref: docs/detailed-design/03-core-adapters/safety.md §3.4
 *
 * Critical paths covered:
 * CT-S1  Default config: short input passes checkBaseline()
 * CT-S2  Input exceeds maxInputLength → violation with policyId 'baseline/input_too_long'
 * CT-S3  Blacklist keyword match (case-insensitive by default)
 * CT-S4  Blacklist: case-sensitive match only when blacklistCaseSensitive=true
 * CT-S5  registerPolicy() wires a custom policy; deregister via returned fn
 * CT-S6  checkBusiness() aggregates violations from registered policies
 */
import { describe, it, expect } from 'bun:test';
import {
  BaselineSafetyAdapter,
  BASELINE_POLICY_IDS,
} from '../safety/baseline-safety';
import type { ExecutionContext, InputEnvelope, SafetyPolicy } from '@tachu/core';

const makeInput = (content: string): InputEnvelope => ({ content } as InputEnvelope);

const fakeCtx: ExecutionContext = {} as ExecutionContext;

// ─── BaselineSafetyAdapter ────────────────────────────────────────────────────

describe('BaselineSafetyAdapter', () => {
  it('CT-S1: short input passes with no violations', async () => {
    const safety = new BaselineSafetyAdapter();
    const result = await safety.checkBaseline(makeInput('hello world'), fakeCtx);
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('CT-S2: input exceeding maxInputLength produces INPUT_TOO_LONG violation', async () => {
    const safety = new BaselineSafetyAdapter({ maxInputLength: 5 });
    const result = await safety.checkBaseline(makeInput('123456'), fakeCtx);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]!.policyId).toBe(BASELINE_POLICY_IDS.INPUT_TOO_LONG);
    expect(result.violations[0]!.severity).toBe('error');
  });

  it('CT-S3: blacklist keyword match (case-insensitive default) produces BLACKLIST_HIT', async () => {
    const safety = new BaselineSafetyAdapter({ blacklistKeywords: ['forbidden'] });
    const result = await safety.checkBaseline(makeInput('This is FORBIDDEN content'), fakeCtx);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.policyId).toBe(BASELINE_POLICY_IDS.BLACKLIST_HIT);
  });

  it('CT-S4: case-sensitive blacklist does NOT match different case', async () => {
    const safety = new BaselineSafetyAdapter({
      blacklistKeywords: ['forbidden'],
      blacklistCaseSensitive: true,
    });
    const result = await safety.checkBaseline(makeInput('FORBIDDEN content'), fakeCtx);
    expect(result.passed).toBe(true);
  });

  it('CT-S4b: case-sensitive blacklist matches exact case', async () => {
    const safety = new BaselineSafetyAdapter({
      blacklistKeywords: ['FORBIDDEN'],
      blacklistCaseSensitive: true,
    });
    const result = await safety.checkBaseline(makeInput('FORBIDDEN content'), fakeCtx);
    expect(result.passed).toBe(false);
    expect(result.violations[0]!.policyId).toBe(BASELINE_POLICY_IDS.BLACKLIST_HIT);
  });

  it('CT-S5: registerPolicy adds policy; returned function deregisters it', async () => {
    const safety = new BaselineSafetyAdapter();

    const policy: SafetyPolicy = {
      id: 'test-policy',
      scope: ['safety'],
      check: async () => ({
        passed: false,
        violations: [{ policyId: 'test/hit', severity: 'error', message: 'test hit' }],
      }),
    };

    const deregister = safety.registerPolicy(policy);

    const resultBefore = await safety.checkBusiness(makeInput('any'), fakeCtx, 'safety');
    expect(resultBefore.passed).toBe(false);

    deregister();

    const resultAfter = await safety.checkBusiness(makeInput('any'), fakeCtx, 'safety');
    expect(resultAfter.passed).toBe(true);
  });

  it('CT-S6: checkBusiness aggregates violations from all registered policies', async () => {
    const safety = new BaselineSafetyAdapter();

    const makeWarnPolicy = (id: string): SafetyPolicy => ({
      id,
      scope: ['*'],
      check: async () => ({
        passed: true,
        violations: [{ policyId: id, severity: 'warning', message: `warning from ${id}` }],
      }),
    });

    safety.registerPolicy(makeWarnPolicy('policy-a'));
    safety.registerPolicy(makeWarnPolicy('policy-b'));

    const result = await safety.checkBusiness(makeInput('test'), fakeCtx, 'safety');
    // Two warnings → passed=true (no errors)
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(2);
  });
});
