import type { Context } from "@dangao/bun-server";

import { MockRegistry } from "@cube-ai/ai-center/platform/server-mock";

import { createSseResponse } from "../../http/sse-response";
import { encodeCubeSseEvent } from "../../langflow/build-event-mapper";

function asRecord(x: unknown): Record<string, unknown> | null {
  if (x && typeof x === "object" && !Array.isArray(x)) {
    return x as Record<string, unknown>;
  }
  return null;
}

function webhookSse(flowId: string, query: string): Response {
  const taskId = crypto.randomUUID();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encodeCubeSseEvent({
          payload: { engine: "mock-webhook", flow_id: flowId, task_id: taskId },
          type: "workflow_start",
        }),
      );
      controller.enqueue(encodeCubeSseEvent({ payload: { text: `[mock-webhook] ${query.slice(0, 2000)}` }, type: "token" }));
      controller.enqueue(encodeCubeSseEvent({ payload: {}, type: "end" }));
      controller.close();
    },
  });
  return createSseResponse(stream);
}

MockRegistry.getInstance().define("webhook.receive", false, async (_ctx, args) => {
  const flowId = String(args[0] ?? "");
  const ctx = args[1] as Context | undefined;
  let input = "";
  if (ctx) {
    await ctx.getBody();
    try {
      const parsed = ctx.body ?? {};
      const o = asRecord(parsed) ?? {};
      input =
        typeof o["input"] === "string"
          ? o["input"]
          : typeof o["message"] === "string"
            ? o["message"]
            : typeof o["query"] === "string"
              ? o["query"]
              : "";
    } catch {
      /* ignore */
    }
  }
  return webhookSse(flowId, input);
});
