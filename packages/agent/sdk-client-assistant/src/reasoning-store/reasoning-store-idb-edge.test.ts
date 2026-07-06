import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";

/**
 * IndexedDB ReasoningStore 边界 / 迁移 / 错误路径补充测试。
 * 沿用 reasoning-store.test.ts 的 fake-indexeddb 注入方式。
 */
import { type PersistedTokenUsage, type ReasoningTree } from "../types";
import { createIndexedDbReasoningStore } from "./index";

function makeTree(text = "plan-text"): ReasoningTree {
  return {
    steps: [
      {
        endTime: 100,
        kind: "lifecycle",
        label: "plan",
        ok: true,
        point: "turnStart",
        startTime: 1,
        stepId: "s1",
        text,
      },
    ],
  };
}

function makeUsage(): PersistedTokenUsage {
  return {
    cumulative: { input: 10, output: 2, total: 12 },
    items: [],
    terminalKind: "completed",
  };
}

/** 直接用底层 IDB 写任意 raw 行（模拟脏数据 / 旧 schema）。 */
async function writeRawRow(factory: IDBFactory, dbName: string, key: string, value: unknown, storeName = "reasoning"): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const open = factory.open(dbName, 1);
    open.onupgradeneeded = (): void => {
      open.result.createObjectStore(storeName);
    };
    open.onsuccess = (): void => {
      const db = open.result;
      const tx = db.transaction(storeName, "readwrite");
      tx.objectStore(storeName).put(value, key);
      tx.oncomplete = (): void => {
        db.close();
        resolve();
      };
      tx.onerror = (): void => reject(tx.error);
    };
    open.onerror = (): void => reject(open.error);
  });
}

describe("createIndexedDbReasoningStore — SSR / no-factory no-op", () => {
  test("无 factory 且环境无全局 indexedDB（Bun）→ get/put/bulkGet 全部 no-op 不抛", async () => {
    expect(typeof indexedDB).toBe("undefined");
    const s = createIndexedDbReasoningStore({ dbName: "ssr-db" });
    await s.put("sess", "msg", makeTree(), makeUsage());
    expect(await s.get("sess", "msg")).toBeNull();
    const m = await s.bulkGet("sess", ["msg"]);
    expect(m.size).toBe(0);
  });
});

describe("createIndexedDbReasoningStore — 边界行为", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  test("空 tree + 无 tokenUsage → put no-op（不占库）", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "edge-empty",
      indexedDBFactory: factory,
    });
    await s.put("sess", "msg", { steps: [] });
    expect(await s.get("sess", "msg")).toBeNull();
  });

  test("空 tree 但带 tokenUsage → 仍写入（任一非空即触发写）", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "edge-usage-only",
      indexedDBFactory: factory,
    });
    const tu = makeUsage();
    await s.put("sess", "msg", { steps: [] }, tu);
    const got = await s.get("sess", "msg");
    expect(got?.tree.steps).toHaveLength(0);
    expect(got?.tokenUsage).toEqual(tu);
  });

  test("bulkGet 空 messageIds → 直接返回空 Map", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "edge-bulk-empty",
      indexedDBFactory: factory,
    });
    const m = await s.bulkGet("sess", []);
    expect(m.size).toBe(0);
  });

  test("同 key 重复 put → 后写覆盖先写", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "edge-overwrite",
      indexedDBFactory: factory,
    });
    await s.put("sess", "msg", makeTree("first"));
    await s.put("sess", "msg", makeTree("second"), makeUsage());
    const got = await s.get("sess", "msg");
    expect(got?.tree.steps[0]?.text).toBe("second");
    expect(got?.tokenUsage).toEqual(makeUsage());
  });

  test("session 维度隔离：同 messageId 不同 sessionId 互不可见", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "edge-isolation",
      indexedDBFactory: factory,
    });
    await s.put("sess-a", "msg", makeTree());
    expect(await s.get("sess-b", "msg")).toBeNull();
    const m = await s.bulkGet("sess-b", ["msg"]);
    expect(m.size).toBe(0);
  });

  test("put 后调用方修改 tree → 已存行不受影响（写时 JSON 拷贝）", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "edge-copy",
      indexedDBFactory: factory,
    });
    const tree = makeTree("original");
    await s.put("sess", "msg", tree);
    tree.steps[0]!.text = "mutated";
    const got = await s.get("sess", "msg");
    expect(got?.tree.steps[0]?.text).toBe("original");
  });

  test("自定义 storeName 下 put → get round trip", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "edge-custom-store",
      indexedDBFactory: factory,
      storeName: "meta-rows",
    });
    await s.put("sess", "msg", makeTree());
    const got = await s.get("sess", "msg");
    expect(got?.tree.steps).toHaveLength(1);
  });
});

describe("createIndexedDbReasoningStore — 脏行 / schema 容错（parseRow）", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  test("行不是对象（纯字符串）→ get 返回 null", async () => {
    await writeRawRow(factory, "dirty-1", "sess::msg", "just-a-string");
    const s = createIndexedDbReasoningStore({
      dbName: "dirty-1",
      indexedDBFactory: factory,
    });
    expect(await s.get("sess", "msg")).toBeNull();
  });

  test("行缺 tree 字段 → get 返回 null", async () => {
    await writeRawRow(factory, "dirty-2", "sess::msg", { v: 2 });
    const s = createIndexedDbReasoningStore({
      dbName: "dirty-2",
      indexedDBFactory: factory,
    });
    expect(await s.get("sess", "msg")).toBeNull();
  });

  test("tree.steps 非数组 → get 返回 null", async () => {
    await writeRawRow(factory, "dirty-3", "sess::msg", {
      tree: { steps: "nope" },
      v: 2,
    });
    const s = createIndexedDbReasoningStore({
      dbName: "dirty-3",
      indexedDBFactory: factory,
    });
    expect(await s.get("sess", "msg")).toBeNull();
  });

  test("tokenUsage 非对象（数字 / null）→ 解析为 undefined，tree 仍可读", async () => {
    await writeRawRow(factory, "dirty-4", "sess::m1", {
      tokenUsage: 42,
      tree: makeTree(),
      v: 2,
    });
    await writeRawRow(factory, "dirty-4", "sess::m2", {
      tokenUsage: null,
      tree: makeTree(),
      v: 2,
    });
    const s = createIndexedDbReasoningStore({
      dbName: "dirty-4",
      indexedDBFactory: factory,
    });
    const m1 = await s.get("sess", "m1");
    expect(m1?.tree.steps).toHaveLength(1);
    expect(m1?.tokenUsage).toBeUndefined();
    const m2 = await s.get("sess", "m2");
    expect(m2?.tree.steps).toHaveLength(1);
    expect(m2?.tokenUsage).toBeUndefined();
  });

  test("bulkGet 混合好行 / 坏行 → 只返回好行，不抛", async () => {
    await writeRawRow(factory, "dirty-5", "sess::good", { tree: makeTree(), v: 2 });
    await writeRawRow(factory, "dirty-5", "sess::bad", { tree: "broken", v: 2 });
    const s = createIndexedDbReasoningStore({
      dbName: "dirty-5",
      indexedDBFactory: factory,
    });
    const m = await s.bulkGet("sess", ["good", "bad", "absent"]);
    expect(m.size).toBe(1);
    expect(m.get("good")?.tree.steps).toHaveLength(1);
    expect(m.has("bad")).toBe(false);
  });

  test("v1 旧行混 v2 新行 → bulkGet 同时读出（迁移期共存）", async () => {
    await writeRawRow(factory, "mig-1", "sess::old", { tree: makeTree("v1-text"), v: 1 });
    const s = createIndexedDbReasoningStore({
      dbName: "mig-1",
      indexedDBFactory: factory,
    });
    await s.put("sess", "new", makeTree("v2-text"), makeUsage());
    const m = await s.bulkGet("sess", ["old", "new"]);
    expect(m.size).toBe(2);
    expect(m.get("old")?.tree.steps[0]?.text).toBe("v1-text");
    expect(m.get("old")?.tokenUsage).toBeUndefined();
    expect(m.get("new")?.tree.steps[0]?.text).toBe("v2-text");
    expect(m.get("new")?.tokenUsage).toEqual(makeUsage());
  });
});
