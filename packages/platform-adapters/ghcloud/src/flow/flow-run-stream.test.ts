import { describe, expect, it } from "bun:test";

import { GhcloudPlatformError } from "../errors";
import {
  aggregateFlowStreamEvents,
  buildRunStreamRequestBody,
  consumeFlowRunStreamResponse,
  isLegacyScheduledPayload,
  parseFlowStreamBody,
  remotePayloadToSyncResponse,
} from "./flow-run-stream";

describe("flow-run-stream", () => {
  it("rejects legacy scheduled envelope from /run JSON", () => {
    expect(() =>
      remotePayloadToSyncResponse({
        jobId: "1234567890123456789",
        scheduled: true,
        statusUrl: "/v1/jobs/1234567890123456789",
      }),
    ).toThrow(GhcloudPlatformError);
  });

  it("accepts direct sync flow outputs as result", () => {
    const out = remotePayloadToSyncResponse({
      ok: true,
      outputs: { imageUrl: "https://cdn.example/cat.png" },
    });
    expect(out.result.outputs).toEqual({ imageUrl: "https://cdn.example/cat.png" });
  });

  it("aggregates SSE chunks and picks terminal done outputs", () => {
    const events = parseFlowStreamBody(
      [
        'data: {"event":"progress","message":"warming up"}',
        "",
        'data: {"event":"done","outputs":{"imageUrl":"https://cdn.example/cat.png"}}',
        "",
      ].join("\n"),
      "text/event-stream",
    );
    expect(events).toHaveLength(2);
    const out = aggregateFlowStreamEvents(events);
    expect(out.result).toEqual({ imageUrl: "https://cdn.example/cat.png" });
    expect(out.executionTrace?.length).toBe(2);
  });

  it("buildRunStreamRequestBody maps prompt to input and keeps tweaks", () => {
    expect(buildRunStreamRequestBody({ prompt: "一只小猫", size: "512" })).toEqual({
      input: "一只小猫",
      inputType: "chat",
      outputType: "chat",
      tweaks: { prompt: "一只小猫", size: "512" },
    });
  });

  it("consumeFlowRunStreamResponse parses single JSON body", async () => {
    const resp = Response.json(
      { ok: true, outputs: { x: 1 } },
      {
        headers: { "content-type": "application/json" },
        status: 200,
      },
    );
    const out = await consumeFlowRunStreamResponse(resp, new AbortController().signal);
    expect(out.result.outputs).toEqual({ x: 1 });
  });

  it("isLegacyScheduledPayload detects async job envelope", () => {
    expect(
      isLegacyScheduledPayload({
        jobId: "1234567890123456789",
        scheduled: true,
        statusUrl: "/v1/jobs/1234567890123456789",
      }),
    ).toBe(true);
    expect(isLegacyScheduledPayload({ ok: true })).toBe(false);
  });
});
