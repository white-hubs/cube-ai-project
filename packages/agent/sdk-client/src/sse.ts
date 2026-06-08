import { SseEventBaseSchema, type SseEventBase } from '@cube-ai/contracts';

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
export async function* parseSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SseEventBase, void, void> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let current: Partial<SseEventBase> = {};
  let data: string[] = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const raw = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (raw.length === 0) {
        if (data.length > 0) {
          try {
            const payload = JSON.parse(data.join('\n'));
            const envelope = { ...current, ...payload } as unknown;
            const parsed = SseEventBaseSchema.safeParse(envelope);
            if (parsed.success) yield parsed.data;
          } catch {
            /* malformed SSE payload — skip */
          }
        }
        current = {};
        data = [];
        continue;
      }
      if (raw.startsWith(':')) continue; // keep-alive
      const colonAt = raw.indexOf(':');
      if (colonAt === -1) continue;
      const field = raw.slice(0, colonAt).trim();
      const value = raw.slice(colonAt + 1).replace(/^ /, '');
      switch (field) {
        case 'id':
          (current as { id?: string }).id = value;
          break;
        case 'event':
          (current as { event?: string }).event = value;
          break;
        case 'data':
          data.push(value);
          break;
        default:
          // Ignore unknown SSE fields (retry, comment)
          break;
      }
    }
  }
}
