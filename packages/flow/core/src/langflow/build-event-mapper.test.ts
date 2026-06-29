import { describe, expect, test } from "bun:test";

import { encodeCubeSseEvent, mapLangflowBuildEnvelope } from "./build-event-mapper";

describe("build-event-mapper", () => {
  test("skips ping keepalive", () => {
    expect(mapLangflowBuildEnvelope({ data: {}, event: "ping" })).toEqual([]);
  });

  test("maps token", () => {
    const evs = mapLangflowBuildEnvelope({ data: { chunk: "hi" }, event: "token" });
    expect(evs).toHaveLength(1);
    expect(evs[0]?.type).toBe("token");
    expect(evs[0]?.payload).toEqual({ text: "hi" });
  });

  test("maps add_message to message", () => {
    const evs = mapLangflowBuildEnvelope({
      data: { sender: "Machine", text: "done" },
      event: "add_message",
    });
    expect(evs[0]?.type).toBe("message");
    expect(evs[0]?.payload).toEqual({ text: "done" });
  });

  test("skips Langflow user add_message", () => {
    const evs = mapLangflowBuildEnvelope({
      data: { sender: "User", sender_name: "User", text: "hi" },
      event: "add_message",
    });
    expect(evs).toEqual([]);
  });

  test("maps end", () => {
    const evs = mapLangflowBuildEnvelope({ data: {}, event: "end" });
    expect(evs[0]?.type).toBe("end");
  });

  test("maps vertices_sorted to message_delta when no vertex ids", () => {
    const evs = mapLangflowBuildEnvelope({ data: { a: 1 }, event: "vertices_sorted" });
    expect(evs[0]?.type).toBe("message_delta");
    expect(evs[0]?.payload.phase).toBe("graph_ready");
  });

  test("maps vertices_sorted with id list to node_start", () => {
    const evs = mapLangflowBuildEnvelope({
      data: { vertices: ["a", "b"] },
      event: "vertices_sorted",
    });
    expect(evs[0]?.type).toBe("node_start");
    expect(evs[0]?.payload.vertices).toEqual(["a", "b"]);
  });

  test("maps terminal end_vertex to node_end then end", () => {
    const evs = mapLangflowBuildEnvelope({
      data: { build_data: { id: "n1", next_vertices_ids: [], valid: true } },
      event: "end_vertex",
    });
    expect(evs).toHaveLength(2);
    expect(evs[0]?.type).toBe("node_end");
    expect(evs[0]?.payload.terminal).toBe(true);
    expect(evs[1]?.type).toBe("end");
  });

  test("maps terminal end_vertex when next_vertices_ids omitted", () => {
    const evs = mapLangflowBuildEnvelope({
      data: { build_data: { id: "sink", valid: true } },
      event: "end_vertex",
    });
    expect(evs[1]?.type).toBe("end");
  });

  test("maps non-terminal end_vertex to node_end", () => {
    const evs = mapLangflowBuildEnvelope({
      data: { build_data: { id: "a", next_vertices_ids: ["b"] } },
      event: "end_vertex",
    });
    expect(evs).toHaveLength(1);
    expect(evs[0]?.type).toBe("node_end");
    expect(evs[0]?.payload.terminal).toBe(false);
  });

  test("encodeCubeSseEvent produces valid SSE frame", () => {
    const bytes = encodeCubeSseEvent({ payload: { text: "x" }, type: "token" });
    const s = new TextDecoder().decode(bytes);
    expect(s).toContain("event: token");
    expect(s).toContain('data: {"text":"x"}');
  });
});
