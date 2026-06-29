/**
 * 在 Langflow 映射后的 Cube SSE 外侧包装 workflow 生命周期与 usage（协议 v2）。
 */

import { encodeCubeSseEvent } from "../langflow/build-event-mapper";
import { recordFlowExecutionFromSse } from "../observability/execution-metrics";

function parseSseBlock(block: string): { event: string; data: unknown } | null {
  let eventName = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/u)) {
    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const joined = dataLines.join("\n");
  try {
    return { data: JSON.parse(joined) as unknown, event: eventName };
  } catch {
    return null;
  }
}

function takeNextCubeFrame(buf: string): { block: string; rest: string } | null {
  const iLf = buf.indexOf("\n\n");
  const iCrLf = buf.indexOf("\r\n\r\n");
  if (iLf === -1 && iCrLf === -1) {
    return null;
  }
  const useCrLf = iCrLf !== -1 && (iLf === -1 || iCrLf < iLf);
  if (useCrLf) {
    return { block: buf.slice(0, iCrLf), rest: buf.slice(iCrLf + 4) };
  }
  return { block: buf.slice(0, iLf), rest: buf.slice(iLf + 2) };
}

export interface WorkflowStartPayload {
  task_id: string;
  trace_id?: string;
  flow_id: string;
  flow_version?: string;
  ext?: Record<string, unknown>;
}

/** 在流首注入 `workflow_start`（单帧）。 */
export function prependWorkflowStart(
  stream: ReadableStream<Uint8Array>,
  payload: WorkflowStartPayload,
  mergeRequestExt?: Record<string, unknown>,
): ReadableStream<Uint8Array> {
  const head = encodeCubeSseEvent({ payload: payload as unknown as Record<string, unknown>, type: "workflow_start" }, mergeRequestExt);
  const reader = stream.getReader();
  return new ReadableStream({
    cancel() {
      void reader.cancel();
    },
    async start(controller) {
      controller.enqueue(head);
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          controller.enqueue(value);
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}

export interface UsageEnrichContext {
  task_id: string;
  startedAtMs: number;
  trace_id?: string;
  flow_id: string;
  /** 并入 workflow_finished / end 等帧 */
  mergeRequestExt?: Record<string, unknown>;
}

/** 解析下游 SSE，在 `end` 前插入 `workflow_finished`，并将 `end` 载荷合并 usage。 */
export function transformStreamEnrichUsage(stream: ReadableStream<Uint8Array>, ctx: UsageEnrichContext): ReadableStream<Uint8Array> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sentFinished = false;
  let sawErrorEvent = false;
  let metricRecorded = false;
  let firstTokenAtMs: number | undefined;
  let approxOutputChars = 0;

  function recordMetricOnce(): void {
    if (metricRecorded) {
      return;
    }
    metricRecorded = true;
    recordFlowExecutionFromSse({
      approxOutputChars,
      flowId: ctx.flow_id,
      hadError: sawErrorEvent,
      startedAtMs: ctx.startedAtMs,
      taskId: ctx.task_id,
      ttftMs: firstTokenAtMs !== null && firstTokenAtMs !== undefined ? Math.max(0, firstTokenAtMs - ctx.startedAtMs) : undefined,
    });
  }

  function usagePayload(extra: Record<string, unknown>): Record<string, unknown> {
    const latency_ms = Math.max(0, Date.now() - ctx.startedAtMs);
    const usage: Record<string, unknown> = {
      latency_ms,
      total_tokens:
        typeof extra["total_tokens"] === "number"
          ? extra["total_tokens"]
          : typeof extra["total_tokens"] === "string"
            ? Number(extra["total_tokens"])
            : undefined,
    };
    if (usage["total_tokens"] === undefined || Number.isNaN(usage["total_tokens"])) {
      delete usage["total_tokens"];
    }
    return {
      ext: typeof extra["ext"] === "object" && extra["ext"] && !Array.isArray(extra["ext"]) ? extra["ext"] : undefined,
      flow_id: ctx.flow_id,
      task_id: ctx.task_id,
      trace_id: ctx.trace_id,
      usage,
    };
  }

  function enqueueWorkflowFinished(
    controller: ReadableStreamDefaultController<Uint8Array>,
    enrichCtx: UsageEnrichContext,
    data: Record<string, unknown>,
    sent: boolean,
  ): boolean {
    if (sent) {
      return true;
    }
    controller.enqueue(encodeCubeSseEvent({ type: "workflow_finished", payload: usagePayload(data) }, enrichCtx.mergeRequestExt));
    return true;
  }

  function buildEndPayload(data: Record<string, unknown>, enrichCtx: UsageEnrichContext, firstTokenMs: number | null | undefined) {
    const usageData =
      typeof data["usage"] === "object" && data["usage"] && !Array.isArray(data["usage"]) ? (data["usage"] as Record<string, unknown>) : {};
    const latency_ms = Math.max(0, Date.now() - enrichCtx.startedAtMs);
    return {
      ...data,
      task_id: enrichCtx.task_id,
      trace_id: enrichCtx.trace_id,
      usage: {
        ...usageData,
        latency_ms,
        time_to_first_token_ms:
          firstTokenMs !== null && firstTokenMs !== undefined ? Math.max(0, firstTokenMs - enrichCtx.startedAtMs) : undefined,
        total_tokens:
          (typeof data["total_tokens"] === "number" ? data["total_tokens"] : undefined) ??
          (typeof usageData["total_tokens"] === "number" ? usageData["total_tokens"] : undefined),
      },
    };
  }

  function asRecord(data: unknown): Record<string, unknown> {
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  }

  function tokenTextFromData(data: unknown): string | undefined {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return undefined;
    }
    const text = (data as Record<string, unknown>)["text"];
    return typeof text === "string" ? text : undefined;
  }

  return new ReadableStream({
    cancel() {
      void reader.cancel();
    },
    async start(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          for (;;) {
            const next = takeNextCubeFrame(buffer);
            if (!next) {
              break;
            }
            buffer = next.rest;
            const parsed = parseSseBlock(next.block);
            if (!parsed) {
              continue;
            }
            if (parsed.event === "end") {
              const data = asRecord(parsed.data);
              sentFinished = enqueueWorkflowFinished(controller, ctx, data, sentFinished);
              controller.enqueue(
                encodeCubeSseEvent({ type: "end", payload: buildEndPayload(data, ctx, firstTokenAtMs) }, ctx.mergeRequestExt),
              );
              recordMetricOnce();
              continue;
            }
            if (parsed.event === "error") {
              sawErrorEvent = true;
            }
            if (parsed.event === "token" && firstTokenAtMs === undefined) {
              firstTokenAtMs = Date.now();
            }
            const tokenText = parsed.event === "token" ? tokenTextFromData(parsed.data) : undefined;
            if (tokenText !== undefined) {
              approxOutputChars += tokenText.length;
            }
            controller.enqueue(new TextEncoder().encode(`${next.block}\n\n`));
          }
        }
        if (buffer.trim()) {
          const tailBlock = buffer.trimEnd();
          const parsed = parseSseBlock(tailBlock);
          if (parsed?.event === "end") {
            const data = asRecord(parsed.data);
            sentFinished = enqueueWorkflowFinished(controller, ctx, data, sentFinished);
            controller.enqueue(
              encodeCubeSseEvent(
                {
                  type: "end",
                  payload: buildEndPayload(data, ctx, firstTokenAtMs),
                },
                ctx.mergeRequestExt,
              ),
            );
            recordMetricOnce();
          } else if (tailBlock.length > 0) {
            controller.enqueue(new TextEncoder().encode(`${tailBlock}\n\n`));
          }
        }
        if (!sentFinished) {
          sentFinished = true;
          controller.enqueue(
            encodeCubeSseEvent(
              {
                type: "workflow_finished",
                payload: usagePayload({}),
              },
              ctx.mergeRequestExt,
            ),
          );
          controller.enqueue(
            encodeCubeSseEvent(
              {
                type: "end",
                payload: {
                  task_id: ctx.task_id,
                  trace_id: ctx.trace_id,
                  usage: {
                    latency_ms: Math.max(0, Date.now() - ctx.startedAtMs),
                    time_to_first_token_ms:
                      firstTokenAtMs !== null && firstTokenAtMs !== undefined ? Math.max(0, firstTokenAtMs - ctx.startedAtMs) : undefined,
                  },
                },
              },
              ctx.mergeRequestExt,
            ),
          );
          recordMetricOnce();
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });
}
