import { describe, expect, test, beforeEach } from 'bun:test';
import { SfidService } from './sfid.service';

// ref: docs/technical-design/phase-1/P1-01-foundations.md §7

describe('SfidService', () => {
  let service: SfidService;

  beforeEach(() => {
    service = new SfidService();
  });

  test('generates exactly 19-digit decimal string', () => {
    const id = service.next();
    expect(id).toMatch(/^\d{19}$/);
  });

  test('1000 consecutive IDs are monotonically increasing (time-sorted)', () => {
    const ids = Array.from({ length: 1000 }, () => service.next());
    const sorted = [...ids].sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
    expect(ids).toEqual(sorted);
  });

  test('1000 IDs generated synchronously are all unique', () => {
    const ids = Array.from({ length: 1000 }, () => service.next());
    const unique = new Set(ids);
    expect(unique.size).toBe(1000);
  });

  test('parse() round-trips the timestamp field', () => {
    const before = BigInt(Date.now());
    const id = service.next();
    const after = BigInt(Date.now());
    const { timestamp } = service.parse(id);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after + 2n);
  });

  test('parse() extracts node = 0 when env not set', () => {
    const id = service.next();
    const { node } = service.parse(id);
    const envNode = Number(process.env.AGENTIC_ENGINE_NODE_ID ?? 0) & 1023;
    expect(node).toBe(envNode);
  });

  test('IDs generated across multiple service instances are still time-ordered', () => {
    const a = new SfidService();
    const b = new SfidService();
    const id1 = a.next();
    const id2 = b.next();
    // Same or increasing — both valid
    expect(BigInt(id1) <= BigInt(id2)).toBe(true);
  });
});
