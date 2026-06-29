import { type SseEventBase, SseEventBaseSchema } from "@cube-ai/contracts";

/**
 * Line-based SSE parser yielding validated envelopes.
 *
 * Scope (skeleton):
 * - Handles `id:`, `event:`, `data:` lines (regulation §SSE).
 * - Treats `:` comment lines as heartbeats (dropped).
 * - Validates each completed event against `SseEventBaseSchema`.
 *
 * Caller supplies a `ReadableStreamDefaultReader<Uint8Array>`; Phase 3
 * adds Last-Event-ID replay, reconnect policy, and abort propagation.
 */
export async function* parseSse(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<SseEventBase, void, void> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let current: Partial<SseEventBase> = {};
  let data: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const raw = buffer.slice(0, idx).replace(/\r$/u, "");
      buffer = buffer.slice(idx + 1);
      if (raw.length === 0) {
        const parsed = parseCurrentSseEvent(current, data);
        if (parsed) {
          yield parsed;
        }
        current = {};
        data = [];
        continue;
      }
      if (raw.startsWith(":")) {
        continue;
      } // keep-alive
      const colonAt = raw.indexOf(":");
      if (colonAt === -1) {
        continue;
      }
      const field = raw.slice(0, colonAt).trim();
      const fieldValue = raw.slice(colonAt + 1).replace(/^ /u, "");
      switch (field) {
        case "id": {
          (current as { id?: string }).id = fieldValue;
          break;
        }
        case "event": {
          (current as { event?: string }).event = fieldValue;
          break;
        }
        case "data": {
          data.push(fieldValue);
          break;
        }
        default: {
          // Ignore unknown SSE fields (retry, comment)
          break;
        }
      }
    }
  }
}

function parseCurrentSseEvent(current: Partial<SseEventBase>, data: readonly string[]): SseEventBase | undefined {
  if (data.length === 0) {
    return undefined;
  }
  try {
    const payload = JSON.parse(data.join("\n"));
    const envelope = { ...current, ...payload } as unknown;
    const parsed = SseEventBaseSchema.safeParse(envelope);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
