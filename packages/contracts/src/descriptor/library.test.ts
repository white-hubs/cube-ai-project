import { describe, expect, it } from 'bun:test';
import {
  AvailableToolViewSchema,
  InstallToolRequestSchema,
  LibraryItemViewSchema,
  PluginCatalogItemViewSchema,
} from './index';

describe('library item schemas', () => {
  it('allows tenant library items to expose shared content', () => {
    const parsed = LibraryItemViewSchema.parse({
      ref: 'agt_123',
      kind: 'agent',
      tier: 'tenant',
      displayName: 'Support Agent',
      description: 'Helps support users',
      tags: ['support'],
      sharedVersionNo: 3,
      content: { prompt: 'Help support users.' },
    });

    expect(parsed.tier).toBe('tenant');
    expect(parsed.content).toEqual({ prompt: 'Help support users.' });
  });

  it('keeps system library items opaque', () => {
    const parsed = LibraryItemViewSchema.parse({
      ref: 'system-support-agent',
      kind: 'agent',
      tier: 'system',
      displayName: 'System Support Agent',
      description: 'Built-in capability summary',
      tags: ['system'],
    });

    expect(parsed.tier).toBe('system');
    expect('content' in parsed).toBe(false);
    expect(
      LibraryItemViewSchema.safeParse({
        ref: 'system-support-agent',
        kind: 'agent',
        tier: 'system',
        content: { prompt: 'hidden' },
      }).success,
    ).toBe(false);
  });
});

describe('plugin catalog schemas', () => {
  it('projects plugin catalog items with installed state', () => {
    const parsed = PluginCatalogItemViewSchema.parse({
      toolName: 'currentDate',
      displayName: 'Current Date',
      description: 'Returns current date',
      tags: ['builtin'],
      installed: false,
    });

    expect(parsed.installed).toBe(false);
  });

  it('validates user available tools and install requests', () => {
    expect(AvailableToolViewSchema.parse({ toolName: 'currentDate', enabled: true })).toEqual({
      toolName: 'currentDate',
      enabled: true,
    });
    expect(InstallToolRequestSchema.parse({ toolName: 'currentDate' })).toEqual({
      toolName: 'currentDate',
    });
    expect(InstallToolRequestSchema.safeParse({}).success).toBe(false);
  });
});
