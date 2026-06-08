/**
 * Unit tests: Grant state machine transitions.
 * ref: P1-05 design doc §7
 *      docs/detailed-design/04-auth-and-authz/grant-lifecycle.md §2.1
 */
import { describe, it, expect } from 'bun:test';
import { transitionGrantState, deriveGrantState, isGrantActive } from './grant-state-machine';
import type { GrantState } from '@cube-ai/contracts';

describe('transitionGrantState', () => {
  it('allows PENDING → GRANTED', () => {
    expect(transitionGrantState('PENDING', 'GRANTED')).toBe('GRANTED');
  });

  it('allows PENDING → REVOKED (user denies)', () => {
    expect(transitionGrantState('PENDING', 'REVOKED')).toBe('REVOKED');
  });

  it('allows GRANTED → REVOKED', () => {
    expect(transitionGrantState('GRANTED', 'REVOKED')).toBe('REVOKED');
  });

  it('allows GRANTED → EXPIRED', () => {
    expect(transitionGrantState('GRANTED', 'EXPIRED')).toBe('EXPIRED');
  });

  it('rejects REVOKED → GRANTED (illegal: once revoked, stays revoked)', () => {
    expect(() => transitionGrantState('REVOKED', 'GRANTED')).toThrow();
  });

  it('rejects EXPIRED → GRANTED (illegal: expired grants cannot be revived)', () => {
    expect(() => transitionGrantState('EXPIRED', 'GRANTED')).toThrow();
  });

  it('rejects GRANTED → PENDING (illegal backwards transition)', () => {
    expect(() => transitionGrantState('GRANTED', 'PENDING')).toThrow();
  });

  it('thrown error message mentions the illegal transition', () => {
    let caught: string | undefined;
    try {
      transitionGrantState('REVOKED', 'GRANTED');
    } catch (e) {
      caught = (e as Error).message;
    }
    expect(caught).toContain('REVOKED');
    expect(caught).toContain('GRANTED');
  });
});

describe('deriveGrantState', () => {
  it('active grant → GRANTED', () => {
    expect(deriveGrantState({ deleted: 0 })).toBe('GRANTED');
  });

  it('deleted (epoch-ms in deleted) → REVOKED', () => {
    expect(deriveGrantState({ deleted: Date.now() })).toBe('REVOKED');
  });

  it('revokeTime set → REVOKED', () => {
    expect(deriveGrantState({ deleted: 0, revokeTime: Date.now() })).toBe('REVOKED');
  });

  it('expireTime in past → EXPIRED', () => {
    expect(deriveGrantState({ deleted: 0, expireTime: Date.now() - 1000 })).toBe('EXPIRED');
  });

  it('expireTime in future → GRANTED', () => {
    expect(deriveGrantState({ deleted: 0, expireTime: Date.now() + 60_000 })).toBe('GRANTED');
  });
});

describe('isGrantActive', () => {
  it('returns true for fresh active grant', () => {
    expect(isGrantActive({ deleted: 0 })).toBe(true);
  });

  it('returns false for deleted grant', () => {
    expect(isGrantActive({ deleted: 1745300000000 })).toBe(false);
  });

  it('returns false for expired grant', () => {
    expect(isGrantActive({ deleted: 0, expireTime: Date.now() - 100 })).toBe(false);
  });
});
