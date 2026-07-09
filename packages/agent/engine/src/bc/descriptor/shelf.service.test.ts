import { describe, expect, mock, test } from "bun:test";

import type { DescriptorListingView, ShelfEntryView, TenantDescriptorView } from "@cube-ai/contracts";

import type { DescriptorListingRepository } from "./listing.service";
import { ShelfService, type UserShelfRepository } from "./shelf.service";
import type { TenantDescriptorRepository } from "./tenant-descriptor.repository";

function fakeDescriptor(over: Partial<TenantDescriptorView> = {}): TenantDescriptorView {
  return {
    id: "agt_1",
    kind: "agent",
    name: "support",
    ownerUserId: "alice",
    status: "published",
    headVersionNo: 2,
    publishedVersionNo: 1,
    hasUnpublishedChanges: true,
    content: { prompt: "draft", displayName: "Support Agent" },
    createTime: 0,
    updateTime: 0,
    ...over,
  };
}

function fakeListing(over: Partial<DescriptorListingView> = {}): DescriptorListingView {
  return {
    descriptorId: "agt_1",
    listed: true,
    sharedVersionNo: 1,
    publisherUserId: "alice",
    listedTime: 1,
    unlistedTime: null,
    ...over,
  };
}

function fakeEntry(over: Partial<ShelfEntryView> = {}): ShelfEntryView {
  return {
    id: "she_1",
    targetKind: "agent",
    targetId: "agt_1",
    source: "ref",
    pinVersionNo: null,
    enabled: true,
    displayName: "Support Agent",
    effectiveVersionNo: 1,
    runnableStatus: "runnable",
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
    upsertAuthored: mock(async () => fakeEntry({ source: "authored", effectiveVersionNo: null })),
    ...over,
  };
}

function fakeListingRepo(over: Partial<DescriptorListingRepository> = {}): DescriptorListingRepository {
  return {
    get: mock(async () => fakeListing()),
    list: mock(),
    unlist: mock(),
    browseListed: mock(),
    getListed: mock(),
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

describe("ShelfService", () => {
  test("installs listed tenant ref as floating or pinned shelf entry", async () => {
    const shelfRepo = fakeShelfRepo();
    const svc = new ShelfService(shelfRepo, fakeListingRepo(), fakeDescriptorRepo());

    await svc.install(7, "bob", "agent", { ref: "agt_1" });
    expect(shelfRepo.insertRef).toHaveBeenCalledWith(7, "bob", "agent", "agt_1", null);

    await svc.install(7, "bob", "agent", { ref: "agt_1", pin: true, mode: "ref" });
    expect(shelfRepo.insertRef).toHaveBeenCalledWith(7, "bob", "agent", "agt_1", 1);
  });

  test("rejects unlisted tenant ref and copy mode", async () => {
    const shelfRepo = fakeShelfRepo();
    const unlisted = new ShelfService(
      shelfRepo,
      fakeListingRepo({ get: mock(async () => fakeListing({ listed: false })) }),
      fakeDescriptorRepo(),
    );

    await expect(unlisted.install(7, "bob", "agent", { ref: "agt_1" })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION_DESCRIPTOR_NOT_LISTED",
    });

    await expect(unlisted.install(7, "bob", "agent", { ref: "agt_1", mode: "copy" })).rejects.toMatchObject({
      code: "UNIMPLEMENTED_COPY_DESCRIPTOR",
    });
    expect(shelfRepo.insertRef).not.toHaveBeenCalled();
  });

  test("system library ref without tenant version is runnable when enabled", async () => {
    const svc = new ShelfService(
      fakeShelfRepo({
        listByUser: mock(async () => [
          fakeEntry({
            targetId: "safety-baseline",
            source: "ref",
            enabled: true,
            effectiveVersionNo: null,
            displayName: undefined,
          }),
        ]),
      }),
      fakeListingRepo(),
      fakeDescriptorRepo(),
    );

    const entries = await svc.list(7, "bob", "agent");
    expect(entries[0]?.runnableStatus).toBe("runnable");
  });

  test("tenant ref without effective version stays unresolvable", async () => {
    const svc = new ShelfService(
      fakeShelfRepo({
        listByUser: mock(async () => [
          fakeEntry({
            targetId: "agt_99",
            source: "ref",
            enabled: true,
            effectiveVersionNo: null,
          }),
        ]),
      }),
      fakeListingRepo(),
      fakeDescriptorRepo(),
    );

    const entries = await svc.list(7, "bob", "agent");
    expect(entries[0]?.runnableStatus).toBe("unresolvable");
  });

  test("lists projected entries and computes disabled status", async () => {
    const svc = new ShelfService(
      fakeShelfRepo({ listByUser: mock(async () => [fakeEntry({ enabled: false })]) }),
      fakeListingRepo(),
      fakeDescriptorRepo(),
    );

    const entries = await svc.list(7, "bob", "agent");

    expect(entries).toEqual([fakeEntry({ enabled: false, runnableStatus: "disabled" })]);
  });

  test("filters listed shelf entries by enabled and source", async () => {
    const svc = new ShelfService(
      fakeShelfRepo({
        listByUser: mock(async () => [
          fakeEntry({ id: "she_ref_on", source: "ref", enabled: true }),
          fakeEntry({ id: "she_ref_off", source: "ref", enabled: false }),
          fakeEntry({ id: "she_authored_on", source: "authored", enabled: true }),
        ]),
      }),
      fakeListingRepo(),
      fakeDescriptorRepo(),
    );

    expect((await svc.list(7, "bob", "agent", { enabled: true })).map((e) => e.id)).toEqual(["she_ref_on", "she_authored_on"]);
    expect((await svc.list(7, "bob", "agent", { source: "ref" })).map((e) => e.id)).toEqual(["she_ref_on", "she_ref_off"]);
    expect((await svc.list(7, "bob", "agent", { enabled: true, source: "authored" })).map((e) => e.id)).toEqual(["she_authored_on"]);
  });

  test("patch pins to current effective version and remove soft-deletes shelf only", async () => {
    const shelfRepo = fakeShelfRepo();
    const svc = new ShelfService(shelfRepo, fakeListingRepo(), fakeDescriptorRepo());

    await svc.patch(7, "bob", "she_1", { pin: true });
    expect(shelfRepo.patch).toHaveBeenCalledWith(7, "bob", "she_1", { pinVersionNo: 1 });

    await svc.patch(7, "bob", "she_1", { enabled: false, pin: false });
    expect(shelfRepo.patch).toHaveBeenCalledWith(7, "bob", "she_1", {
      enabled: false,
      pinVersionNo: null,
    });

    await svc.remove(7, "bob", "she_1");
    expect(shelfRepo.softDelete).toHaveBeenCalledWith(7, "bob", "she_1");
  });

  test("authored descriptors are inserted into owner shelf", async () => {
    const shelfRepo = fakeShelfRepo();
    const svc = new ShelfService(shelfRepo, fakeListingRepo(), fakeDescriptorRepo());

    await svc.upsertAuthored(7, "alice", "agt_1", "agent");

    expect(shelfRepo.upsertAuthored).toHaveBeenCalledWith(7, "alice", "agt_1", "agent");
  });

  test("rejects installing engine-internal refs and hides them from shelf list", async () => {
    const shelfRepo = fakeShelfRepo({
      listByUser: mock(async () => [
        fakeEntry({ targetId: "cube-default", displayName: "CUBE Default Agent" }),
        fakeEntry({ targetId: "1934000000000000001", displayName: "安全智能体" }),
        fakeEntry({ targetKind: "skill", targetId: "default-reasoning", displayName: "默认推理" }),
        fakeEntry({ targetKind: "skill", targetId: "chart-output", displayName: "图表输出" }),
      ]),
    });
    const svc = new ShelfService(shelfRepo, fakeListingRepo(), fakeDescriptorRepo());

    await expect(svc.install(7, "bob", "agent", { ref: "cube-default" })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION_ENGINE_INTERNAL_DESCRIPTOR",
    });
    await expect(svc.install(7, "bob", "skill", { ref: "default-reasoning" })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION_ENGINE_INTERNAL_DESCRIPTOR",
    });
    await expect(svc.install(7, "bob", "skill", { ref: "chart-output" })).rejects.toMatchObject({
      code: "FAILED_PRECONDITION_ENGINE_INTERNAL_DESCRIPTOR",
    });

    const listed = await svc.list(7, "bob", "agent");
    expect(listed.map((entry) => entry.targetId)).toEqual(["1934000000000000001"]);
  });

  test("empty agent shelf auto-installs system agents once", async () => {
    const inserted: string[] = [];
    let shelf: ShelfEntryView[] = [];
    const shelfRepo = fakeShelfRepo({
      listByUser: mock(async () => shelf),
      findByTarget: mock(async (_t, _u, targetId) => shelf.find((e) => e.targetId === targetId) ?? null),
      insertRef: mock(async (_t, _u, kind, targetId) => {
        const entry = fakeEntry({
          id: `she_${targetId}`,
          targetKind: kind,
          targetId,
          displayName: targetId,
          effectiveVersionNo: null,
        });
        inserted.push(targetId);
        shelf = [...shelf, entry];
        return entry;
      }),
    });
    const systemSource = {
      systemAgents: mock(async () => [
        { name: "1934000000000000001", displayName: "安全智能体" },
        { name: "1934000000000000002", displayName: "孪生智能体" },
      ]),
    };
    const svc = new ShelfService(shelfRepo, fakeListingRepo(), fakeDescriptorRepo(), systemSource);

    const first = await svc.list(7, "new-user", "agent");
    expect(inserted).toEqual(["1934000000000000001", "1934000000000000002"]);
    expect(first.map((e) => e.targetId)).toEqual(["1934000000000000001", "1934000000000000002"]);
    expect(systemSource.systemAgents).toHaveBeenCalledTimes(1);

    const second = await svc.list(7, "new-user", "agent");
    expect(inserted).toHaveLength(2);
    expect(second.map((e) => e.targetId)).toEqual(["1934000000000000001", "1934000000000000002"]);
    expect(systemSource.systemAgents).toHaveBeenCalledTimes(1);
  });

  test("non-empty agent shelf skips system agent auto-install", async () => {
    const shelfRepo = fakeShelfRepo({
      listByUser: mock(async () => [fakeEntry({ targetId: "agt_mine", displayName: "我的助手" })]),
      insertRef: mock(async () => {
        throw new Error("should not insert");
      }),
    });
    const systemSource = {
      systemAgents: mock(async () => [{ name: "1934000000000000001", displayName: "安全智能体" }]),
    };
    const svc = new ShelfService(shelfRepo, fakeListingRepo(), fakeDescriptorRepo(), systemSource);

    const listed = await svc.list(7, "bob", "agent");
    expect(listed.map((e) => e.targetId)).toEqual(["agt_mine"]);
    expect(systemSource.systemAgents).not.toHaveBeenCalled();
    expect(shelfRepo.insertRef).not.toHaveBeenCalled();
  });
});
