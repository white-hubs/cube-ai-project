import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterEach, describe, expect, test } from "bun:test";

import { FlowServiceGrpc, RunFlowRequestSchema, UploadFlowImageRequestSchema } from "@cube-ai/platform-adapter-ghcloud";

import { startFlowGrpcServer } from "./flow-grpc-server";

describe("startFlowGrpcServer", () => {
  const servers: { close: () => Promise<void> }[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      await servers.pop()?.close();
    }
  });

  test("serves unary and server-streaming flow grpc methods", async () => {
    const server = await startFlowGrpcServer({
      flowService: {
        runFlow: async (flowId, body) => ({
          raw: {
            session_id: `${flowId}-session`,
            outputs: [body.input ?? "", body.variables ?? {}],
          },
        }),
        runFlowStream: async (flowId, body) =>
          new Response(
            `event: token
id: ${flowId}-1
data: ${body.input ?? ""}

event: end
data: [DONE]

`,
            {
              headers: {
                "content-type": "text/event-stream",
              },
            },
          ),
        uploadFlowFile: async (flowId, file) => ({
          flowId,
          file_path: `${flowId}/${file.name}`,
          name: file.name,
          mime: file.type,
        }),
      },
      hostname: "127.0.0.1",
      port: 0,
    });
    servers.push(server);

    const transport = createGrpcTransport({
      baseUrl: `http://127.0.0.1:${server.port}`,
    });
    const client = createClient(FlowServiceGrpc, transport);

    const uploadResponse = await client.uploadFlowImage(
      create(UploadFlowImageRequestSchema, {
        flowId: "flow-1",
        image: {
          content: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
          filename: "image.png",
        },
      }),
      { headers: { tenant: "900001" } },
    );

    expect(uploadResponse.image?.filePath).toBe("flow-1/image.png");

    const unaryResponse = await client.runFlow(
      create(RunFlowRequestSchema, {
        flowId: "flow-1",
        images: [uploadResponse.image!],
        input: "hello",
        variables: {
          name: "cube",
        },
      }),
      { headers: { tenant: "900001" } },
    );

    expect(unaryResponse.sessionId).toBe("flow-1-session");
    expect(unaryResponse.outputsJson).toContain("hello");
    expect(unaryResponse.outputsJson).toContain("flow-1/image.png");

    const stream = client.runFlowStream(
      create(RunFlowRequestSchema, {
        flowId: "flow-1",
        input: "hello",
      }),
      { headers: { tenant: "900001" } },
    );

    const events: { event?: string; data?: string; done?: boolean }[] = [];
    for await (const item of stream) {
      events.push({
        data: item.data,
        done: item.done,
        event: item.event,
      });
    }

    expect(events).toEqual([
      {
        data: "hello",
        done: false,
        event: "token",
      },
      {
        data: "[DONE]",
        done: true,
        event: "end",
      },
    ]);
  });
});
