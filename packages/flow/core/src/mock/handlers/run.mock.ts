import { MockRegistry } from "@cube-ai/ai-center/platform/server-mock";

import { normalizeRunBody } from "../../contracts/cube-run";
import { createSseResponse } from "../../http/sse-response";
import { encodeCubeSseEvent } from "../../langflow/build-event-mapper";

function sseForFlow(flowId: string, query: string): Response {
  const taskId = crypto.randomUUID();
  const traceId = taskId;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encodeCubeSseEvent({
          payload: { engine: "mock", flow_id: flowId, task_id: taskId, trace_id: traceId },
          type: "workflow_start",
        }),
      );
      controller.enqueue(encodeCubeSseEvent({ payload: { text: `[mock-run] ${query.slice(0, 2000)}` }, type: "token" }));
      controller.enqueue(encodeCubeSseEvent({ payload: {}, type: "end" }));
      controller.close();
    },
  });
  return createSseResponse(stream);
}

MockRegistry.getInstance().define("run.invoke", false, (_ctx, args) => {
  const flowId = String(args[0] ?? "");
  const body = args[1];
  const norm = normalizeRunBody(body);
  if (norm.stream !== false) {
    return sseForFlow(flowId, norm.input ?? "");
  }
  const taskId = crypto.randomUUID();
  return {
    raw: { message: norm.input?.slice(0, 500) ?? "", mock: true },
    status: "ok" as const,
    task_id: taskId,
    trace_id: taskId,
  };
});
