import { describe, expect, it } from 'bun:test';
import {
  parseTenantDescriptorId,
  TENANT_DESCRIPTOR_ID_PREFIXES,
  TenantAgentContentSchema,
  TenantRuleContentSchema,
  TenantSkillContentSchema,
} from './tenant-descriptor';

describe('parseTenantDescriptorId', () => {
  it('parses the three kind prefixes', () => {
    expect(parseTenantDescriptorId('agt_123')).toEqual({ kind: 'agent', sfid: '123' });
    expect(parseTenantDescriptorId('skl_456')).toEqual({ kind: 'skill', sfid: '456' });
    expect(parseTenantDescriptorId('rul_789')).toEqual({ kind: 'rule', sfid: '789' });
  });

  it('returns null for bare names (= system-level)', () => {
    expect(parseTenantDescriptorId('safety-baseline')).toBeNull();
    expect(parseTenantDescriptorId('myAgent')).toBeNull();
  });

  it('returns null for empty string, unknown prefix, missing sfid', () => {
    expect(parseTenantDescriptorId('')).toBeNull();
    expect(parseTenantDescriptorId('xyz_123')).toBeNull();
    expect(parseTenantDescriptorId('agt_')).toBeNull();
    expect(parseTenantDescriptorId('_123')).toBeNull();
  });

  it('keeps sfid intact when it contains underscores', () => {
    expect(parseTenantDescriptorId('agt_a_b')).toEqual({ kind: 'agent', sfid: 'a_b' });
  });

  it('prefix map covers exactly agent/skill/rule', () => {
    expect(Object.keys(TENANT_DESCRIPTOR_ID_PREFIXES).sort()).toEqual([
      'agent',
      'rule',
      'skill',
    ]);
  });
});

describe('TenantAgentContentSchema', () => {
  it('requires non-empty prompt and defaults ref arrays', () => {
    const parsed = TenantAgentContentSchema.parse({ prompt: 'You are helpful.' });
    expect(parsed.ruleRefs).toEqual([]);
    expect(parsed.skillRefs).toEqual([]);
    expect(parsed.availableTools).toEqual([]);
    expect(parsed.subAgentRefs).toEqual([]);

    expect(TenantAgentContentSchema.safeParse({ prompt: '' }).success).toBe(false);
    expect(TenantAgentContentSchema.safeParse({}).success).toBe(false);
  });

  it('bounds temperature and maxDepth', () => {
    expect(
      TenantAgentContentSchema.safeParse({
        prompt: 'p',
        modelConfig: { temperature: 2.5 },
      }).success,
    ).toBe(false);
    expect(
      TenantAgentContentSchema.safeParse({ prompt: 'p', maxDepth: 0 }).success,
    ).toBe(false);
    expect(
      TenantAgentContentSchema.safeParse({
        prompt: 'p',
        modelConfig: { provider: 'openai', model: 'gpt-4o', temperature: 0.7 },
        maxDepth: 3,
      }).success,
    ).toBe(true);
  });

  it('accepts shared meta fields', () => {
    const parsed = TenantAgentContentSchema.parse({
      prompt: 'p',
      displayName: '客服 Agent',
      tags: ['cs'],
      version: '1.2.0',
    });
    expect(parsed.displayName).toBe('客服 Agent');
    expect(parsed.tags).toEqual(['cs']);
    expect(parsed.version).toBe('1.2.0');
  });
});

describe('TenantSkillContentSchema', () => {
  it('requires description and instructions', () => {
    expect(
      TenantSkillContentSchema.safeParse({
        description: 'd',
        instructions: 'do this',
      }).success,
    ).toBe(true);
    expect(
      TenantSkillContentSchema.safeParse({ description: '', instructions: 'x' }).success,
    ).toBe(false);
    expect(
      TenantSkillContentSchema.safeParse({ description: 'd', instructions: '' }).success,
    ).toBe(false);
  });

  it('strips unknown frontmatter fields (resources/requires/deprecated)', () => {
    const parsed = TenantSkillContentSchema.parse({
      description: 'd',
      instructions: 'i',
      resources: [{ path: 'x' }],
      requires: ['y'],
      deprecated: true,
    } as Record<string, unknown>);
    expect('resources' in parsed).toBe(false);
    expect('requires' in parsed).toBe(false);
    expect('deprecated' in parsed).toBe(false);
  });
});

describe('TenantRuleContentSchema', () => {
  it('requires non-empty content; description optional', () => {
    expect(TenantRuleContentSchema.safeParse({ content: 'rule text' }).success).toBe(true);
    expect(TenantRuleContentSchema.safeParse({ content: '' }).success).toBe(false);
    expect(
      TenantRuleContentSchema.safeParse({ content: 'r', description: 'why' }).success,
    ).toBe(true);
  });
});
