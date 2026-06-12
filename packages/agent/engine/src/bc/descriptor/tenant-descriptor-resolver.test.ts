import { describe, test, expect, mock } from 'bun:test';
import { TenantDescriptorResolver } from './tenant-descriptor-resolver';
import type { TenantDescriptorRepository } from './tenant-descriptor.repository';
import type { TenantDescriptorView } from '@cube-ai/contracts';

function view(over: Partial<TenantDescriptorView>): TenantDescriptorView {
  return {
    id: 'x',
    kind: 'rule',
    name: 'n',
    status: 'published',
    headVersionNo: 1,
    publishedVersionNo: 1,
    content: {},
    createTime: 0,
    updateTime: 0,
    ...over,
  };
}

function repoWith(resolvePublished: (t: number, id: string) => Promise<TenantDescriptorView | null>) {
  return {
    upsert: mock(),
    findById: mock(),
    findByName: mock(),
    list: mock(),
    publish: mock(),
    softDelete: mock(),
    resolvePublished: mock(resolvePublished),
  } as unknown as TenantDescriptorRepository & { resolvePublished: ReturnType<typeof mock> };
}

describe('TenantDescriptorResolver — prefix routing + published-only + cache', () => {
  test('bare name (no prefix) is never routed to DB → null/undefined without a query', async () => {
    const repo = repoWith(async () => view({}));
    const r = new TenantDescriptorResolver(repo);
    expect(await r.getAgentRecord(1, 'support')).toBeNull();
    expect(await r.getRule(1, 'safety')).toBeUndefined();
    expect(await r.getSkill(1, 'review')).toBeUndefined();
    expect((repo as unknown as { resolvePublished: ReturnType<typeof mock> }).resolvePublished).not.toHaveBeenCalled();
  });

  test('rul_ prefix → RuleDescriptor mapped from published content', async () => {
    const repo = repoWith(async (_t, id) =>
      view({ id, kind: 'rule', name: 'safety', content: { content: 'No secrets.', description: 'why', version: '2.0.0' } }),
    );
    const r = new TenantDescriptorResolver(repo);
    const rule = await r.getRule(7, 'rul_123');
    expect(rule).toEqual({ kind: 'rule', name: 'safety', content: 'No secrets.', version: '2.0.0', description: 'why' });
  });

  test('agt_ prefix → agent record exposes both prompt and instructions + refs', async () => {
    const repo = repoWith(async (_t, id) =>
      view({
        id,
        kind: 'agent',
        name: 'support',
        content: { prompt: 'You are support.', ruleRefs: ['rul_1'], skillRefs: [], availableTools: ['web'] },
      }),
    );
    const r = new TenantDescriptorResolver(repo);
    const rec = await r.getAgentRecord(7, 'agt_9');
    expect(rec).toMatchObject({
      prompt: 'You are support.',
      instructions: 'You are support.',
      ruleRefs: ['rul_1'],
      availableTools: ['web'],
    });
  });

  test('skl_ prefix → SkillDescriptor with kind/name/instructions', async () => {
    const repo = repoWith(async (_t, id) =>
      view({ id, kind: 'skill', name: 'review', content: { description: 'Review', instructions: 'read diff' } }),
    );
    const r = new TenantDescriptorResolver(repo);
    const skill = (await r.getSkill(7, 'skl_5')) as unknown as Record<string, unknown>;
    expect(skill.kind).toBe('skill');
    expect(skill.name).toBe('review');
    expect(skill.instructions).toBe('read diff');
  });

  test('unpublished (resolvePublished → null) → undefined/null', async () => {
    const repo = repoWith(async () => null);
    const r = new TenantDescriptorResolver(repo);
    expect(await r.getRule(1, 'rul_1')).toBeUndefined();
    expect(await r.getAgentRecord(1, 'agt_1')).toBeNull();
  });

  test('kind mismatch (id prefix vs stored kind) → not returned', async () => {
    const repo = repoWith(async (_t, id) => view({ id, kind: 'agent', name: 'x', content: { prompt: 'p' } }));
    const r = new TenantDescriptorResolver(repo);
    // asking for a rule but the row is an agent → undefined
    expect(await r.getRule(1, 'rul_1')).toBeUndefined();
  });

  test('entry cache: second hit within TTL does not re-query; invalidate forces refetch', async () => {
    let calls = 0;
    const repo = repoWith(async (_t, id) => {
      calls++;
      return view({ id, kind: 'rule', name: 'safety', content: { content: `v${calls}` } });
    });
    const r = new TenantDescriptorResolver(repo, 10_000);
    const a = await r.getRule(1, 'rul_1');
    const b = await r.getRule(1, 'rul_1');
    expect(calls).toBe(1);
    expect((a as { content: string }).content).toBe('v1');
    expect((b as { content: string }).content).toBe('v1');

    r.invalidate(1, 'rul_1');
    const c = await r.getRule(1, 'rul_1');
    expect(calls).toBe(2);
    expect((c as { content: string }).content).toBe('v2');
  });

  test('invalidateAll clears every tenant entry', async () => {
    let calls = 0;
    const repo = repoWith(async (_t, id) => {
      calls++;
      return view({ id, kind: 'rule', name: 'n', content: { content: 'c' } });
    });
    const r = new TenantDescriptorResolver(repo, 10_000);
    await r.getRule(1, 'rul_1');
    await r.getRule(2, 'rul_2');
    expect(calls).toBe(2);
    r.invalidateAll();
    await r.getRule(1, 'rul_1');
    expect(calls).toBe(3);
  });
});
