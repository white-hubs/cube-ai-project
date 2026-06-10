/**
 * Unit tests — P1-04 DI tokens
 * ref: docs/technical-design/prompts/phase-1/P1-04-adapters.md §6
 * ref: shared-context.md §7.2 Symbol.for('agentic.<bc>.<name>') convention
 *
 * Critical paths covered:
 * CT-T1  All 6 canonical AGENTIC_* tokens are unique Symbols
 * CT-T2  Legacy TACHU_* aliases point to the same Symbol as AGENTIC_* counterparts
 * CT-T3  Token descriptions follow 'agentic.adapter.*' convention
 */
import { describe, it, expect } from 'bun:test';
import {
  AGENTIC_PROVIDER_TOKEN,
  AGENTIC_VECTOR_STORE_TOKEN,
  AGENTIC_MEMORY_SYSTEM_TOKEN,
  AGENTIC_SAFETY_MODULE_TOKEN,
  AGENTIC_OBSERVABILITY_TOKEN,
  AGENTIC_EXECUTION_BACKEND_TOKEN,
  TACHU_PROVIDER_ADAPTER_TOKEN,
  TACHU_VECTOR_STORE_TOKEN,
  TACHU_MEMORY_SYSTEM_TOKEN,
  TACHU_SAFETY_MODULE_TOKEN,
  TACHU_OBSERVABILITY_EMITTER_TOKEN,
  TACHU_EXECUTION_BACKEND_TOKEN,
} from '../tokens';

describe('DI tokens', () => {
  const allCanonical = [
    AGENTIC_PROVIDER_TOKEN,
    AGENTIC_VECTOR_STORE_TOKEN,
    AGENTIC_MEMORY_SYSTEM_TOKEN,
    AGENTIC_SAFETY_MODULE_TOKEN,
    AGENTIC_OBSERVABILITY_TOKEN,
    AGENTIC_EXECUTION_BACKEND_TOKEN,
  ];

  it('CT-T1: all 6 canonical tokens are unique', () => {
    const set = new Set(allCanonical);
    expect(set.size).toBe(6);
  });

  it('CT-T1b: all canonical tokens are Symbols', () => {
    for (const token of allCanonical) {
      expect(typeof token).toBe('symbol');
    }
  });

  it('CT-T2: legacy aliases reference identical Symbols as canonical tokens', () => {
    expect(TACHU_PROVIDER_ADAPTER_TOKEN).toBe(AGENTIC_PROVIDER_TOKEN);
    expect(TACHU_VECTOR_STORE_TOKEN).toBe(AGENTIC_VECTOR_STORE_TOKEN);
    expect(TACHU_MEMORY_SYSTEM_TOKEN).toBe(AGENTIC_MEMORY_SYSTEM_TOKEN);
    expect(TACHU_SAFETY_MODULE_TOKEN).toBe(AGENTIC_SAFETY_MODULE_TOKEN);
    expect(TACHU_OBSERVABILITY_EMITTER_TOKEN).toBe(AGENTIC_OBSERVABILITY_TOKEN);
    expect(TACHU_EXECUTION_BACKEND_TOKEN).toBe(AGENTIC_EXECUTION_BACKEND_TOKEN);
  });

  it('CT-T3: canonical token descriptions follow agentic.adapter.* convention', () => {
    for (const token of allCanonical) {
      const desc = token.description ?? '';
      expect(desc.startsWith('agentic.adapter.')).toBe(true);
    }
  });
});
