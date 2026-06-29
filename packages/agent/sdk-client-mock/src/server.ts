import {
  type Job,
  JobSchema,
  type PublicToolDescriptor,
  PublicToolDescriptorSchema,
  type SseEvent,
  SseEventSchema,
} from "@cube-ai/contracts";

import { HEALTH_UP, type MockScenario, SCENARIOS } from "./scenarios";

export interface MockEngineOptions {
  /** Port; 0 = ephemeral (default). */
  port?: number;
  /** Active scenario name; defaults to 'health_up'. */
  scenarioName?: string;
  /** Scenario object (overrides scenarioName). */
  scenario?: MockScenario;
  /** Mock tenant id (injected into AuthContext). */
  mockTenant?: number;
}

export interface MockEngineHandle {
  readonly url: string;
  readonly port: number;
  stop(): Promise<void>;
  /** 向指定 session 下所有活跃 Turn 的 SSE 连接追加一条事件（测试钩子） */
  triggerEvent(sessionId: string, event: SseEvent): void;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** SFID 固定 19 位十进制（@cube-ai/contracts wire / ADR-0008 agent consumption face） */
let seqSfid = 1000000000000000000n;
function nextSfid(): string {
  seqSfid++;
  const s = seqSfid.toString();
  if (s.length !== 19) {
    throw new Error(`mock sfid length drift: ${s}`);
  }
  return s;
}

const MOCK_DESCRIPTORS: PublicToolDescriptor[] = [
  PublicToolDescriptorSchema.parse({
    consent: "NEVER",
    displayName: "Echo",
    enabled: true,
    id: "1000000000000000100",
    name: "platform.echo",
    summary: "Echo args",
  }),
];

/**
 * Minimal Bun-based mock engine（内存态；重启清空）.
 * Ref: docs/detailed-design/08-sdk/sdk-mock.md §5 / P3-15 §3.8
 */
export async function startMockEngine(options: MockEngineOptions = {}): Promise<MockEngineHandle> {
  const scenario = options.scenario ?? SCENARIOS[options.scenarioName ?? "health_up"] ?? HEALTH_UP;

  interface SessionRow {
    id: string;
    agentId: string;
    userId: string;
    title: string | null;
    status: string;
    createTime: number;
    updateTime: number;
  }

  const sessions = new Map<string, SessionRow>();
  interface ActiveStream {
    id: string;
    sessionId: string;
    turnIdFilter: string | null;
    controller: ReadableStreamDefaultController<string>;
    closed: boolean;
  }

  const activeStreams = new Map<string, ActiveStream>();
  const sessionStreamIds = new Map<string, Set<string>>();
  const eventHistory = new Map<string, { turnId: string; seq: number; event: SseEvent }[]>();
  /** sessionId → 当前尚未关闭的 turnId（单连接场景下通常 0–1 个） */
  const sessionTurnIds = new Map<string, Set<string>>();
  /** turnId → 下一条 SSE seq（triggerEvent 注入用） */
  const turnSeq = new Map<string, number>();
  const terminalTurns = new Set<string>();
  const jobs = new Map<string, Job>();

  const demoJob = JobSchema.parse({
    attempts: 0,
    createTime: Date.now(),
    endTime: null,
    error: null,
    id: "2000000000000000001",
    jobKind: "BUILTIN",
    progress: { message: "working", percent: 42 },
    queuedTime: Date.now(),
    resultSummary: null,
    sessionId: null,
    startTime: Date.now(),
    status: "RUNNING",
    toolCallId: null,
    toolName: "mock.tool",
    toolRef: null,
    turnId: null,
    updateTime: Date.now(),
  });
  jobs.set(demoJob.id, demoJob);

  function buildErrorResponse(status: number, code: string, message: string): Response {
    const traceId = randomHex(8);
    return Response.json(
      { code, details: { traceId }, message, status, timestamp: Date.now() },
      { headers: { "X-Trace-Id": traceId }, status },
    );
  }

  function buildVersionHeaders(): Record<string, string> {
    return {
      "X-Agentic-Contracts-Version": "1.0.0",
      "X-Agentic-Engine-Version": "mock-1.0.0",
    };
  }

  function sseChunk(turnId: string, seq: number, event: SseEvent): string {
    const id = `${turnId}:${String(seq).padStart(6, "0")}`;
    const evName = event.schema.replace(/-v\d+$/u, "").replaceAll(/-/gu, ".");
    return `id: ${id}\nevent: ${evName}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  function isTerminalTurnEvent(event: SseEvent): boolean {
    return event.schema === "turn-completed-v1" || event.schema === "turn-failed-v1" || event.schema === "turn-cancelled-v1";
  }

  function closeStream(stream: ActiveStream): void {
    if (stream.closed) {
      return;
    }
    stream.closed = true;
    try {
      stream.controller.close();
    } catch {
      /* already closed */
    }
    activeStreams.delete(stream.id);
    sessionStreamIds.get(stream.sessionId)?.delete(stream.id);
  }

  function streamMatches(stream: ActiveStream, sessionId: string, turnId: string): boolean {
    return stream.sessionId === sessionId && (stream.turnIdFilter === null || stream.turnIdFilter === turnId);
  }

  function appendEvent(sessionId: string, turnId: string, event: SseEvent): void {
    const seq = (turnSeq.get(turnId) ?? 0) + 1;
    turnSeq.set(turnId, seq);
    const rows = eventHistory.get(sessionId) ?? [];
    rows.push({ event, seq, turnId });
    eventHistory.set(sessionId, rows);

    const chunk = sseChunk(turnId, seq, event);
    for (const streamId of sessionStreamIds.get(sessionId) ?? []) {
      const stream = activeStreams.get(streamId);
      if (!stream || stream.closed || !streamMatches(stream, sessionId, turnId)) {
        continue;
      }
      try {
        stream.controller.enqueue(chunk);
      } catch {
        closeStream(stream);
      }
    }

    if (isTerminalTurnEvent(event)) {
      terminalTurns.add(turnId);
      sessionTurnIds.get(sessionId)?.delete(turnId);
      for (const streamId of sessionStreamIds.get(sessionId) ?? []) {
        const stream = activeStreams.get(streamId);
        if (stream?.turnIdFilter === turnId) {
          closeStream(stream);
        }
      }
    }
  }

  function normalizeScenarioEvent(event: SseEvent, turnId: string, assistantMessageId: string, userMessageId: string): SseEvent {
    const raw = { ...(event as unknown as Record<string, unknown>) };
    if ("turnId" in raw) {
      raw.turnId = turnId;
    }
    if ("messageId" in raw) {
      raw.messageId = assistantMessageId;
    }
    if ("finalMessageId" in raw) {
      raw.finalMessageId = assistantMessageId;
    }
    if ("userMessageId" in raw) {
      raw.userMessageId = userMessageId;
    }
    return SseEventSchema.parse(raw);
  }

  const server = Bun.serve({
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      const pathname = url.pathname;
      const traceId = request.headers.get("X-Request-Id") ?? randomHex(8);

      // Health
      if (pathname === "/health/live" || pathname === "/health/ready") {
        if (scenario.error) {
          return Response.json(
            { ...scenario.error, timestamp: Date.now() },
            { status: scenario.error.status, headers: buildVersionHeaders() },
          );
        }
        return Response.json({ status: "UP", timestamp: Date.now() }, { headers: buildVersionHeaders() });
      }

      // POST /sessions
      if (pathname === "/sessions" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) as {
          agentId?: string;
          title?: string;
        };
        const id = nextSfid();
        const now = Date.now();
        const row: SessionRow = {
          id,
          agentId: body.agentId ?? id,
          userId: "user_mock_001",
          title: body.title ?? null,
          status: "ACTIVE",
          createTime: now,
          updateTime: now,
        };
        sessions.set(id, row);
        return Response.json({ id, status: "ACTIVE", createTime: now }, { status: 201, headers: buildVersionHeaders() });
      }

      // GET /sessions（分页占位）
      if (pathname === "/sessions" && request.method === "GET") {
        const items = [...sessions.values()].map((r) => ({
          id: r.id,
          status: r.status,
          agentId: r.agentId,
          userId: r.userId,
          title: r.title,
          createTime: r.createTime,
          updateTime: r.updateTime,
        }));
        return Response.json({ items, page: { hasMore: false, nextCursor: null } }, { headers: buildVersionHeaders() });
      }

      // GET /sessions/:sessionId
      const getSess = pathname.match(/^\/sessions\/(\d{1,20})$/u);
      if (getSess && request.method === "GET") {
        const row = sessions.get(getSess[1]!);
        if (!row) {
          return buildErrorResponse(404, "RESOURCE_NOT_FOUND_SESSION", "Unknown session");
        }
        return Response.json(
          {
            id: row.id,
            status: row.status,
            agentId: row.agentId,
            userId: row.userId,
            title: row.title,
            createTime: row.createTime,
            updateTime: row.updateTime,
          },
          { headers: buildVersionHeaders() },
        );
      }

      // DELETE /sessions/:sessionId
      const delSess = pathname.match(/^\/sessions\/(\d{1,20})$/u);
      if (delSess && request.method === "DELETE") {
        const id = delSess[1]!;
        if (!sessions.has(id)) {
          return buildErrorResponse(404, "RESOURCE_NOT_FOUND_SESSION", "Unknown session");
        }
        sessions.delete(id);
        return new Response(null, { status: 204, headers: buildVersionHeaders() });
      }

      // GET /descriptors
      if (pathname === "/descriptors" && request.method === "GET") {
        return Response.json({ items: MOCK_DESCRIPTORS }, { headers: buildVersionHeaders() });
      }

      // GET /jobs/:jobId
      const jobGet = pathname.match(/^\/jobs\/(\d{1,20})$/u);
      if (jobGet && request.method === "GET") {
        const jid = jobGet[1]!;
        const job = jobs.get(jid);
        if (!job) {
          return buildErrorResponse(404, "RESOURCE_NOT_FOUND_JOB", "Unknown job");
        }
        return Response.json(job, { headers: buildVersionHeaders() });
      }

      // POST /jobs/:jobId:cancel
      const jobCancel = pathname.match(/^\/jobs\/(\d{1,20}):cancel$/u);
      if (jobCancel && request.method === "POST") {
        const jid = jobCancel[1]!;
        const cur = jobs.get(jid);
        if (!cur) {
          return buildErrorResponse(404, "RESOURCE_NOT_FOUND_JOB", "Unknown job");
        }
        const next = JobSchema.parse({
          ...cur,
          status: "CANCELLED",
          endTime: Date.now(),
          updateTime: Date.now(),
        });
        jobs.set(jid, next);
        return Response.json({ ok: true }, { headers: buildVersionHeaders() });
      }

      // POST /tools/:name/invoke
      const inv = pathname.match(/^\/tools\/([^/]+)\/invoke$/u);
      if (inv && request.method === "POST") {
        const args = await request.json().catch(() => ({}));
        return Response.json({ ok: true, tool: inv[1], args }, { headers: buildVersionHeaders() });
      }

      // GET /sessions/:sessionId/events[?turnId=...] → SSE stream
      const sseMatch = pathname.match(/^\/sessions\/(\d{1,20})\/events$/u);
      if (sseMatch && request.method === "GET") {
        const sessionId = sseMatch[1]!;
        if (!sessions.has(sessionId)) {
          return buildErrorResponse(404, "RESOURCE_NOT_FOUND_SESSION", "Unknown session");
        }

        const turnIdFilter = url.searchParams.get("turnId");

        let activeStreamId: string | undefined;
        const stream = new ReadableStream<string>({
          start(controller) {
            const streamId = nextSfid();
            activeStreamId = streamId;
            const active: ActiveStream = {
              id: streamId,
              sessionId,
              turnIdFilter: turnIdFilter && turnIdFilter.length > 0 ? turnIdFilter : null,
              controller,
              closed: false,
            };
            activeStreams.set(streamId, active);
            const ids = sessionStreamIds.get(sessionId) ?? new Set<string>();
            ids.add(streamId);
            sessionStreamIds.set(sessionId, ids);

            for (const row of eventHistory.get(sessionId) ?? []) {
              if (!streamMatches(active, sessionId, row.turnId)) {
                continue;
              }
              controller.enqueue(sseChunk(row.turnId, row.seq, row.event));
            }
            if (active.turnIdFilter && terminalTurns.has(active.turnIdFilter)) {
              closeStream(active);
            }
          },
          cancel() {
            const activeStream = activeStreamId ? activeStreams.get(activeStreamId) : undefined;
            if (activeStream) {
              closeStream(activeStream);
            }
          },
        });

        return new Response(stream as ReadableStream, {
          status: 200,
          headers: {
            ...buildVersionHeaders(),
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache",
            "X-Trace-Id": traceId,
          },
        });
      }

      // POST /sessions/:sessionId/messages → { turnId }
      const msgMatch = pathname.match(/^\/sessions\/(\d{1,20})\/messages$/u);
      if (msgMatch && request.method === "POST") {
        const sessionId = msgMatch[1]!;
        if (!sessions.has(sessionId)) {
          return buildErrorResponse(404, "RESOURCE_NOT_FOUND_SESSION", "Unknown session");
        }

        const turnId = nextSfid();
        const userMessageId = nextSfid();
        const assistantMessageId = nextSfid();

        if (!sessionTurnIds.has(sessionId)) {
          sessionTurnIds.set(sessionId, new Set());
        }
        sessionTurnIds.get(sessionId)!.add(turnId);
        turnSeq.set(turnId, 0);

        const events = scenario.stream ?? [];
        let i = 0;
        const sendNext = (): void => {
          if (i >= events.length) {
            return;
          }
          const event = normalizeScenarioEvent(events[i++]!, turnId, assistantMessageId, userMessageId);
          appendEvent(sessionId, turnId, event);
          setTimeout(sendNext, 10);
        };
        setTimeout(sendNext, 5);

        return Response.json({ turnId }, { headers: buildVersionHeaders() });
      }

      // POST /grants/responses
      if (pathname === "/grants/responses" && request.method === "POST") {
        return Response.json({ ok: true }, { headers: buildVersionHeaders() });
      }

      // POST /sessions/:id/turns/:tid/tool-acks
      const ackMatch = pathname.match(/^\/sessions\/(\d{1,20})\/turns\/(\d{1,20})\/tool-acks$/u);
      if (ackMatch && request.method === "POST") {
        return Response.json({ ok: true }, { headers: buildVersionHeaders() });
      }

      return buildErrorResponse(404, "RESOURCE_NOT_FOUND_ROUTE", `No mock handler for ${pathname}`);
    },
    port: options.port ?? 0,
  });

  const port = server.port ?? 0;
  const hostname = server.hostname ?? "127.0.0.1";

  return {
    port,
    async stop() {
      await server.stop();
    },
    triggerEvent(sessionId: string, event: SseEvent): void {
      const parsed = SseEventSchema.parse(event);
      const turns = sessionTurnIds.get(sessionId);
      if (!turns || turns.size === 0) {
        return;
      }
      for (const tid of turns) {
        appendEvent(sessionId, tid, parsed);
      }
    },
    url: `http://${hostname}:${port}`,
  };
}
