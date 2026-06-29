import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type HandlerContext, type ServiceImpl } from "@connectrpc/connect";

import { tenantContextAls } from "@cube-ai/ai-center/platform/server-shared";
import {
  type FlowInputImageRef,
  FlowInputImageRefSchema,
  type FlowServiceGrpc as FlowServiceGrpcDesc,
  type RunFlowRequest,
  type RunFlowResponse,
  RunFlowResponseSchema,
  type RunFlowStreamEvent,
  RunFlowStreamEventSchema,
  type UploadFlowImageRequest,
  type UploadFlowImageResponse,
  UploadFlowImageResponseSchema,
  runWithConnectHandlerSession,
  streamWithConnectHandlerSession,
} from "@cube-ai/platform-adapter-ghcloud";

import { type FlowGrpcBackend, type FlowRunBody, type FlowUploadResultLike } from "./flow-grpc-backend";

const FLOW_GRPC_LOG_PREFIX = "[FlowGrpc]";

export interface FlowGrpcIngressLogger {
  info(fields: Record<string, unknown>, msg: string): void;
}

/**
 * 从 gRPC/Connect 请求头中提取 tenant id（纯数字字符串），与 HTTP 侧 createSessionContextMiddleware 对齐。
 * gRPC 入口必须显式携带 tenant，避免请求落入无租户上下文。
 */
function requireTenantFromGrpcHeaders(headers: Headers): string {
  const raw = headers.get("tenant")?.trim() ?? "";
  if (!/^\d+$/u.test(raw)) {
    throw new ConnectError("tenant header is required", Code.InvalidArgument);
  }
  return raw;
}

/**
 * 在 tenantContextAls 上下文中执行 fn（有 tenantId 时），保持与 HTTP 中间件一致的租户隔离语义。
 * gRPC 路径不经过 HTTP 中间件，需在 handler 层手动注入。
 */
function withTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContextAls.run({ bypassTenantIsolation: false, tenantId }, fn);
}

export interface FlowGrpcServiceImplOptions {
  internalInvokeSecretKey?: string | null;
  logger?: FlowGrpcIngressLogger;
}

function peerAddr(handlerContext: HandlerContext): string {
  const peer = (handlerContext as unknown as { peer?: { addr?: unknown } }).peer;
  return typeof peer?.addr === "string" ? peer.addr : "";
}

function logFlowGrpcStart(
  logger: FlowGrpcIngressLogger | undefined,
  method: string,
  flowId: string,
  tenantId: string,
  handlerContext: HandlerContext,
): void {
  logger?.info(
    {
      event: "flow.grpc.ingress.start",
      flowId,
      method,
      peer: peerAddr(handlerContext),
      tenantId,
    },
    "flow grpc ingress start",
  );
}

function logFlowGrpcFailure(phase: string, detail: Record<string, unknown>, error: unknown): void {
  const base =
    error instanceof Error
      ? { cause: "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined, message: error.message, stack: error.stack }
      : { thrown: error };
  console.error(FLOW_GRPC_LOG_PREFIX, phase, "failed", { ...detail, ...base });
}

function toConnectError(error: unknown): unknown {
  if (error instanceof ConnectError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as { status?: unknown } | null)?.status;
  if (status === 400) {
    return new ConnectError(message, Code.InvalidArgument);
  }
  if (status === 404) {
    return new ConnectError(message, Code.NotFound);
  }
  return error;
}

function stringifyOrEmpty(value: unknown): string {
  return value === null || value === undefined ? "" : JSON.stringify(value);
}

function toExecutionFileRef(image: FlowInputImageRef): Record<string, unknown> {
  const filePath = image.filePath?.trim() ?? "";
  return {
    ...(image.id?.trim() ? { id: image.id.trim() } : {}),
    ...(image.name?.trim() ? { name: image.name.trim() } : {}),
    ...(filePath ? { filePath, file_path: filePath, path: filePath } : {}),
    ...(image.url?.trim() ? { url: image.url.trim() } : {}),
    ...(image.mime?.trim() ? { mime: image.mime.trim() } : {}),
    ...(image.ext && Object.keys(image.ext).length > 0 ? { ext: image.ext } : {}),
  };
}

function toFlowRunBody(request: Pick<RunFlowRequest, "input" | "variables" | "images">): FlowRunBody {
  const body: FlowRunBody = {};
  const images = Array.isArray(request.images) ? request.images : [];
  if (typeof request.input === "string" && request.input !== "") {
    body.input =
      images.length > 0
        ? {
            files: images.map((value) => toExecutionFileRef(value)),
            query: request.input,
          }
        : request.input;
  } else if (images.length > 0) {
    body.input = {
      files: images.map((value) => toExecutionFileRef(value)),
      query: "",
    };
  }
  if (request.variables && Object.keys(request.variables).length > 0) {
    body.variables = request.variables;
  }
  return body;
}

function uploadedImageResponse(flowId: string, raw: FlowUploadResultLike): UploadFlowImageResponse {
  const filePath = raw.file_path ?? raw.filePath ?? raw.path ?? "";
  const image = create(FlowInputImageRefSchema, {
    ext: Object.fromEntries(
      Object.entries(raw.ext ?? {})
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [key, String(value)]),
    ),
    filePath: filePath || undefined,
    id: raw.id ?? undefined,
    mime: raw.mime ?? undefined,
    name: raw.name ?? undefined,
    url: raw.url ?? undefined,
  });
  return create(UploadFlowImageResponseSchema, {
    flowId: raw.flowId ?? flowId,
    image,
    rawJson: stringifyOrEmpty(raw.raw ?? raw),
  });
}

export async function* parseSseEvents(body: ReadableStream<Uint8Array> | null | undefined): AsyncIterable<RunFlowStreamEvent> {
  if (!body) {
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const emitChunk = async function* emitChunk(chunk: string): AsyncIterable<RunFlowStreamEvent> {
    const normalized = chunk.replaceAll(/\r/gu, "");
    const lines = normalized.split("\n");
    let event = "";
    let id = "";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line === "" || line.startsWith(":")) {
        continue;
      }
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("id:")) {
        id = line.slice(3).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
    }
    if (event === "" && id === "" && dataLines.length === 0) {
      return;
    }
    const data = dataLines.join("\n");
    yield create(RunFlowStreamEventSchema, {
      data,
      done: event === "end" || data === "[DONE]",
      event,
      id,
    });
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) {
        break;
      }
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      yield* emitChunk(chunk);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim() !== "") {
    yield* emitChunk(buffer);
  }
}

export function createFlowGrpcServiceImpl(
  flowService: FlowGrpcBackend,
  options: FlowGrpcServiceImplOptions = {},
): Partial<ServiceImpl<typeof FlowServiceGrpcDesc>> {
  return {
    async runFlow(request: RunFlowRequest, handlerContext: HandlerContext): Promise<RunFlowResponse> {
      const flowId = String(request.flowId ?? "").trim();
      const tenantId = requireTenantFromGrpcHeaders(handlerContext.requestHeader);
      logFlowGrpcStart(options.logger, "runFlow", flowId, tenantId, handlerContext);
      try {
        return await runWithConnectHandlerSession(
          handlerContext,
          () =>
            withTenant(tenantId, async () => {
              const result = await flowService.runFlow(flowId, toFlowRunBody(request));
              const raw = result.raw ?? {};
              return create(RunFlowResponseSchema, {
                sessionId: typeof raw.session_id === "string" ? raw.session_id : "",
                outputsJson: stringifyOrEmpty(raw.outputs ?? []),
                rawJson: stringifyOrEmpty(raw),
              });
            }),
          options,
        );
      } catch (error) {
        logFlowGrpcFailure("runFlow", { flowId }, error);
        throw toConnectError(error);
      }
    },
    runFlowStream(request: RunFlowRequest, handlerContext: HandlerContext): AsyncIterable<RunFlowStreamEvent> {
      const flowId = String(request.flowId ?? "").trim();
      const tenantId = requireTenantFromGrpcHeaders(handlerContext.requestHeader);
      logFlowGrpcStart(options.logger, "runFlowStream", flowId, tenantId, handlerContext);
      return streamWithConnectHandlerSession(
        handlerContext,
        () => {
          async function* inner(): AsyncIterable<RunFlowStreamEvent> {
            try {
              const response = await flowService.runFlowStream(flowId, toFlowRunBody(request));
              yield* parseSseEvents(response.body);
            } catch (error) {
              logFlowGrpcFailure("runFlowStream", { flowId }, error);
              throw toConnectError(error);
            }
          }
          return tenantContextAls.run({ tenantId, bypassTenantIsolation: false }, inner);
        },
        options,
      );
    },
    async uploadFlowImage(request: UploadFlowImageRequest, handlerContext: HandlerContext): Promise<UploadFlowImageResponse> {
      const flowId = String(request.flowId ?? "").trim();
      const tenantId = requireTenantFromGrpcHeaders(handlerContext.requestHeader);
      logFlowGrpcStart(options.logger, "uploadFlowImage", flowId, tenantId, handlerContext);
      try {
        return await runWithConnectHandlerSession(
          handlerContext,
          () =>
            withTenant(tenantId, async () => {
              const image = request.image;
              if (!image || image.content.length === 0) {
                throw new ConnectError("image content is required", Code.InvalidArgument);
              }
              const filename = image.filename?.trim() || "image";
              const file = new File([Uint8Array.from(image.content)], filename, {
                type: image.contentType?.trim() || "application/octet-stream",
              });
              const uploaded = await flowService.uploadFlowFile(flowId, file);
              return uploadedImageResponse(flowId, uploaded);
            }),
          options,
        );
      } catch (error) {
        logFlowGrpcFailure("uploadFlowImage", { flowId }, error);
        throw toConnectError(error);
      }
    },
  };
}
