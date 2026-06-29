/**
 * Flow client smoke — ai-sdk-playground wires `@cube-ai/flow-sdk-client` to `/flow/run/:id`.
 */
import { describe, expect, test } from "bun:test";

import { createFlowClient } from "@cube-ai/flow-sdk-client";

import { sdkConfig } from "../config";

describe("ai-sdk-playground flow client smoke", () => {
  test("createFlowClient.run() POST /flow/run/:flowId", async () => {
    let capturedUrl = "";
    const cfg = sdkConfig();
    const client = createFlowClient({
      baseUrl: cfg.baseUrl,
      fetchImpl: (async (url, init) => {
        capturedUrl = typeof url === "string" ? url : url.toString();
        expect(init?.method).toBe("POST");
        return Response.json({ status: "ok", raw: { mock: true } });
      }) as typeof fetch,
      headers: cfg.headers,
    });

    const result = await client.run("flow-loop4", { input: "hello" });
    expect(capturedUrl).toBe(`${cfg.baseUrl}/flow/run/flow-loop4`);
    expect(result).toEqual({ raw: { mock: true }, status: "ok" });
  });
});
