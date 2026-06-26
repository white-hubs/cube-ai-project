import "reflect-metadata";
import type { Context } from "@dangao/bun-server";
import { contextStore } from "@dangao/bun-server";
import { describe, test, expect, mock } from "bun:test";

import { SessionSseEmitter, InMemoryReplayBufferStore, DrainService } from "@cube-ai/bun-server-ext-sse";

import { SessionController } from "./session.controller";
import type { SessionService } from "./session.service";
import type { TurnService } from "./turn.service";

function baseCtx(
  extra: Partial<Context> & {
    getBody?: () => Promise<unknown>;
    getParam?: (k: string) => string | undefined;
    query?: URLSearchParams;
  } = {},
): Context & { setStatus: ReturnType<typeof mock> } {
  const setStatus = mock(() => {});
  return {
    setStatus,
    query: extra.query ?? new URLSearchParams(),
    params: {},
    state: {
      subject: {
        tenant: 42,
        user: {
          userId: "svc-user",
          tenant: 42,
          displayName: "Svc User",
          scopes: ["engine.use"],
          rawTokenSha256: "x",
          expiresAt: Date.now() + 3600_000,
        },
        traceId: "trace-1",
        terminal: "web",
      },
    },
    getBody: extra.getBody ?? mock(async () => ({})),
    getParam: extra.getParam ?? mock(() => undefined),
    ...extra,
  } as unknown as Context & { setStatus: ReturnType<typeof mock> };
}

describe("SessionController — REST wiring", () => {
  test("POST /sessions/:id/messages parses SDK content.blocks into prompt", async () => {
    const turnSvc = {
      startTurn: mock(async () => "1820345678901234999"),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
      getBody: mock(async () => ({
        content: {
          schema: "message-content-v1",
          blocks: [{ type: "text", text: "hello from sdk" }],
        },
      })),
    });

    const body = await contextStore.run(ctx as Context, async () => ctl.startTurn());

    expect(body).toEqual({ turnId: "1820345678901234999" });
    expect(turnSvc.startTurn).toHaveBeenCalledWith(
      "1820345678901234567",
      42,
      "hello from sdk",
      expect.objectContaining({
        content: {
          schema: "message-content-v1",
          blocks: [{ type: "text", text: "hello from sdk" }],
        },
        attachments: [],
        modelCode: undefined,
        skillEmbeddingModelCode: undefined,
        providerCode: undefined,
        providerId: undefined,
        userId: "svc-user",
        scopes: ["engine.use"],
      }),
    );
  });

  test("POST /sessions/:id/messages accepts image-only content with attachments", async () => {
    const turnSvc = {
      startTurn: mock(async () => "1820345678901234999"),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
      getBody: mock(async () => ({
        content: {
          schema: "message-content-v1",
          blocks: [{ type: "image_ref", attachmentId: "att_01" }],
        },
        attachments: [
          {
            attachmentId: "att_01",
            kind: "image",
            fileId: "file_01",
            mimeType: "image/png",
          },
        ],
      })),
    });

    const body = await contextStore.run(ctx as Context, async () => ctl.startTurn());

    expect(body).toEqual({ turnId: "1820345678901234999" });
    expect(turnSvc.startTurn).toHaveBeenCalledWith(
      "1820345678901234567",
      42,
      "请根据用户上传的图片内容回答。",
      expect.objectContaining({
        content: {
          schema: "message-content-v1",
          blocks: [
            { type: "text", text: "请根据用户上传的图片内容回答。" },
            { type: "image_ref", attachmentId: "att_01" },
          ],
        },
        attachments: [
          {
            attachmentId: "att_01",
            kind: "image",
            fileId: "file_01",
            mimeType: "image/png",
          },
        ],
      }),
    );
  });

  test("POST /sessions/:id/messages keeps legacy prompt compatibility", async () => {
    const turnSvc = {
      startTurn: mock(async () => "1820345678901234999"),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
      getBody: mock(async () => ({ prompt: "legacy prompt text" })),
    });

    const body = await contextStore.run(ctx as Context, async () => ctl.startTurn());

    expect(body).toEqual({ turnId: "1820345678901234999" });
    expect(turnSvc.startTurn).toHaveBeenCalledWith(
      "1820345678901234567",
      42,
      "legacy prompt text",
      expect.objectContaining({
        content: {
          schema: "message-content-v1",
          blocks: [{ type: "text", text: "legacy prompt text" }],
        },
        attachments: [],
        modelCode: undefined,
        skillEmbeddingModelCode: undefined,
        providerCode: undefined,
        providerId: undefined,
        userId: "svc-user",
        scopes: ["engine.use"],
      }),
    );
  });

  test("POST /sessions/:id/messages forwards modelCode to turn options", async () => {
    const turnSvc = {
      startTurn: mock(async () => "1820345678901234999"),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
      getBody: mock(async () => ({
        content: { schema: "message-content-v1", blocks: [{ type: "text", text: "model pick" }] },
        modelCode: "gpt-4.1",
      })),
    });

    const body = await contextStore.run(ctx as Context, async () => ctl.startTurn());

    expect(body).toEqual({ turnId: "1820345678901234999" });
    expect(turnSvc.startTurn).toHaveBeenCalledWith(
      "1820345678901234567",
      42,
      "model pick",
      expect.objectContaining({
        modelCode: "gpt-4.1",
        attachments: [],
        userId: "svc-user",
        scopes: ["engine.use"],
      }),
    );
  });

  test("POST /sessions/:id/messages forwards skillEmbeddingModelCode to turn options", async () => {
    const turnSvc = {
      startTurn: mock(async () => "1820345678901234999"),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
      getBody: mock(async () => ({
        prompt: "图表",
        skillEmbeddingModelCode: "text-embedding-3-large",
      })),
    });

    await contextStore.run(ctx as Context, async () => ctl.startTurn());

    expect(turnSvc.startTurn).toHaveBeenCalledWith(
      "1820345678901234567",
      42,
      "图表",
      expect.objectContaining({
        skillEmbeddingModelCode: "text-embedding-3-large",
        attachments: [],
        userId: "svc-user",
        scopes: ["engine.use"],
      }),
    );
  });

  test("POST /sessions/:id/messages forwards per-message runtimeRefs", async () => {
    const turnSvc = {
      startTurn: mock(async () => "1820345678901234999"),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const runtimeRefs = {
      knowledgeBases: [{ kbId: "kb-1", displayName: "产品知识库" }],
    };
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
      getBody: mock(async () => ({
        prompt: "查一下发布规范",
        runtimeRefs,
      })),
    });

    await contextStore.run(ctx as Context, async () => ctl.startTurn());

    expect(turnSvc.startTurn).toHaveBeenCalledWith(
      "1820345678901234567",
      42,
      "查一下发布规范",
      expect.objectContaining({
        attachments: [],
        modelCode: undefined,
        skillEmbeddingModelCode: undefined,
        providerCode: undefined,
        providerId: undefined,
        userId: "svc-user",
        scopes: ["engine.use"],
        runtimeRefs,
      }),
    );
  });

  test("POST /sessions/:id/messages rejects when both content and prompt are missing", async () => {
    const turnSvc = {
      startTurn: mock(async () => "1820345678901234999"),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
      getBody: mock(async () => ({ modelCode: "gpt-4o-mini" })),
    });

    await expect(contextStore.run(ctx as Context, async () => ctl.startTurn())).rejects.toMatchObject({
      code: "INVALID_ARGUMENT_SCHEMA_VIOLATION",
    });
    expect(turnSvc.startTurn).not.toHaveBeenCalled();
  });

  test("POST /sessions/:id/messages rejects unreferenced attachment", async () => {
    const turnSvc = {
      startTurn: mock(async () => "1820345678901234999"),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
      getBody: mock(async () => ({
        content: {
          schema: "message-content-v1",
          blocks: [{ type: "text", text: "hi" }],
        },
        attachments: [
          {
            attachmentId: "att_01",
            kind: "image",
            fileId: "file_01",
            mimeType: "image/png",
          },
        ],
      })),
    });

    await expect(contextStore.run(ctx as Context, async () => ctl.startTurn())).rejects.toMatchObject({
      code: "INVALID_ARGUMENT_SCHEMA_VIOLATION",
    });
    expect(turnSvc.startTurn).not.toHaveBeenCalled();
  });

  test("POST /sessions returns 201 + SFID id", async () => {
    const sessionSvc = {
      createSession: mock(async () => ({
        id: "1820345678901234567",
        userId: "svc-user",
        agentId: "1820345678901234001",
        agentVersionNo: 1,
        title: null,
        status: "ACTIVE" as const,
        lastTurnId: null,
        lastActivityTime: Date.now(),
        contextJson: null,
        createTime: Date.now(),
        updateTime: Date.now(),
      })),
    } as unknown as SessionService;

    const turnSvc = {
      startTurn: mock(async () => "1820345678901234999"),
    } as unknown as TurnService;

    const ctl = new SessionController(sessionSvc, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      getBody: mock(async () => ({ agentId: "1820345678901234001" })),
    });

    const body = await contextStore.run(ctx as Context, async () => ctl.create());

    expect((body as { id: string }).id).toBe("1820345678901234567");
    expect(ctx.setStatus).toHaveBeenCalledWith(201);
    expect(sessionSvc.createSession).toHaveBeenCalled();
  });

  test("POST /sessions rejects invalid context.systemSuffix type", async () => {
    const ctl = new SessionController({} as SessionService, {} as TurnService, {} as never, {} as never);
    const ctx = baseCtx({
      getBody: mock(async () => ({
        agentId: "1820345678901234001",
        context: { systemSuffix: 123 },
      })),
    });

    await expect(contextStore.run(ctx as Context, async () => ctl.create())).rejects.toMatchObject({
      code: "INVALID_ARGUMENT_SCHEMA_VIOLATION",
    });
  });

  test("GET /sessions/:id throws INVALID_ARGUMENT_SESSION_ID for bad id", async () => {
    const ctl = new SessionController({} as SessionService, {} as TurnService, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "bad" : undefined)),
    });

    await expect(contextStore.run(ctx as Context, async () => ctl.getById())).rejects.toMatchObject({
      code: "INVALID_ARGUMENT_SESSION_ID",
    });
  });

  test("GET /sessions/:id returns session view", async () => {
    const sessionSvc = {
      getSession: mock(async () => ({
        id: "1820345678901234567",
        userId: "svc-user",
        agentId: "1820345678901234001",
        agentVersionNo: 1,
        title: null,
        status: "ACTIVE" as const,
        lastTurnId: null,
        lastActivityTime: Date.now(),
        contextJson: null,
        createTime: Date.now(),
        updateTime: Date.now(),
      })),
    } as unknown as SessionService;

    const ctl = new SessionController(sessionSvc, {} as TurnService, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
    });

    const body = await contextStore.run(ctx as Context, async () => ctl.getById());
    expect((body as { id: string }).id).toBe("1820345678901234567");
    expect(sessionSvc.getSession).toHaveBeenCalledWith("1820345678901234567", 42, "svc-user", false);
  });

  test("GET /sessions/:id/messages delegates to SessionService.listSessionMessages", async () => {
    const sessionSvc = {
      listSessionMessages: mock(async () => ({
        items: [
          {
            id: "1820345678901234999",
            turnId: "1820345678901234888",
            sessionId: "1820345678901234567",
            seq: 0,
            role: "assistant",
            content: { schema: "message-content-v1", blocks: [{ type: "text", text: "hi" }] },
            createTime: 1,
          },
        ],
        page: { hasMore: false },
      })),
    } as unknown as SessionService;

    const ctl = new SessionController(sessionSvc, {} as TurnService, {} as never, {} as never);
    const ctx = baseCtx({
      path: "/sessions/1820345678901234567/messages",
      query: new URLSearchParams({ limit: "100" }),
    });

    const body = await contextStore.run(ctx as Context, async () => ctl.listMessages());

    expect(sessionSvc.listSessionMessages).toHaveBeenCalledWith({
      tenant: 42,
      sessionId: "1820345678901234567",
      userId: "svc-user",
      isAdmin: false,
      limit: 100,
    });
    expect((body as { items: unknown[] }).items).toHaveLength(1);
  });

  test("DELETE /sessions/:id returns 204", async () => {
    const sessionSvc = {
      deleteSession: mock(async () => {}),
    } as unknown as SessionService;

    const ctl = new SessionController(sessionSvc, {} as TurnService, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
    });

    await contextStore.run(ctx as Context, async () => ctl.remove());

    expect(sessionSvc.deleteSession).toHaveBeenCalledWith(42, "1820345678901234567", "svc-user");
    expect(ctx.setStatus).toHaveBeenCalledWith(204);
  });

  test("GET /sessions lists with pagination envelope", async () => {
    const sessionSvc = {
      listSessions: mock(async () => ({
        items: [],
        hasMore: false,
      })),
    } as unknown as SessionService;

    const ctl = new SessionController(sessionSvc, {} as TurnService, {} as never, {} as never);
    const ctx = baseCtx({
      query: new URLSearchParams({ limit: "20" }),
    });

    const result = await contextStore.run(ctx as Context, async () => ctl.listSessions());

    expect(result.page.hasMore).toBe(false);
    expect(Array.isArray(result.items)).toBe(true);
  });

  test("GET /sessions forwards engine.session.admin scope as admin read-through", async () => {
    const sessionSvc = {
      listSessions: mock(async () => ({
        items: [],
        hasMore: false,
      })),
    } as unknown as SessionService;

    const ctl = new SessionController(sessionSvc, {} as TurnService, {} as never, {} as never);
    const ctx = baseCtx({
      query: new URLSearchParams({ limit: "20" }),
      state: {
        subject: {
          tenant: 42,
          user: {
            userId: "admin-user",
            tenant: 42,
            displayName: "Admin User",
            scopes: ["engine.use", "engine.session.admin"],
            rawTokenSha256: "x",
            expiresAt: Date.now() + 3600_000,
          },
          traceId: "trace-1",
          terminal: "web",
        },
      },
    } as Partial<Context>);

    await contextStore.run(ctx as Context, async () => ctl.listSessions());

    expect(sessionSvc.listSessions).toHaveBeenCalledWith({
      tenant: 42,
      userId: "admin-user",
      isAdmin: true,
      cursor: undefined,
      limit: 20,
      statuses: undefined,
      purpose: "chat",
    });
  });

  test("PATCH error path — invalid SFID", async () => {
    const ctl = new SessionController({} as SessionService, {} as TurnService, {} as never, {} as never);
    const ctx = baseCtx({
      getParam: mock((k: string) => (k === "sessionId" ? "x" : undefined)),
      getBody: mock(async () => ({ status: "CLOSED" })),
    });

    await expect(contextStore.run(ctx as Context, async () => ctl.update())).rejects.toMatchObject({
      code: "INVALID_ARGUMENT_SESSION_ID",
    });
  });

  test("POST /sessions/:id/turns/:turnId/cancel dispatches USER_REQUEST and returns 204", async () => {
    const turnSvc = {
      cancelTurn: mock(async () => {}),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      path: "/sessions/1820345678901234567/turns/1820345678901234999/cancel",
      getParam: mock((k: string) => {
        if (k === "sessionId") return "1820345678901234567";
        if (k === "turnId") return "1820345678901234999";
        return undefined;
      }),
    });

    await contextStore.run(ctx as Context, async () => ctl.cancelTurn());

    expect(turnSvc.cancelTurn).toHaveBeenCalledWith("1820345678901234999", 42, "USER_REQUEST");
    expect(ctx.setStatus).toHaveBeenCalledWith(204);
  });

  test("POST /sessions/:id/turns/:turnId/cancel rejects invalid turnId SFID", async () => {
    const turnSvc = {
      cancelTurn: mock(async () => {}),
    } as unknown as TurnService;
    const ctl = new SessionController({} as SessionService, turnSvc, {} as never, {} as never);
    const ctx = baseCtx({
      path: "/sessions/1820345678901234567/turns/not-a-sfid/cancel",
      getParam: mock((k: string) => {
        if (k === "sessionId") return "1820345678901234567";
        if (k === "turnId") return "not-a-sfid";
        return undefined;
      }),
    });

    await expect(contextStore.run(ctx as Context, async () => ctl.cancelTurn())).rejects.toMatchObject({
      code: "INVALID_ARGUMENT_TURN_ID",
    });
    expect(turnSvc.cancelTurn).not.toHaveBeenCalled();
  });

  test("GET /sessions/:id/events?turnId={sfid} 透传 turnId 到 SSE 工厂；只回放本 turn (ADR-0022 §D5.1.v2)", async () => {
    const store = new InMemoryReplayBufferStore();
    const emitter = new SessionSseEmitter(store);
    const drain = new DrainService();
    const ctl = new SessionController({} as SessionService, {} as TurnService, emitter, drain);

    const T_TURN = "1820345678901234999";
    const OTHER_TURN = "1820345678901235000";
    const SCOPE = { tenant: 42, sessionId: "1820345678901234567" };
    await emitter.emit(SCOPE, T_TURN, {
      sseEvent: "turn.started",
      payload: { schema: "turn-started-v1", turnId: T_TURN },
    });
    await emitter.emit(SCOPE, OTHER_TURN, {
      sseEvent: "turn.started",
      payload: { schema: "turn-started-v1", turnId: OTHER_TURN },
    });

    const ac = new AbortController();
    const ctx = baseCtx({
      path: `/sessions/${SCOPE.sessionId}/events`,
      getParam: mock((k: string) => (k === "sessionId" ? SCOPE.sessionId : undefined)),
      headers: new Headers(),
      query: new URLSearchParams({ turnId: T_TURN }),
      signal: ac.signal,
    } as Partial<Context> & { signal: AbortSignal; headers: Headers });

    const res = await contextStore.run(ctx as Context, async () => ctl.streamEvents());
    expect(res.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 20));
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const { value } = await reader.read();
    const chunk = dec.decode(value ?? new Uint8Array());
    expect(chunk).toContain(`${T_TURN}:000001`);
    expect(chunk).not.toContain(`${OTHER_TURN}:000001`);
    reader.cancel();
    ac.abort();
  });

  test("GET /sessions/:id/events?turnId=bad-sfid 抛 INVALID_ARGUMENT_TURN_ID", async () => {
    const emitter = new SessionSseEmitter(new InMemoryReplayBufferStore());
    const drain = new DrainService();
    const ctl = new SessionController({} as SessionService, {} as TurnService, emitter, drain);

    const ctx = baseCtx({
      path: "/sessions/1820345678901234567/events",
      getParam: mock((k: string) => (k === "sessionId" ? "1820345678901234567" : undefined)),
      headers: new Headers(),
      query: new URLSearchParams({ turnId: "not-a-sfid" }),
    } as Partial<Context> & { headers: Headers });

    await expect(contextStore.run(ctx as Context, async () => ctl.streamEvents())).rejects.toMatchObject({
      code: "INVALID_ARGUMENT_TURN_ID",
    });
  });
});
