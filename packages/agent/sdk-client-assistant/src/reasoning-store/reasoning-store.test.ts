import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";

import { type PersistedTokenUsage, type ReasoningTree } from "../types";
import { createIndexedDbReasoningStore, createMemoryReasoningStore } from "./index";

function makeTree(): ReasoningTree {
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
        text: "plan-text",
      },
    ],
  };
}

describe("createMemoryReasoningStore", () => {
  test("put → get round trip", async () => {
    const s = createMemoryReasoningStore();
    await s.put("sess", "msg", makeTree());
    const got = await s.get("sess", "msg");
    expect(got?.tree.steps).toHaveLength(1);
    expect(got?.tree.steps[0]?.text).toBe("plan-text");
    expect(got?.tokenUsage).toBeUndefined();
  });

  test("put with empty tree is no-op", async () => {
    const s = createMemoryReasoningStore();
    await s.put("sess", "msg", { steps: [] });
    expect(await s.get("sess", "msg")).toBeNull();
  });

  test("bulkGet returns Map<messageId, MessageMetaRow>（含 tree 和可选 tokenUsage）", async () => {
    const s = createMemoryReasoningStore();
    const tu: PersistedTokenUsage = {
      cumulative: { input: 50, output: 4, total: 54 },
      items: [],
      terminalKind: "completed",
    };
    await s.put("sess", "a", makeTree());
    await s.put("sess", "b", makeTree(), tu);
    const m = await s.bulkGet("sess", ["a", "b", "missing"]);
    expect(m.size).toBe(2);
    expect(m.get("a")?.tree.steps).toHaveLength(1);
    expect(m.get("a")?.tokenUsage).toBeUndefined();
    expect(m.get("b")?.tokenUsage).toEqual(tu);
    expect(m.has("missing")).toBe(false);
  });

  test("Memory put 带 tokenUsage → get 读出（深拷贝隔离调用方修改）", async () => {
    const s = createMemoryReasoningStore();
    const tu: PersistedTokenUsage = {
      cumulative: { input: 1, output: 2, total: 3 },
      items: [],
      terminalKind: "completed",
    };
    await s.put("sess", "msg", makeTree(), tu);
    tu.cumulative.input = 999;
    const got = await s.get("sess", "msg");
    expect(got?.tokenUsage?.cumulative.input).toBe(1);
  });
});

describe("createIndexedDbReasoningStore (via fake-indexeddb)", () => {
  let factory: IDBFactory;
  beforeEach(() => {
    factory = new IDBFactory();
  });

  test("put → get round trip in fake IDB", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "test-db",
      indexedDBFactory: factory,
    });
    await s.put("sess", "msg", makeTree());
    const got = await s.get("sess", "msg");
    expect(got?.tree.steps).toHaveLength(1);
    expect(got?.tree.steps[0]?.text).toBe("plan-text");
    expect(got?.tokenUsage).toBeUndefined();
  });

  test("bulkGet across multiple keys", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "test-db-2",
      indexedDBFactory: factory,
    });
    await s.put("sess", "a", makeTree());
    await s.put("sess", "b", makeTree());
    const map = await s.bulkGet("sess", ["a", "b", "missing"]);
    expect(map.size).toBe(2);
  });

  test("get returns null when key absent", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "test-db-3",
      indexedDBFactory: factory,
    });
    expect(await s.get("sess", "missing")).toBeNull();
  });

  test("schema v1 行 { v: 1, tree } 可被 v2 reader 读出（向后兼容；tokenUsage=undefined）", async () => {
    // 直接用底层 IDB 写入 v1 形态行（模拟用户旧数据）
    await new Promise<void>((resolve, reject) => {
      const open = factory.open("test-db-legacy", 1);
      open.onupgradeneeded = (): void => {
        open.result.createObjectStore("reasoning");
      };
      open.onsuccess = (): void => {
        const db = open.result;
        const tx = db.transaction("reasoning", "readwrite");
        tx.objectStore("reasoning").put({ tree: makeTree(), v: 1 }, "sess::msg");
        tx.oncomplete = (): void => {
          db.close();
          resolve();
        };
        tx.onerror = (): void => reject(tx.error);
      };
      open.onerror = (): void => reject(open.error);
    });

    const s = createIndexedDbReasoningStore({
      dbName: "test-db-legacy",
      indexedDBFactory: factory,
    });
    const got = await s.get("sess", "msg");
    expect(got?.tree.steps).toHaveLength(1);
    expect(got?.tree.steps[0]?.text).toBe("plan-text");
    expect(got?.tokenUsage).toBeUndefined();
  });

  test("put 带 tokenUsage → get 读出 v2 行结构（含 tokenUsage）", async () => {
    const s = createIndexedDbReasoningStore({
      dbName: "test-db-v2",
      indexedDBFactory: factory,
    });
    const tu: PersistedTokenUsage = {
      cumulative: { input: 100, output: 8, total: 108 },
      items: [],
      terminalKind: "completed",
    };
    await s.put("sess", "msg", makeTree(), tu);
    const got = await s.get("sess", "msg");
    expect(got?.tree.steps).toHaveLength(1);
    expect(got?.tokenUsage).toEqual(tu);
  });
});
