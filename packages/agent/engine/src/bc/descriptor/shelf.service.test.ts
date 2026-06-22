import { describe, expect, mock, test } from 'bun:test';
import type {
  DescriptorListingView,
  ShelfEntryView,
  TenantDescriptorView,
} from '@cube-ai/contracts';
import type { TenantDescriptorRepository } from './tenant-descriptor.repository';
import type { DescriptorListingRepository } from './listing.service';
import { ShelfService, type UserShelfRepository } from './shelf.service';

function fakeDescriptor(over: Partial<TenantDescriptorView> = {}): TenantDescriptorView {
  return {
    id: 'agt_1',
    kind: 'agent',
    name: 'support',
    ownerUserId: 'alice',
    status: 'published',
    headVersionNo: 2,
    publishedVersionNo: 1,
    hasUnpublishedChanges: true,
    content: { prompt: 'draft', displayName: 'Support Agent' },
    createTime: 0,
    updateTime: 0,
    ...over,
  };
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

function fakeEntry(over: Partial<ShelfEntryView> = {}): ShelfEntryView {
  return {
    id: 'she_1',
    targetKind: 'agent',
    targetId: 'agt_1',
    source: 'ref',
    pinVersionNo: null,
    enabled: true,
    displayName: 'Support Agent',
    effectiveVersionNo: 1,
    runnableStatus: 'runnable',
    ...over,
  };
}

function fakeShelfRepo(over: Partial<UserShelfRepository> = {}): UserShelfRepository {
  return {
    listByUser: mock(async () => [fakeEntry()]),
    findByTarget: mock(async () => null),
    findById: mock(async () => fakeEntry()),
    insertRef: mock(async () => fakeEntry()),
    patch: mock(async () => fakeEntry()),
    softDelete: mock(async () => undefined),
    upsertAuthored: mock(async () => fakeEntry({ source: 'authored', effectiveVersionNo: null })),
    ...over,
  };
}

function fakeListingRepo(over: Partial<DescriptorListingRepository> = {}): DescriptorListingRepository {
  return {
    get: mock(async () => fakeListing()),
    list: mock(),
    unlist: mock(),
    browseListed: mock(),
    ...over,
  } as unknown as DescriptorListingRepository;
}

function fakeDescriptorRepo(over: Partial<TenantDescriptorRepository> = {}): TenantDescriptorRepository {
  return {
    findById: mock(async () => fakeDescriptor()),
    upsert: mock(),
    findByName: mock(),
    list: mock(),
    publish: mock(),
    softDelete: mock(),
    resolvePublished: mock(),
    listVersions: mock(),
    getVersionContent: mock(),
    rollback: mock(),
    resolveDraft: mock(),
    ...over,
  } as unknown as TenantDescriptorRepository;
}

describe('ShelfService', () => {
  test('installs listed tenant ref as floating or pinned shelf entry', async () => {
    const shelfRepo = fakeShelfRepo();
    const svc = new ShelfService(shelfRepo, fakeListingRepo(), fakeDescriptorRepo());

    await svc.install(7, 'bob', 'agent', { ref: 'agt_1' });
    expect(shelfRepo.insertRef).toHaveBeenCalledWith(7, 'bob', 'agent', 'agt_1', null);

    await svc.install(7, 'bob', 'agent', { ref: 'agt_1', pin: true, mode: 'ref' });
    expect(shelfRepo.insertRef).toHaveBeenCalledWith(7, 'bob', 'agent', 'agt_1', 1);
  });

  test('rejects unlisted tenant ref and copy mode', async () => {
    const shelfRepo = fakeShelfRepo();
    const unlisted = new ShelfService(
      shelfRepo,
      fakeListingRepo({ get: mock(async () => fakeListing({ listed: false })) }),
      fakeDescriptorRepo(),
    );

    await expect(unlisted.install(7, 'bob', 'agent', { ref: 'agt_1' })).rejects.toMatchObject({
      code: 'FAILED_PRECONDITION_DESCRIPTOR_NOT_LISTED',
    });

    await expect(
      unlisted.install(7, 'bob', 'agent', { ref: 'agt_1', mode: 'copy' }),
    ).rejects.toMatchObject({ code: 'UNIMPLEMENTED_COPY_DESCRIPTOR' });
    expect(shelfRepo.insertRef).not.toHaveBeenCalled();
  });

  test('lists projected entries and computes disabled status', async () => {
    const svc = new ShelfService(
      fakeShelfRepo({ listByUser: mock(async () => [fakeEntry({ enabled: false })]) }),
      fakeListingRepo(),
      fakeDescriptorRepo(),
    );

    const entries = await svc.list(7, 'bob', 'agent');

    expect(entries).toEqual([fakeEntry({ enabled: false, runnableStatus: 'disabled' })]);
  });

  test('filters listed shelf entries by enabled and source', async () => {
    const svc = new ShelfService(
      fakeShelfRepo({
        listByUser: mock(async () => [
          fakeEntry({ id: 'she_ref_on', source: 'ref', enabled: true }),
          fakeEntry({ id: 'she_ref_off', source: 'ref', enabled: false }),
          fakeEntry({ id: 'she_authored_on', source: 'authored', enabled: true }),
        ]),
      }),
      fakeListingRepo(),
      fakeDescriptorRepo(),
    );

    expect((await svc.list(7, 'bob', 'agent', { enabled: true })).map((e) => e.id)).toEqual([
      'she_ref_on',
      'she_authored_on',
    ]);
    expect((await svc.list(7, 'bob', 'agent', { source: 'ref' })).map((e) => e.id)).toEqual([
      'she_ref_on',
      'she_ref_off',
    ]);
    expect((await svc.list(7, 'bob', 'agent', { enabled: true, source: 'authored' })).map((e) => e.id)).toEqual([
      'she_authored_on',
    ]);
  });

  test('patch pins to current effective version and remove soft-deletes shelf only', async () => {
    const shelfRepo = fakeShelfRepo();
    const svc = new ShelfService(shelfRepo, fakeListingRepo(), fakeDescriptorRepo());

    await svc.patch(7, 'bob', 'she_1', { pin: true });
    expect(shelfRepo.patch).toHaveBeenCalledWith(7, 'bob', 'she_1', { pinVersionNo: 1 });

    await svc.patch(7, 'bob', 'she_1', { enabled: false, pin: false });
    expect(shelfRepo.patch).toHaveBeenCalledWith(7, 'bob', 'she_1', {
      enabled: false,
      pinVersionNo: null,
    });

    await svc.remove(7, 'bob', 'she_1');
    expect(shelfRepo.softDelete).toHaveBeenCalledWith(7, 'bob', 'she_1');
  });

  test('authored descriptors are inserted into owner shelf', async () => {
    const shelfRepo = fakeShelfRepo();
    const svc = new ShelfService(shelfRepo, fakeListingRepo(), fakeDescriptorRepo());

    await svc.upsertAuthored(7, 'alice', 'agt_1', 'agent');

    expect(shelfRepo.upsertAuthored).toHaveBeenCalledWith(7, 'alice', 'agt_1', 'agent');
  });
});
