import { describe, expect, mock, test } from 'bun:test';
import type {
  DescriptorListingView,
  LibraryItemView,
  TenantDescriptorView,
} from '@cube-ai/contracts';
import type { OutboxWriter } from '@cube-ai/bun-server-ext-outbox';
import type { TenantDescriptorRepository } from './tenant-descriptor.repository';
import {
  LibraryService,
  ListingService,
  type DescriptorListingRepository,
} from './listing.service';

function fakeView(over: Partial<TenantDescriptorView> = {}): TenantDescriptorView {
  return {
    id: 'agt_1',
    kind: 'agent',
    name: 'support',
    ownerUserId: 'alice',
    status: 'published',
    headVersionNo: 1,
    publishedVersionNo: 1,
    hasUnpublishedChanges: false,
    content: { prompt: 'draft', displayName: 'Support' },
    createTime: 0,
    updateTime: 0,
    ...over,
  };
}

function fakeDescriptorRepo(over: Partial<TenantDescriptorRepository> = {}): TenantDescriptorRepository {
  return {
    findById: mock(async () => fakeView()),
    getVersionContent: mock(async () => ({ prompt: 'published', displayName: 'Support' })),
    upsert: mock(),
    findByName: mock(),
    list: mock(),
    publish: mock(),
    softDelete: mock(),
    resolvePublished: mock(),
    listVersions: mock(),
    rollback: mock(),
    resolveDraft: mock(),
    ...over,
  } as unknown as TenantDescriptorRepository;
}

function fakeListing(over: Partial<DescriptorListingView> = {}): DescriptorListingView {
  return {
    descriptorId: 'agt_1',
    listed: true,
    sharedVersionNo: 1,
    publisherUserId: 'alice',
    listedTime: 1,
    unlistedTime: null,
    ...over,
  };
}

function fakeListingRepo(over: Partial<DescriptorListingRepository> = {}): DescriptorListingRepository {
  return {
    get: mock(async () => fakeListing()),
    list: mock(async () => fakeListing()),
    unlist: mock(async () => fakeListing({ listed: false, unlistedTime: 2 })),
    browseListed: mock(async (_tenant: number, kind: 'agent' | 'skill') =>
      kind === 'agent'
        ? [
            {
              ref: 'agt_1',
              kind: 'agent',
              tier: 'tenant',
              displayName: 'Support',
              sharedVersionNo: 1,
              content: { prompt: 'published' },
            } satisfies LibraryItemView,
          ]
        : [],
    ),
    ...over,
  };
}

function fakeOutbox(): OutboxWriter {
  return {
    append: mock(async () => undefined),
  } as unknown as OutboxWriter;
}

describe('ListingService', () => {
  test('lists a descriptor only for owner and an existing published version', async () => {
    const descriptorRepo = fakeDescriptorRepo();
    const listingRepo = fakeListingRepo();
    const outbox = fakeOutbox();
    const svc = new ListingService(descriptorRepo, listingRepo, outbox);

    const listed = await svc.list(7, 'agt_1', 1, 'alice');

    expect(listingRepo.list).toHaveBeenCalledWith(7, 'agt_1', 1, 'alice');
    expect(listed.sharedVersionNo).toBe(1);
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect((outbox.append as ReturnType<typeof mock>).mock.calls[0][1]).toMatchObject({
      tenant: 7,
      channel: 'descriptor_reload',
      eventType: 'descriptor.reload',
      payloadJson: { tenant: 7, descriptorId: 'agt_1' },
      target: 'agt_1',
    });
  });

  test('rejects listing by non-owner or unpublished version', async () => {
    const listingRepo = fakeListingRepo();
    const svc = new ListingService(fakeDescriptorRepo(), listingRepo);

    await expect(svc.list(7, 'agt_1', 1, 'bob')).rejects.toMatchObject({
      code: 'PERMISSION_DENIED_DESCRIPTOR_OWNER',
    });
    expect(listingRepo.list).not.toHaveBeenCalled();

    const unpublished = new ListingService(
      fakeDescriptorRepo({ getVersionContent: mock(async () => null) }),
      listingRepo,
    );
    await expect(unpublished.list(7, 'agt_1', 99, 'alice')).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION_DESCRIPTOR_VERSION_UNPUBLISHED',
    });
  });

  test('unlist allows descriptor admin bypass', async () => {
    const listingRepo = fakeListingRepo();
    const outbox = fakeOutbox();
    const svc = new ListingService(fakeDescriptorRepo(), listingRepo, outbox);

    await svc.unlist(7, 'agt_1', 'admin', { isAdmin: true });

    expect(listingRepo.unlist).toHaveBeenCalledWith(7, 'agt_1', 'admin');
    expect(outbox.append).toHaveBeenCalledTimes(1);
    expect((outbox.append as ReturnType<typeof mock>).mock.calls[0][1]).toMatchObject({
      tenant: 7,
      channel: 'descriptor_reload',
      payloadJson: { tenant: 7, descriptorId: 'agt_1' },
    });
  });
});

describe('LibraryService', () => {
  test('combines transparent tenant listings with opaque system agents and skills', async () => {
    const svc = new LibraryService(fakeListingRepo(), {
      systemAgents: async () => [
        {
          name: 'builtin-agent',
          displayName: 'Builtin Agent',
          description: 'system capability',
          content: { prompt: 'must stay hidden' },
        },
      ],
      systemSkills: () => [
        {
          name: 'builtin-skill',
          displayName: 'Builtin Skill',
          description: 'skill capability',
          instructions: 'must stay hidden',
        },
      ],
    });

    const agents = await svc.browse(7, 'agent');
    expect(agents).toContainEqual({
      ref: 'agt_1',
      kind: 'agent',
      tier: 'tenant',
      displayName: 'Support',
      sharedVersionNo: 1,
      content: { prompt: 'published' },
    });
    expect(agents).toContainEqual({
      ref: 'builtin-agent',
      kind: 'agent',
      tier: 'system',
      displayName: 'Builtin Agent',
      description: 'system capability',
    });
    expect(JSON.stringify(agents)).not.toContain('must stay hidden');

    const skills = await svc.browse(7, 'skill');
    expect(skills).toEqual([
      {
        ref: 'builtin-skill',
        kind: 'skill',
        tier: 'system',
        displayName: 'Builtin Skill',
        description: 'skill capability',
      },
    ]);
  });

  test('filters library browse by tier and query', async () => {
    const svc = new LibraryService(fakeListingRepo(), {
      systemAgents: async () => [
        {
          name: 'builtin-agent',
          displayName: 'Builtin Agent',
          description: 'system capability',
          tags: ['ops'],
        },
      ],
      systemSkills: () => [],
    });

    expect(await svc.browse(7, 'agent', { tier: 'tenant' })).toEqual([
      {
        ref: 'agt_1',
        kind: 'agent',
        tier: 'tenant',
        displayName: 'Support',
        sharedVersionNo: 1,
        content: { prompt: 'published' },
      },
    ]);
    expect(await svc.browse(7, 'agent', { tier: 'system' })).toEqual([
      {
        ref: 'builtin-agent',
        kind: 'agent',
        tier: 'system',
        displayName: 'Builtin Agent',
        description: 'system capability',
        tags: ['ops'],
      },
    ]);
    expect((await svc.browse(7, 'agent', { q: 'support' })).map((i) => i.ref)).toEqual(['agt_1']);
    expect((await svc.browse(7, 'agent', { q: 'ops' })).map((i) => i.ref)).toEqual(['builtin-agent']);
  });

  test('hides engine-internal system agents and skills from library browse', async () => {
    const svc = new LibraryService(fakeListingRepo(), {
      systemAgents: async () => [
        { name: 'cube-default', displayName: 'CUBE Default Agent' },
        { name: '1934000000000000001', displayName: '安全智能体' },
      ],
      systemSkills: () => [
        { name: 'default-reasoning', displayName: '默认推理' },
        { name: 'chart-output', displayName: '图表输出' },
        { name: 'custom-skill', displayName: 'Custom Skill' },
      ],
    });

    expect((await svc.browse(7, 'agent', { tier: 'system' })).map((i) => i.ref)).toEqual(['1934000000000000001']);
    expect((await svc.browse(7, 'skill')).map((i) => i.ref)).toEqual(['custom-skill']);
    await expect(svc.get(7, 'agent', 'cube-default')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND_DESCRIPTOR',
    });
  });

  test('gets tenant and system library details with correct opacity', async () => {
    const svc = new LibraryService(fakeListingRepo(), {
      systemAgents: async () => [
        {
          name: 'builtin-agent',
          displayName: 'Builtin Agent',
          description: 'system capability',
          content: { prompt: 'must stay hidden' },
        },
      ],
      systemSkills: () => [
        {
          name: 'builtin-skill',
          displayName: 'Builtin Skill',
          instructions: 'must stay hidden',
        },
      ],
    });

    expect(await svc.get(7, 'agent', 'agt_1')).toMatchObject({
      ref: 'agt_1',
      tier: 'tenant',
      content: { prompt: 'published' },
    });
    const systemAgent = await svc.get(7, 'agent', 'builtin-agent');
    expect(systemAgent).toEqual({
      ref: 'builtin-agent',
      kind: 'agent',
      tier: 'system',
      displayName: 'Builtin Agent',
      description: 'system capability',
    });
    expect(JSON.stringify(systemAgent)).not.toContain('must stay hidden');

    const systemSkill = await svc.get(7, 'skill', 'builtin-skill');
    expect(systemSkill).toEqual({
      ref: 'builtin-skill',
      kind: 'skill',
      tier: 'system',
      displayName: 'Builtin Skill',
    });
    expect(JSON.stringify(systemSkill)).not.toContain('must stay hidden');

    await expect(svc.get(7, 'agent', 'missing')).rejects.toMatchObject({
      code: 'RESOURCE_NOT_FOUND_DESCRIPTOR',
    });
  });
});
