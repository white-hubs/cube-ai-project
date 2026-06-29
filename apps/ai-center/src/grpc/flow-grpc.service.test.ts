import { Code, ConnectError, type HandlerContext } from "@connectrpc/connect";
import { BadRequestException, NotFoundException } from "@dangao/bun-server";
import { describe, expect, test } from "bun:test";

import { currentTenantId } from "@cube-ai/ai-center/platform/server-shared";

import { type FlowGrpcBackend } from "./flow-grpc-backend";
import { createFlowGrpcServiceImpl } from "./flow-grpc.service";

interface CapturedLog {
  fields: Record<string, unknown>;
  msg: string;
}

function makeHandlerContext(tenant: string): HandlerContext {
  return {
    abort: () => {},
    method: {} as HandlerContext["method"],
    peer: { addr: "127.0.0.1", metadata: new Headers() },
    requestHeader: new Headers({ tenant }),
    requestMethod: "POST",
    service: {} as HandlerContext["service"],
    signal: new AbortController().signal,
    url: "http://localhost:50051/guhecloud.cube.base.ai_application.flow.v1.FlowService/UploadFlowImage",
    values: new Map(),
  } as unknown as HandlerContext;
}

describe("createFlowGrpcServiceImpl — tenant context", () => {
  test("uploadFlowImage populates tenantContextAls so currentTenantId() returns the tenant header", async () => {
    let capturedTenantId: string | null = "NOT_SET";

    const backend: FlowGrpcBackend = {
      async runFlow(_flowId, _body) {
        return {};
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null);
      },
      async uploadFlowFile(_flowId, _file) {
        capturedTenantId = currentTenantId();
        return { id: "img-id", name: "test.png", file_path: "/tmp/test.png" };
      },
    };

    const impl = createFlowGrpcServiceImpl(backend);
    await impl.uploadFlowImage!(
      {
        $typeName: "guhecloud.cube.base.ai_application.flow.v1.UploadFlowImageRequest" as never,
        flowId: "854901549002915840",
        image: {
          $typeName: "guhecloud.cube.base.ai_application.flow.v1.FlowImageUploadPart" as never,
          content: new Uint8Array([1, 2, 3]),
          contentType: "image/png",
          filename: "test.png",
        },
      },
      makeHandlerContext("12345"),
    );

    expect(capturedTenantId).toBe("12345");
  });

  test("runFlow populates tenantContextAls so currentTenantId() returns the tenant header", async () => {
    let capturedTenantId: string | null = "NOT_SET";

    const backend: FlowGrpcBackend = {
      async runFlow(_flowId, _body) {
        capturedTenantId = currentTenantId();
        return { raw: { session_id: "sess-1", outputs: [] } };
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null);
      },
      async uploadFlowFile(_flowId, _file) {
        return {};
      },
    };

    const impl = createFlowGrpcServiceImpl(backend);
    await impl.runFlow!(
      {
        $typeName: "guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest" as never,
        flowId: "854901549002915840",
        images: [],
        input: "hello",
        variables: {},
      },
      makeHandlerContext("99999"),
    );

    expect(capturedTenantId).toBe("99999");
  });

  test("runFlow logs grpc ingress start without request body fields", async () => {
    const logs: CapturedLog[] = [];
    const backend: FlowGrpcBackend = {
      async runFlow(_flowId, _body) {
        return { raw: { session_id: "sess-1", outputs: [] } };
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null);
      },
      async uploadFlowFile(_flowId, _file) {
        return {};
      },
    };

    const impl = createFlowGrpcServiceImpl(backend, {
      logger: {
        info(fields: Record<string, unknown>, msg: string) {
          logs.push({ fields, msg });
        },
      },
    });

    await impl.runFlow!(
      {
        $typeName: "guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest" as never,
        flowId: "854901549002915840",
        images: [],
        input: "sensitive prompt",
        variables: {
          secret: "do-not-log",
        },
      },
      makeHandlerContext("99999"),
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      fields: {
        event: "flow.grpc.ingress.start",
        flowId: "854901549002915840",
        method: "runFlow",
        peer: "127.0.0.1",
        tenantId: "99999",
      },
      msg: "flow grpc ingress start",
    });
    expect(logs[0]?.fields).not.toHaveProperty("input");
    expect(logs[0]?.fields).not.toHaveProperty("variables");
  });

  test("uploadFlowImage logs grpc ingress start without image content", async () => {
    const logs: CapturedLog[] = [];
    const backend: FlowGrpcBackend = {
      async runFlow(_flowId, _body) {
        return {};
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null);
      },
      async uploadFlowFile(_flowId, _file) {
        return { id: "img-id", name: "secret.png", file_path: "/tmp/secret.png" };
      },
    };

    const impl = createFlowGrpcServiceImpl(backend, {
      logger: {
        info(fields: Record<string, unknown>, msg: string) {
          logs.push({ fields, msg });
        },
      },
    });

    await impl.uploadFlowImage!(
      {
        $typeName: "guhecloud.cube.base.ai_application.flow.v1.UploadFlowImageRequest" as never,
        flowId: "854901549002915840",
        image: {
          $typeName: "guhecloud.cube.base.ai_application.flow.v1.FlowImageUploadPart" as never,
          content: new Uint8Array([115, 101, 99, 114, 101, 116]),
          contentType: "image/png",
          filename: "secret.png",
        },
      },
      makeHandlerContext("99999"),
    );

    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      fields: {
        event: "flow.grpc.ingress.start",
        flowId: "854901549002915840",
        method: "uploadFlowImage",
        peer: "127.0.0.1",
        tenantId: "99999",
      },
      msg: "flow grpc ingress start",
    });
    expect(logs[0]?.fields).not.toHaveProperty("image");
    expect(logs[0]?.fields).not.toHaveProperty("content");
  });

  test("runFlowStream logs grpc ingress start without request body fields", async () => {
    const logs: CapturedLog[] = [];
    const backend: FlowGrpcBackend = {
      async runFlow(_flowId, _body) {
        return {};
      },
      async runFlowStream(_flowId, _body) {
        return new Response("event: end\ndata: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        });
      },
      async uploadFlowFile(_flowId, _file) {
        return {};
      },
    };

    const impl = createFlowGrpcServiceImpl(backend, {
      logger: {
        info(fields: Record<string, unknown>, msg: string) {
          logs.push({ fields, msg });
        },
      },
    });

    const stream = impl.runFlowStream!(
      {
        $typeName: "guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest" as never,
        flowId: "854901549002915840",
        images: [],
        input: "sensitive prompt",
        variables: {
          secret: "do-not-log",
        },
      },
      makeHandlerContext("99999"),
    );

    for await (const item of stream) {
      void item;
      // consume the stream to exercise the Connect streaming handler path
    }

    expect(logs).toHaveLength(1);
    expect(logs[0]).toEqual({
      fields: {
        event: "flow.grpc.ingress.start",
        flowId: "854901549002915840",
        method: "runFlowStream",
        peer: "127.0.0.1",
        tenantId: "99999",
      },
      msg: "flow grpc ingress start",
    });
    expect(logs[0]?.fields).not.toHaveProperty("input");
    expect(logs[0]?.fields).not.toHaveProperty("variables");
  });

  test("uploadFlowImage without tenant header fails before invoking the backend", async () => {
    let backendCalled = false;

    const backend: FlowGrpcBackend = {
      async runFlow(_flowId, _body) {
        return {};
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null);
      },
      async uploadFlowFile(_flowId, _file) {
        backendCalled = true;
        return { id: "img-id", name: "test.png" };
      },
    };

    const impl = createFlowGrpcServiceImpl(backend);
    const promise = impl.uploadFlowImage!(
      {
        $typeName: "guhecloud.cube.base.ai_application.flow.v1.UploadFlowImageRequest" as never,
        flowId: "flow-1",
        image: {
          $typeName: "guhecloud.cube.base.ai_application.flow.v1.FlowImageUploadPart" as never,
          content: new Uint8Array([1]),
          contentType: "image/png",
          filename: "x.png",
        },
      },
      makeHandlerContext(""),
    );

    await expect(promise).rejects.toBeInstanceOf(ConnectError);
    await expect(promise).rejects.toHaveProperty("code", Code.InvalidArgument);
    expect(backendCalled).toBe(false);
  });

  test("runFlow maps studio not-found errors to Connect NotFound", async () => {
    const backend: FlowGrpcBackend = {
      async runFlow(_flowId, _body) {
        throw new NotFoundException("流程不存在");
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null);
      },
      async uploadFlowFile(_flowId, _file) {
        return {};
      },
    };

    const impl = createFlowGrpcServiceImpl(backend);
    const promise = impl.runFlow!(
      {
        $typeName: "guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest" as never,
        flowId: "854901549002915840",
        images: [],
        input: "hello",
        variables: {},
      },
      makeHandlerContext("12345"),
    );

    await expect(promise).rejects.toBeInstanceOf(ConnectError);
    await expect(promise).rejects.toHaveProperty("code", Code.NotFound);
  });

  test("runFlow maps studio bad-request errors to Connect InvalidArgument", async () => {
    const backend: FlowGrpcBackend = {
      async runFlow(_flowId, _body) {
        throw new BadRequestException("流程尚未成功编译，无法执行");
      },
      async runFlowStream(_flowId, _body) {
        return new Response(null);
      },
      async uploadFlowFile(_flowId, _file) {
        return {};
      },
    };

    const impl = createFlowGrpcServiceImpl(backend);
    const promise = impl.runFlow!(
      {
        $typeName: "guhecloud.cube.base.ai_application.flow.v1.RunFlowRequest" as never,
        flowId: "854901549002915840",
        images: [],
        input: "hello",
        variables: {},
      },
      makeHandlerContext("12345"),
    );

    await expect(promise).rejects.toBeInstanceOf(ConnectError);
    await expect(promise).rejects.toHaveProperty("code", Code.InvalidArgument);
  });
});
