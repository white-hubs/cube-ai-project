import { describe, expect, mock, test } from "bun:test";

import type { TenantDescriptorView } from "@cube-ai/contracts";

import type { DescriptorListingRepository } from "./listing.service";
import { RunnableAgentResolver } from "./runnable-agent-resolver";
import type { UserShelfRepository } from "./shelf.service";
import type { TenantDescriptorRepository } from "./tenant-descriptor.repository";

function descriptor(over: Partial<TenantDescriptorView> = {}): TenantDescriptorView {
  return {
    id: "agt_1",
    kind: "agent",
    name: "support",
    ownerUserId: "alice",
    status: "draft",
    headVersionNo: 2,
    publishedVersionNo: 1,
    hasUnpublishedChanges: true,
    content: { prompt: "draft prompt", skillRefs: [], ruleRefs: [], availableTools: [] },
    createTime: 0,
    updateTime: 0,
    ...over,
  };
}

function descriptorRepo(over: Partial<TenantDescriptorRepository> = {}): TenantDescriptorRepository {
  return {
    findById: mock(async () => descriptor()),
    getVersionContent: mock(async (_tenant, _id, versionNo) => ({
      prompt: `published v${versionNo}`,
      skillRefs: [],
      ruleRefs: [],
      availableTools: [],
    })),
    upsert: mock(),
    findByName: mock(),
    list: mock(),
    publish: mock(),
    softDelete: mock(),
    resolvePublished: mock(),
    listVersions: mock(),
    rollback: mock(),
    resolveDraft: mock(async () => descriptor()),
    ...over,
  } as unknown as TenantDescriptorRepository;
}

function listingRepo(over: Partial<DescriptorListingRepository> = {}): DescriptorListingRepository {
  return {
    get: mock(async () => ({
      descriptorId: "agt_1",
      listed: true,
      sharedVersionNo: 2,
      publisherUserId: "alice",
      listedTime: 1,
      unlistedTime: null,
    })),
    list: mock(),
    unlist: mock(),
    browseListed: mock(),
    getListed: mock(),
    ...over,
  } as unknown as DescriptorListingRepository;
}

function shelfRepo(over: Partial<UserShelfRepository> = {}): UserShelfRepository {
  return {
    findByTarget: mock(async () => ({
      id: "she_1",
      targetKind: "agent",
      targetId: "agt_1",
      source: "ref",
      pinVersionNo: null,
      enabled: true,
      effectiveVersionNo: 2,
      runnableStatus: "runnable",
    })),
    listByUser: mock(),
    findById: mock(),
    insertRef: mock(),
    patch: mock(),
    softDelete: mock(),
    upsertAuthored: mock(),
    ...over,
  } as unknown as UserShelfRepository;
}

describe("RunnableAgentResolver", () => {
  test("owner resolves own draft by default and can request a published version", async () => {
    const resolver = new RunnableAgentResolver(descriptorRepo(), listingRepo(), shelfRepo());

    const draft = await resolver.resolve(7, "alice", "agt_1");
    expect(draft.versionNo).toBe(0);
    expect(draft.record.prompt).toBe("draft prompt");

    const published = await resolver.resolve(7, "alice", "agt_1", { versionNo: 1 });
    expect(published.versionNo).toBe(1);
    expect(published.record.prompt).toBe("published v1");
  });

  test("non-owner resolves enabled shelf by floating listing or pinned version", async () => {
    const repo = descriptorRepo();
    const floating = new RunnableAgentResolver(repo, listingRepo(), shelfRepo());
    expect((await floating.resolve(7, "bob", "agt_1")).versionNo).toBe(2);

    const pinned = new RunnableAgentResolver(
      repo,
      listingRepo({ get: mock(async () => null) }),
      shelfRepo({
        findByTarget: mock(async () => ({
          id: "she_1",
          targetKind: "agent",
          targetId: "agt_1",
          source: "ref",
          pinVersionNo: 1,
          enabled: true,
          effectiveVersionNo: 1,
          runnableStatus: "runnable",
        })),
      }),
    );
    expect((await pinned.resolve(7, "bob", "agt_1")).versionNo).toBe(1);
  });

  test("non-owner without enabled shelf is not found", async () => {
    const resolver = new RunnableAgentResolver(descriptorRepo(), listingRepo(), shelfRepo({ findByTarget: mock(async () => null) }));

    await expect(resolver.resolve(7, "bob", "agt_1")).rejects.toMatchObject({
      code: "RESOURCE_NOT_FOUND_DESCRIPTOR",
    });
  });
});
