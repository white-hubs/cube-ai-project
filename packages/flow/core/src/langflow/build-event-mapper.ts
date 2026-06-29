/**
 * Langflow build SSE payload shape (see langflow-api SKILL):
 * data: {"event":"<lfType>","data":{...}}
 */

export type CubeRunEventType =
  | "workflow_start"
  | "workflow_finished"
  | "token"
  | "message"
  | "message_delta"
  | "tool_call"
  | "thought"
  | "node_start"
  | "node_end"
  | "error"
  | "end";

export interface CubeRunEvent {
  type: CubeRunEventType;
  payload: Record<string, unknown>;
}

function mergeRequestExtIntoPayload(payload: Record<string, unknown>, mergeExt?: Record<string, unknown>): void {
  if (!mergeExt || Object.keys(mergeExt).length === 0) {
    return;
  }
  const cur =
    payload["ext"] && typeof payload["ext"] === "object" && !Array.isArray(payload["ext"])
      ? (payload["ext"] as Record<string, unknown>)
      : {};
  payload["ext"] = { ...cur, ...mergeExt };
}

function asRecord(x: unknown): Record<string, unknown> | null {
  if (x && typeof x === "object" && !Array.isArray(x)) {
    return x as Record<string, unknown>;
  }
  return null;
}

/** Pull a string field from nested Langflow payloads (varies by version). */
function extractTokenText(data: unknown): string | null {
  const o = asRecord(data);
  if (!o) {
    return null;
  }
  const chunk = o["chunk"];
  if (typeof chunk === "string") {
    return chunk;
  }
  const token = o["token"];
  if (typeof token === "string") {
    return token;
  }
  const text = o["text"];
  if (typeof text === "string") {
    return text;
  }
  const delta = asRecord(o["delta"]);
  if (delta && typeof delta["content"] === "string") {
    return delta["content"] as string;
  }
  const msg = asRecord(o["message"]);
  if (msg && typeof msg["text"] === "string") {
    return msg["text"] as string;
  }
  return null;
}

function extractMessagePayload(data: unknown): Record<string, unknown> {
  const o = asRecord(data);
  if (!o) {
    return { body: data };
  }
  if (typeof o["text"] === "string") {
    return { text: o["text"] };
  }
  if (typeof o["content"] === "string") {
    return { text: o["content"] };
  }
  return { body: data };
}

/** Playground 侧用户句已由客户端展示；转发 LF 的 User add_message 会覆盖 bot 的 acc。 */
function isLangflowUserAddMessage(inner: unknown): boolean {
  const o = asRecord(inner);
  if (!o) {
    return false;
  }
  const raw = o["sender"] ?? o["sender_name"];
  if (typeof raw !== "string" || raw.trim() === "") {
    return false;
  }
  return raw.trim().toLowerCase() === "user";
}

/** 显式非 User 的 Langflow 消息（用于补发 end，见 lf-sse-stream 侧 synthetic-end）。 */
export function isLangflowAssistantAddMessage(inner: unknown): boolean {
  const o = asRecord(inner);
  if (!o) {
    return false;
  }
  const raw = o["sender"] ?? o["sender_name"];
  if (typeof raw !== "string" || raw.trim() === "") {
    return false;
  }
  return raw.trim().toLowerCase() !== "user";
}

function extractErrorPayload(data: unknown): Record<string, unknown> {
  const o = asRecord(data);
  if (!o) {
    return { message: String(data) };
  }
  const msg = o["message"] ?? o["error"] ?? o["detail"];
  return typeof msg === "string" ? { message: msg } : { message: JSON.stringify(msg) };
}

function extractThoughtText(data: unknown): string | null {
  const o = asRecord(data);
  if (!o) {
    return null;
  }
  const r = o["reasoning_content"] ?? o["reasoning"] ?? o["thought"];
  if (typeof r === "string" && r.trim()) {
    return r;
  }
  const delta = asRecord(o["delta"]);
  if (delta && typeof delta["reasoning_content"] === "string") {
    return delta["reasoning_content"] as string;
  }
  return null;
}

/** Langflow vertices_sorted / 部分版本 build_data 中的节点 id 列表 */
function extractVertexIdsFromInner(inner: unknown): string[] {
  const o = asRecord(inner);
  if (!o) {
    return [];
  }
  const candidates = [o["vertices"], o["sorted_vertices"], o["vertices_ids"], asRecord(o["build_data"])?.["vertices"]];
  for (const c of candidates) {
    if (Array.isArray(c) && c.every((x) => typeof x === "string")) {
      return c as string[];
    }
    if (Array.isArray(c) && c.length > 0 && c.every((x) => x && typeof x === "object")) {
      return (c as Record<string, unknown>[])
        .map((x) => (typeof x["id"] === "string" ? (x["id"] as string) : String(x["id"] ?? "")))
        .filter((s) => s.length > 0);
    }
  }
  return [];
}

function extractEndVertexMeta(inner: unknown): { id?: string; detail: Record<string, unknown> } {
  const o = asRecord(inner) ?? {};
  const bd = asRecord(o["build_data"]);
  const idRaw = o["id"] ?? o["vertex_id"] ?? bd?.["id"] ?? asRecord(o["data"])?.["id"];
  const id = typeof idRaw === "string" ? idRaw : idRaw !== null && idRaw !== undefined ? String(idRaw) : undefined;
  return { detail: o, id };
}

function extractToolCallPayload(data: unknown): Record<string, unknown> {
  const o = asRecord(data);
  if (!o) {
    return { detail: data };
  }
  return {
    args: o["args"] ?? o["arguments"],
    id: o["id"] ?? o["tool_call_id"],
    name: o["name"] ?? o["tool_name"],
  };
}

/** 部分 LF 版本流里只有 end_vertex、从不发顶级 end，导致下游 SSE 无法关闭（见 debug session：token 后仅 ping）。 */
function isTerminalEndVertex(inner: unknown): boolean {
  const innerR = asRecord(inner);
  if (!innerR) {
    return false;
  }
  const bd = asRecord(innerR["build_data"]);
  if (!bd) {
    return false;
  }
  const next = bd["next_vertices_ids"];
  if (Array.isArray(next)) {
    return next.length === 0;
  }
  /** 部分版本省略该字段，表示无下游边（与空数组同义）。 */
  return next === undefined;
}

/**
 * Map one Langflow inner envelope `{ event, data }` to zero or one Cube events.
 * 空数组表示跳过（不转发）。
 */
export function mapLangflowBuildEnvelope(envelope: unknown): CubeRunEvent[] {
  const o = asRecord(envelope);
  if (!o) {
    return [];
  }
  const lfType = typeof o["event"] === "string" ? o["event"] : "";
  const inner = o["data"];

  switch (lfType) {
    case "chunk":
    case "token": {
      const text = extractTokenText(inner);
      if (text === null || text === "") {
        return [];
      }
      return [{ payload: { text }, type: "token" }];
    }
    case "add_message": {
      if (isLangflowUserAddMessage(inner)) {
        return [];
      }
      return [{ type: "message", payload: extractMessagePayload(inner) }];
    }
    case "end": {
      return [{ type: "end", payload: asRecord(inner) ?? {} }];
    }
    case "error": {
      return [{ type: "error", payload: extractErrorPayload(inner) }];
    }
    case "vertices_sorted": {
      const ids = extractVertexIdsFromInner(inner);
      if (ids.length > 0) {
        return [
          {
            payload: { detail: inner, phase: "sorted", vertices: ids },
            type: "node_start",
          },
        ];
      }
      return [
        {
          payload: { detail: inner, phase: "graph_ready" },
          type: "message_delta",
        },
      ];
    }
    case "end_vertex": {
      const { id, detail } = extractEndVertexMeta(inner);
      if (isTerminalEndVertex(inner)) {
        return [
          { payload: { detail, terminal: true, vertex_id: id }, type: "node_end" },
          { payload: {}, type: "end" },
        ];
      }
      return [{ payload: { detail, terminal: false, vertex_id: id }, type: "node_end" }];
    }
    case "ping": {
      return [];
    }
    default: {
      if (!lfType) {
        return [];
      }
      const t = lfType.toLowerCase();
      if (t.includes("reason") || t.includes("thought")) {
        const text = extractThoughtText(inner);
        if (text) {
          return [{ type: "thought", payload: { text } }];
        }
      }
      if (t.includes("tool") || t.includes("agent_action")) {
        return [{ payload: extractToolCallPayload(inner), type: "tool_call" }];
      }
      return [
        {
          payload: { detail: inner, phase: "update" },
          type: "message_delta",
        },
      ];
    }
  }
}

/** Encode one Cube event as SSE bytes；`mergeRequestExt` 并入 `payload.ext`（协议扩展性）。 */
export function encodeCubeSseEvent(ev: CubeRunEvent, mergeRequestExt?: Record<string, unknown>): Uint8Array {
  const encoder = new TextEncoder();
  const payload = { ...ev.payload };
  mergeRequestExtIntoPayload(payload, mergeRequestExt);
  const data = JSON.stringify(payload);
  const lines = [`event: ${ev.type}`, `data: ${data}`, "", ""];
  return encoder.encode(lines.join("\n"));
}
