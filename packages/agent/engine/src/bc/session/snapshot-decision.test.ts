import { describe, test, expect } from 'bun:test';
import { SnapshotDecision } from './snapshot-decision';

/**
 * Unit tests for SnapshotDecision (inline vs external threshold).
 * ref: P1-06 design doc §7 + §3.5
 *      ADR-0012 §D2 (2KB inline threshold)
 */

const decision = new SnapshotDecision();

/** Build a payload whose JSON is approximately `targetBytes` bytes. */
function buildPayload(targetBytes: number): object {
  // Each char in "x" string → 1 UTF-8 byte; add overhead of `{"data":""}` = 10 bytes
  const overhead = Buffer.byteLength(JSON.stringify({ data: '' }), 'utf8');
  const fillLength = Math.max(0, targetBytes - overhead);
  return { data: 'x'.repeat(fillLength) };
}

describe('SnapshotDecision.decide', () => {
  test('INLINE_THRESHOLD_BYTES is 2048', () => {
    expect(SnapshotDecision.INLINE_THRESHOLD_BYTES).toBe(2048);
  });

  test('empty object → inline', () => {
    expect(decision.decide({})).toBe('inline');
  });

  test('payload of 2047 bytes → inline', () => {
    const payload = buildPayload(2047);
    const actual = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    expect(actual).toBeLessThanOrEqual(2047);
    expect(decision.decide(payload)).toBe('inline');
  });

  test('payload of exactly 2048 bytes → inline (boundary: ≤ threshold)', () => {
    const payload = buildPayload(2048);
    const actual = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    expect(actual).toBe(2048);
    expect(decision.decide(payload)).toBe('inline');
  });

  test('payload of 2049 bytes → external (boundary: > threshold)', () => {
    const payload = buildPayload(2049);
    const actual = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    expect(actual).toBe(2049);
    expect(decision.decide(payload)).toBe('external');
  });

  test('large payload (10 KB) → external', () => {
    expect(decision.decide(buildPayload(10_000))).toBe('external');
  });

  test('unicode payload (multi-byte chars) uses UTF-8 byte count', () => {
    // '中' is 3 bytes in UTF-8. Pack enough to cross threshold.
    const chars = Math.ceil(2050 / 3);
    const payload = { data: '中'.repeat(chars) };
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    expect(bytes).toBeGreaterThan(2048);
    expect(decision.decide(payload)).toBe('external');
  });
});
