import type { SafetyInput, SafetyResult } from '@cube-ai/contracts';

export interface LengthPolicyOptions {
  /**
   * Maximum allowed byte length of input.text.
   * Default: 100 * 1024 (100 KiB).
   * ref: P1-12 design doc §6.4
   */
  maxBytes?: number;
}

/**
 * LengthPolicy — enforces maximum input size.
 * Prevents prompt injection via oversized payloads and reduces DoS risk.
 * ref: threat-model.md DoS / prompt injection surface
 * ref: P1-12 design doc §6.4
 *
 * Uses UTF-8 byte length (not character count) to match downstream
 * LLM / Tool API limits accurately.
 */
export class LengthPolicy {
  readonly name = 'length-check';
  private readonly maxBytes: number;

  constructor(options: LengthPolicyOptions = {}) {
    this.maxBytes = options.maxBytes ?? 100 * 1024;
  }

  evaluate(input: SafetyInput): SafetyResult {
    const byteLen = new TextEncoder().encode(input.text).length;
    if (byteLen > this.maxBytes) {
      return {
        kind: 'deny',
        reason: `input exceeds maximum allowed size: ${byteLen} bytes > ${this.maxBytes} bytes`,
      };
    }
    return { kind: 'allow' };
  }
}
