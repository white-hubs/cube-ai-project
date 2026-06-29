import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, describe, expect, test } from "bun:test";

import { type AssistantEnginePort } from "@cube-ai/agent-sdk-client-assistant";

/**
 * Agent core flow — provideAssistant + session + SSE turn.completed (ADR-0008 addendum).
 * Uses in-process stub port (no browser fetch); production path is engine `/v1/*`.
 */

const registeredHappyDom = globalThis.document === undefined;
if (registeredHappyDom) {
  GlobalRegistrator.register();
}

const { defineComponent, h, createApp, nextTick } = await import("vue");
const { provideAssistant, useAssistantSessions, useAssistantMessages } = await import("@cube-ai/agent-sdk-client-vue");

afterAll(async () => {
  if (registeredHappyDom) {
    await GlobalRegistrator.unregister();
  }
});

function makeTurnCompletedPort(): AssistantEnginePort {
  const turnId = "1000000000000000001";
  return {
    cancelTurn: async () => {},
    createSession: async (req) => ({
      id: "1000000000000000003",
      title: req.title ?? "",
      createTime: Date.now(),
    }),
    deleteSession: async () => {},
    getSession: async () => null,
    listMessages: async () => ({ items: [] }),
    listSessions: async () => ({
      items: [{ id: "1000000000000000003", title: "loop4", updatedAt: Date.now() }],
      hasMore: false,
    }),
    patchSession: async () => {},
    respondGrant: async () => {},
    startTurn: async () => ({ turnId }),
    streamEvents: async function* (): AsyncIterable<{
      event: string;
      data: Record<string, unknown>;
    }> {
      yield { event: "turn-completed-v1", data: { turnId, finalMessageId: "1000000000000000002" } };
    },
  };
}

describe("ai-sdk-playground agent core flow", () => {
  test("provideAssistant → createSession → send → turn-completed-v1", async () => {
    const port = makeTurnCompletedPort();

    let sessionsApi: ReturnType<typeof useAssistantSessions> | undefined;
    let messagesApi: ReturnType<typeof useAssistantMessages> | undefined;

    const Root = defineComponent({
      setup() {
        provideAssistant({ defaultAgentId: "8300000000000000001", engine: port });
        sessionsApi = useAssistantSessions();
        messagesApi = useAssistantMessages();
        return () => h("span");
      },
    });

    const app = createApp(Root);
    const host = document.createElement("div");
    document.body.append(host);
    app.mount(host);
    await nextTick();

    const sessionId = await sessionsApi!.create({ title: "loop4-core" });
    await nextTick();
    expect(sessionId).toBe("1000000000000000003");

    await messagesApi!.send("hello loop4");
    await nextTick();

    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      await nextTick();
      if (messagesApi!.lastTurnStatus.value === "completed") {
        break;
      }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(messagesApi!.lastTurnStatus.value).toBe("completed");
    expect(messagesApi!.sending.value).toBe(false);
  });
});
