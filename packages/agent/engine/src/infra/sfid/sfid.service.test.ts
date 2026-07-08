import { describe, expect, test } from "bun:test";

import { SfidService } from "./sfid.service";

// ref: docs/technical-design/phase-1/P1-01-foundations.md §7
// Fix A (串消息根因): nodeId 不再静默默认 0 —— 未配置即 fail-closed。

/**
 * 构造一个「未配置」实例：测试进程 preload 设了 AGENTIC_ENGINE_NODE_ID（让全仓
 * 各 `new SfidService()` 可用），这里临时清掉该 env 以验证 fail-closed 分支。
 */
function unconfiguredService(): SfidService {
  const prev = process.env.AGENTIC_ENGINE_NODE_ID;
  delete process.env.AGENTIC_ENGINE_NODE_ID;
  try {
    return new SfidService();
  } finally {
    if (prev !== undefined) process.env.AGENTIC_ENGINE_NODE_ID = prev;
  }
}

describe("SfidService — generation (configured node)", () => {
  test("generates exactly 19-digit decimal string", () => {
    const service = new SfidService(0);
    expect(service.next()).toMatch(/^\d{19}$/);
  });

  test("1000 consecutive IDs are monotonically increasing (time-sorted)", () => {
    const service = new SfidService(0);
    const ids = Array.from({ length: 1000 }, () => service.next());
    const sorted = ids.toSorted((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
    expect(ids).toEqual(sorted);
  });

  test("1000 IDs generated synchronously are all unique", () => {
    const service = new SfidService(0);
    const ids = Array.from({ length: 1000 }, () => service.next());
    expect(new Set(ids).size).toBe(1000);
  });

  test("parse() round-trips the timestamp field", () => {
    const service = new SfidService(0);
    const before = BigInt(Date.now());
    const id = service.next();
    const after = BigInt(Date.now());
    const { timestamp } = service.parse(id);
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after + 2n);
  });

  test("parse() extracts the configured node id", () => {
    const service = new SfidService(7);
    const { node } = service.parse(service.next());
    expect(node).toBe(7);
  });

  test("IDs generated across two configured instances are still time-ordered", () => {
    const a = new SfidService(0);
    const b = new SfidService(0);
    expect(BigInt(a.next()) <= BigInt(b.next())).toBe(true);
  });
});

describe("SfidService — fail-closed when node not configured", () => {
  test("next() throws when constructed without a node id", () => {
    const service = unconfiguredService();
    expect(service.isConfigured).toBe(false);
    expect(() => service.next()).toThrow(/not configured/i);
  });

  test("configureNode() enables generation and is reflected by parse()", () => {
    const service = unconfiguredService();
    service.configureNode(5);
    expect(service.isConfigured).toBe(true);
    const { node } = service.parse(service.next());
    expect(node).toBe(5);
  });

  test("configureNode() is idempotent for the same node id", () => {
    const service = unconfiguredService();
    service.configureNode(3);
    expect(() => service.configureNode(3)).not.toThrow();
    expect(service.parse(service.next()).node).toBe(3);
  });

  test("configureNode() refuses to reassign a different node id (single-assignment integrity)", () => {
    const service = new SfidService(1);
    expect(() => service.configureNode(2)).toThrow(/already configured/i);
  });
});
