import { describe, expect, it } from 'bun:test';
import {
  InstallRequestSchema,
  ShelfEntryViewSchema,
  ShelfPatchSchema,
  ShelfSourceSchema,
} from './index';

describe('shelf schemas', () => {
  it('defaults installs to floating ref mode', () => {
    expect(InstallRequestSchema.parse({ ref: 'agt_123' })).toEqual({
      ref: 'agt_123',
      mode: 'ref',
      pin: false,
    });
    expect(InstallRequestSchema.parse({ ref: 'agt_123', pin: true }).pin).toBe(true);
    expect(InstallRequestSchema.parse({ ref: 'agt_123', mode: 'copy' }).mode).toBe('copy');
  });

  it('accepts the three shelf source kinds', () => {
    expect(ShelfSourceSchema.parse('authored')).toBe('authored');
    expect(ShelfSourceSchema.parse('ref')).toBe('ref');
    expect(ShelfSourceSchema.parse('copy')).toBe('copy');
    expect(ShelfSourceSchema.safeParse('fork').success).toBe(false);
  });

  it('projects shelf entries with effective runnable status', () => {
    const parsed = ShelfEntryViewSchema.parse({
      id: 'she_123',
      targetKind: 'agent',
      targetId: 'agt_123',
      source: 'ref',
      pinVersionNo: null,
      enabled: true,
      displayName: 'Support Agent',
      effectiveVersionNo: 2,
      runnableStatus: 'runnable',
    });

    expect(parsed.pinVersionNo).toBeNull();
    expect(parsed.runnableStatus).toBe('runnable');
  });

  it('validates shelf patch fields independently', () => {
    expect(ShelfPatchSchema.parse({ enabled: false })).toEqual({ enabled: false });
    expect(ShelfPatchSchema.parse({ pin: true })).toEqual({ pin: true });
    expect(ShelfPatchSchema.parse({ enabled: true, pin: false })).toEqual({
      enabled: true,
      pin: false,
    });
    expect(ShelfPatchSchema.safeParse({ enabled: 'yes' }).success).toBe(false);
  });
});
