import { describe, expect, test } from "bun:test";

import { type SseEvent } from "@cube-ai/contracts";

import { SseClient } from "./sse-client";

/**
 * Unit tests for SseClient.
 * Ref: P1-09 design doc §7 / sdk-core.md §12.1 T6/T7
 */
describe("SseClient", () => {
  test("Last-Event-ID is sent on reconnect after receiving events", async () => {
    const receivedIds: string[] = [];
    let connectionCount = 0;

    const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      connectionCount++;
      const lastEventId = (init?.headers as Record<string, string>)?.["Last-Event-ID"];
      if (lastEventId) {
        receivedIds.push(lastEventId);
      }

      if (connectionCount === 1) {
        // First connection: send one event then close
        const stream = new ReadableStream<Uint8Array>({
          start(ctrl) {
            const enc = new TextEncoder();
            ctrl.enqueue(enc.encode('id: 1000000000000000001:000001\nevent: ping\ndata: {"schema":"ping-v1"}\n\n'));
            ctrl.close();
          },
        });
        return new Response(stream as ReadableStream, {
          headers: { "Content-Type": "text/event-stream" },
          status: 200,
        });
      }
      // Second connection: also close immediately
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          ctrl.close();
        },
      });
      return new Response(stream as ReadableStream, {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      });
    };

    const client = new SseClient(1, 10, mockFetch as typeof fetch);
    const events: SseEvent[] = [];

    await new Promise<void>((resolve) => {
      client.subscribe("http://mock/sse", {
        headers: {},
        method: "GET",
        onClose: resolve,
        onEvent: (e) => events.push(e),
      });
    });

    expect(connectionCount).toBeGreaterThanOrEqual(2);
    // The second connection MUST carry Last-Event-ID from the first connection's event
    expect(receivedIds.length).toBeGreaterThan(0);
    expect(receivedIds[0]).toBe("1000000000000000001:000001");
  });

  test("unknown schema event is skipped (soft fail) — no throw", async () => {
    const errors: Error[] = [];

    const mockFetch = async (_url: string, _init?: RequestInit): Promise<Response> => {
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          const enc = new TextEncoder();
          ctrl.enqueue(enc.encode('id: 1:000001\nevent: unknown\ndata: {"schema":"completely-unknown-v99","foo":"bar"}\n\n'));
          ctrl.close();
        },
      });
      return new Response(stream as ReadableStream, {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      });
    };

    const client = new SseClient(0, 10, mockFetch as typeof fetch);
    const events: SseEvent[] = [];

    await new Promise<void>((resolve) => {
      client.subscribe("http://mock/sse", {
        headers: {},
        method: "GET",
        onClose: resolve,
        onError: (e) => errors.push(e),
        onEvent: (e) => events.push(e),
      });
    });

    // Unknown event schema → skipped, no error thrown
    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  test("valid ping-v1 event is parsed and delivered", async () => {
    const mockFetch = async (_url: string, _init?: RequestInit): Promise<Response> => {
      const stream = new ReadableStream<Uint8Array>({
        start(ctrl) {
          const enc = new TextEncoder();
          ctrl.enqueue(enc.encode('id: 1:000001\nevent: ping\ndata: {"schema":"ping-v1"}\n\n'));
          ctrl.close();
        },
      });
      return new Response(stream as ReadableStream, {
        headers: { "Content-Type": "text/event-stream" },
        status: 200,
      });
    };

    const client = new SseClient(0, 10, mockFetch as typeof fetch);
    const events: SseEvent[] = [];

    await new Promise<void>((resolve) => {
      client.subscribe("http://mock/sse", {
        headers: {},
        method: "GET",
        onClose: resolve,
        onEvent: (e) => events.push(e),
      });
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.schema).toBe("ping-v1");
  });
});
