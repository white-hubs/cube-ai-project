import { describe, expect, test } from "bun:test";

import type { FlowService } from "@cube-ai/flow-studio";

import { createStudioFlowGrpcBackend } from "./studio-flow-grpc-backend";

describe("createStudioFlowGrpcBackend", () => {
  test("uploadFlowFile delegates using the studio flow id received from gRPC", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "test.png", { type: "image/png" });
    const calls: { flowId: string; file: File }[] = [];
    const studio = {
      async uploadFlowFile(flowId: string, uploaded: File) {
        calls.push({ file: uploaded, flowId });
        return { file_path: "/flow-files/img-1.png", id: "img-1", name: uploaded.name };
      },
    } as unknown as FlowService;

    const backend = createStudioFlowGrpcBackend(studio);
    const result = await backend.uploadFlowFile("854901549002915840", file);

    expect(calls).toEqual([{ file, flowId: "854901549002915840" }]);
    expect(result).toEqual({ file_path: "/flow-files/img-1.png", id: "img-1", name: "test.png" });
  });

  test("runFlow delegates using the studio flow id and gRPC execution body", async () => {
    const input = {
      files: [{ id: "img-1", file_path: "/flow-files/img-1.png", mime: "image/png" }],
      query: "describe image",
    };
    const variables = { tone: "short" };
    const calls: { flowId: string; body: unknown }[] = [];
    const studio = {
      async runFlow(flowId: string, body: unknown) {
        calls.push({ body, flowId });
        return { raw: { outputs: [{ text: "ok" }], session_id: "sess-1" } };
      },
    } as unknown as FlowService;

    const backend = createStudioFlowGrpcBackend(studio);
    const result = await backend.runFlow("854901549002915840", { input, variables });

    expect(calls).toEqual([{ body: { input, variables }, flowId: "854901549002915840" }]);
    expect(result.raw?.session_id).toBe("sess-1");
  });
});
