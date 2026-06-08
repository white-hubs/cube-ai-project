import type { SafetyInput, SafetyPolicy, SafetyResult } from '@cube-ai/contracts';

/**
 * SafetyPolicyRegistry — ordered registry for safety evaluation policies.
 * ref: P1-12 design doc §3.6 + §4.4
 * ref: domains-index §P1-12 核心骨架文件
 *
 * Policies are evaluated in registration order.
 * Short-circuit on first `deny` (fail-fast).
 * All `mask` results are collected; first mask takes precedence if no deny.
 *
 * DI token: Symbol.for('agentic.security.policyRegistry')
 *
 * Usage (in engine-assembler or BaselineSafetyAdapter.onInit):
 *   registry.register(new PiiPolicy());
 *   registry.register(new LengthPolicy({ maxBytes: 100 * 1024 }));
 *   registry.register(new ShellBlacklistPolicy());
 */
export class SafetyPolicyRegistry {
  private readonly policies = new Map<string, SafetyPolicy>();

  /**
   * Registers a policy by name.
   * If a policy with the same name already exists, it is replaced.
   */
  register(policy: SafetyPolicy): void {
    this.policies.set(policy.name, policy);
  }

  /** Returns a registered policy by name, or undefined if not found. */
  getPolicy(name: string): SafetyPolicy | undefined {
    return this.policies.get(name);
  }

  /** Returns names of all registered policies (in registration order). */
  policyNames(): string[] {
    return [...this.policies.keys()];
  }

  /**
   * Evaluates all registered policies against the input.
   *
   * Short-circuit rules (ref: design doc §4.4):
   * 1. First `deny` → return [deny] immediately (fast-fail)
   * 2. Collect all `mask` results → return first mask if no deny
   * 3. All `allow` → return [allow]
   */
  evaluateAll(input: SafetyInput): SafetyResult[] {
    const results: SafetyResult[] = [];
    let firstMask: (SafetyResult & { kind: 'mask' }) | undefined;

    for (const policy of this.policies.values()) {
      const r = policy.evaluate(input);
      results.push(r);

      if (r.kind === 'deny') {
        // fast-fail: first deny wins
        return results;
      }
      if (r.kind === 'mask' && firstMask === undefined) {
        firstMask = r as SafetyResult & { kind: 'mask' };
      }
    }

    return results;
  }

  /**
   * Aggregated decision: returns the final SafetyResult for the input.
   * - deny > mask > allow
   */
  decide(input: SafetyInput): SafetyResult {
    for (const policy of this.policies.values()) {
      const r = policy.evaluate(input);
      if (r.kind === 'deny') return r;
    }
    for (const policy of this.policies.values()) {
      const r = policy.evaluate(input);
      if (r.kind === 'mask') return r;
    }
    return { kind: 'allow' };
  }
}
