import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

import { connectExceptionFilter } from "./connect-exception.filter";

// @connectrpc/connect 未在 ai-center 直接声明依赖（isolated install），
// 从 ghcloud adapter 包的依赖图解析，保证与 isConnectError 使用同一份模块实例。
const ghcloudPkgDir = fileURLToPath(new URL("../../../../packages/platform-adapters/ghcloud", import.meta.url));
const connectModulePath = Bun.resolveSync("@connectrpc/connect", ghcloudPkgDir);
const { Code, ConnectError } = (await import(connectModulePath)) as {
  Code: Record<string, number>;
  ConnectError: new (message: string, code?: number) => Error & { code: number };
};

interface ErrorBody {
  error: string;
  code: string;
  details: { connectCode: number; traceId: string };
}

function createCtx(opts?: { stateTraceId?: string; headerTraceId?: string }) {
  let status = 0;
  const ctx = {
    state: opts?.stateTraceId ? { traceId: opts.stateTraceId } : undefined,
    getHeader(key: string): string | null {
      if (key === "X-Trace-Id") return opts?.headerTraceId ?? null;
      return null;
    },
    setStatus(code: number) {
      status = code;
    },
    createErrorResponse(body?: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    },
  };
  return { ctx, getStatus: () => status };
}

describe("connectExceptionFilter", () => {
  test("returns undefined for non-Connect errors (defers to other filters)", () => {
    const { ctx } = createCtx();
    expect(connectExceptionFilter.catch(new Error("plain"), ctx as never)).toBeUndefined();
    expect(connectExceptionFilter.catch("raw string", ctx as never)).toBeUndefined();
    expect(connectExceptionFilter.catch(undefined, ctx as never)).toBeUndefined();
  });

  test("maps NotFound to 404 with PLATFORM_RPC_ERROR envelope", async () => {
    const { ctx, getStatus } = createCtx({ stateTraceId: "trace-from-state" });
    const error = new ConnectError("kb missing", Code.NotFound);

    const result = connectExceptionFilter.catch(error, ctx as never);

    expect(result).toBeInstanceOf(Response);
    expect(result?.status).toBe(404);
    expect(getStatus()).toBe(404);
    expect(result?.headers.get("X-Trace-Id")).toBe("trace-from-state");
    expect(result?.headers.get("Content-Type")).toBe("application/json");

    const body = (await result?.json()) as ErrorBody;
    expect(body.code).toBe("PLATFORM_RPC_ERROR");
    expect(body.details.connectCode).toBe(Code.NotFound);
    expect(body.details.traceId).toBe("trace-from-state");
    expect(body.error).toContain("cube2 gRPC NotFound");
  });

  test("maps Unauthenticated to 401 and includes credential hint", async () => {
    const { ctx } = createCtx();
    const error = new ConnectError("token rejected", Code.Unauthenticated);

    const result = connectExceptionFilter.catch(error, ctx as never);

    expect(result?.status).toBe(401);
    const body = (await result?.json()) as ErrorBody;
    expect(body.error).toContain("CUBE2_INTERNAL_INVOKE_SECRET_KEY");
  });

  test("maps remaining codes to expected HTTP statuses", () => {
    const cases: Array<[number, number]> = [
      [Code.PermissionDenied, 403],
      [Code.InvalidArgument, 400],
      [Code.Unavailable, 503],
      [Code.DeadlineExceeded, 503],
      [Code.Internal, 502],
      [Code.Unknown, 502],
    ];
    for (const [code, expectedStatus] of cases) {
      const { ctx } = createCtx();
      const result = connectExceptionFilter.catch(new ConnectError("x", code), ctx as never);
      expect(result?.status).toBe(expectedStatus);
    }
  });

  test("falls back to X-Trace-Id request header when ctx.state has no traceId", async () => {
    const { ctx } = createCtx({ headerTraceId: "trace-from-header" });

    const result = connectExceptionFilter.catch(new ConnectError("x", Code.Unavailable), ctx as never);

    expect(result?.headers.get("X-Trace-Id")).toBe("trace-from-header");
    const body = (await result?.json()) as ErrorBody;
    expect(body.details.traceId).toBe("trace-from-header");
  });

  test("generates a 32-char hex trace id when no trace source exists", async () => {
    const { ctx } = createCtx();

    const result = connectExceptionFilter.catch(new ConnectError("x", Code.Unavailable), ctx as never);

    const body = (await result?.json()) as ErrorBody;
    expect(body.details.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(result?.headers.get("X-Trace-Id")).toBe(body.details.traceId);
  });
});
