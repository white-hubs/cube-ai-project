import { type DrainService, type SseConnection } from "./drain.service";
import { type SessionSseEmitter } from "./sse-emitter";
import { type ReplayBufferEntry, type ReplayBufferScope } from "./types";

/** Align `packages/contracts/src/sse/events.ts` — `eventId = "{turnId}:{seq6}"`. */
const LAST_EVENT_ID_RE = /^\d{1,20}:\d{6}$/u;

/**
 * Parse `Last-Event-ID` / `last-event-id` (RFC 6202) to id string or null.
 * ref: concurrency-and-replay.md §3.1
 */
export function parseLastEventIdHeader(header: string | undefined | null): string | null {
  if (!header?.trim()) {
    return null;
  }
  const trimmed = header.trim();
  return LAST_EVENT_ID_RE.test(trimmed) ? trimmed : null;
}

/**
 * Turn-terminal SSE schemas. When a per-turn stream (`?turnId=`) observes one
 * of these, the server closes the connection so the HTTP request completes
 * with a normal EOF — mirrors `turn.service` terminal emit + `sdk-mock`
 * close-on-terminal. ref: ADR-0022 §D5.1.v2.
 */
const TERMINAL_TURN_SCHEMAS = new Set(["turn-completed-v1", "turn-failed-v1", "turn-cancelled-v1"]);

function isTerminalTurnSchema(schema: string): boolean {
  return TERMINAL_TURN_SCHEMAS.has(schema);
}

/** Format one SSE record (no trailing extra newline — caller concatenates). */
export function formatSseRecord(entry: ReplayBufferEntry): string {
  const dataObj =
    typeof entry.payload === "object" && entry.payload !== null ? (entry.payload as Record<string, unknown>) : { value: entry.payload };
  const body = JSON.stringify({
    ...dataObj,
    schema: entry.schema,
  });
  const lines = [`id: ${entry.eventId}`, `event: ${entry.event}`, `data: ${body}`, ""];
  return `${lines.join("\n")}\n`;
}

export interface SessionSseStreamParams {
  scope: ReplayBufferScope;
  lastEventId: string | null;
  emitter: SessionSseEmitter;
  drainService: DrainService;
  signal: AbortSignal;
  /**
   * Per-turn SSE filter (ADR-0022 §D5.1.v2). When set, both replay-on-connect
   * and live fan-out drop events whose `eventId` prefix ≠ `${turnId}:`.
   * Format requires `eventId === '{turnId}:{seq6}'` (regulation §5.2).
   */
  turnId?: string;
}

/**
 * Establish `/v1/sessions/:sessionId/events` SSE `Response`: replay then live fan-out.
 * ref: P3-06 §3.1, session.md §15
 */
export function createSessionSseStreamResponse(p: SessionSseStreamParams): Response {
  if (!drainServiceAcceptsNewStreams(p.drainService)) {
    return Response.json(
      {
        code: "UNAVAILABLE_SERVICE_DRAINING",
        message: "Server is draining; reconnect with Last-Event-ID shortly",
      },
      { headers: { "Content-Type": "application/json" }, status: 503 },
    );
  }

  let unsubscribe: (() => void) | undefined;
  let unregisterDrain: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      unsubscribe?.();
      unregisterDrain?.();
    },
    start(controller) {
      const enc = new TextEncoder();
      const push = (s: string) => controller.enqueue(enc.encode(s));

      const onAbort = () => {
        try {
          unsubscribe?.();
          unregisterDrain?.();
          controller.close();
        } catch {
          /* noop */
        }
      };
      p.signal.addEventListener("abort", onAbort, { once: true });

      let terminated = false;
      const closeOnTerminal = (): void => {
        if (terminated) {
          return;
        }
        terminated = true;
        try {
          unsubscribe?.();
          unregisterDrain?.();
          controller.close();
        } catch {
          /* noop — already closed */
        }
      };

      void (async () => {
        try {
          const turnIdFilter = p.turnId !== undefined && p.turnId !== "" ? `${p.turnId}:` : null;
          const replayed = await p.emitter.replayStore.since(p.scope, p.lastEventId, p.turnId);
          let replayHitTerminal = false;
          for (const e of replayed) {
            push(formatSseRecord(e));
            if (turnIdFilter !== null && isTerminalTurnSchema(e.schema)) {
              replayHitTerminal = true;
            }
          }

          // per-turn 流回放已抵达终态（重连 / turn 早已完成）→ 直接收尾，
          // 不再 live 订阅，让 HTTP 请求以正常 EOF 结束（DevTools 可保留 Response）。
          if (replayHitTerminal) {
            closeOnTerminal();
            return;
          }

          unsubscribe = p.emitter.subscribe(p.scope, (e) => {
            if (turnIdFilter !== null && !e.eventId.startsWith(turnIdFilter)) {
              return; // 非本 turn 的 live 事件丢弃（per-turn SSE）
            }
            push(formatSseRecord(e));
            // per-turn 流收到本 turn 终态事件 → 服务端主动 close（对偶 sdk-core break）。
            if (turnIdFilter !== null && isTerminalTurnSchema(e.schema)) {
              closeOnTerminal();
            }
          });

          const conn: SseConnection = {
            writeEvent(ev: string, data: unknown, id?: string): void {
              push(`event: ${ev}\ndata: ${JSON.stringify(data)}\nid: ${id ?? ""}\n\n`);
            },
            close(): void {
              controller.close();
            },
          };
          unregisterDrain = p.drainService.registerStream(conn);
        } catch (err) {
          controller.error(err instanceof Error ? err : new Error(String(err)));
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}

function drainServiceAcceptsNewStreams(ds: DrainService): boolean {
  return ds.isAcceptingNewStreams();
}
