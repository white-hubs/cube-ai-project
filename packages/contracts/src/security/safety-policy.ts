import { z } from 'zod';

/**
 * Safety policy result schema.
 * ref: P1-12 design doc §3.2 + agentic-adapters/src/safety/policy-registry.ts
 *
 * Three outcomes:
 * - allow: input passes this policy
 * - deny:  input is blocked (reason required)
 * - mask:  input is rewritten to remove sensitive content
 */
export const SafetyResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('allow') }),
  z.object({ kind: z.literal('deny'), reason: z.string().min(1) }),
  z.object({ kind: z.literal('mask'), masked: z.string() }),
]);

export type SafetyResult = z.infer<typeof SafetyResultSchema>;

/**
 * Input to a safety policy evaluation.
 * `text` is the raw content to check; metadata carries context (tenant, tool, etc.).
 */
export const SafetyInputSchema = z.object({
  text: z.string(),
  metadata: z.record(z.unknown()).optional(),
});

export type SafetyInput = z.infer<typeof SafetyInputSchema>;

/**
 * A single named safety policy.
 * ref: P1-12 design doc §3.6 / agentic-adapters policy-registry
 */
export interface SafetyPolicy {
  readonly name: string;
  evaluate(input: SafetyInput): SafetyResult;
}

/**
 * Nacos-configurable safety policy config (ref: safety.md §8).
 * Each policy can be enabled/disabled at runtime via Nacos.
 */
export const SafetyPolicyConfigSchema = z.object({
  /** Policy identifier name (e.g. 'pii-scan', 'length-check', 'shell-blacklist') */
  name: z.string(),
  enabled: z.boolean().default(true),
  options: z.record(z.unknown()).optional(),
});

export type SafetyPolicyConfig = z.infer<typeof SafetyPolicyConfigSchema>;
