import { type HandlerContext } from "@connectrpc/connect";
import { describe, expect, it } from "bun:test";

import {
  buildSessionContextFromConnectHeaders,
  runWithConnectHandlerSession,
  streamWithConnectHandlerSession,
  validateConnectInnerInvoke,
} from "./connect-handler-session";
import { createGrpcInnerInvokeSignature } from "./grpc-inner-invoke";
import { sessionContextHolder } from "./session-context";

const SECRET_16 = "0123456789abcdef";

function fakeHandlerContext(headers: Record<string, string>, url = "http://grpc-host:9090/pkg.Service/Method"): HandlerContext {
  return {
    requestHeader: new Headers(headers),
    requestMethod: "POST",
    signal: new AbortController().signal,
    url,
  } as never;
}

describe("validateConnectInnerInvoke", () => {
  it("passes through when no secret key is configured", () => {
    expect(() => validateConnectInnerInvoke(new Headers())).not.toThrow();
    expect(() => validateConnectInnerInvoke(new Headers(), { internalInvokeSecretKey: "   " })).not.toThrow();
  });

  it("rejects missing signature header when secret is configured", () => {
    expect(() => validateConnectInnerInvoke(new Headers(), { internalInvokeSecretKey: SECRET_16 })).toThrow("missing feign_inner_invoke");
  });

  it("accepts a fresh signature and rejects an expired one", () => {
    const fresh = createGrpcInnerInvokeSignature(SECRET_16, Date.now() + 60_000);
    expect(() =>
      validateConnectInnerInvoke(new Headers({ feign_inner_invoke: fresh }), {
        internalInvokeSecretKey: SECRET_16,
      }),
    ).not.toThrow();

    const expired = createGrpcInnerInvokeSignature(SECRET_16, Date.now() - 1);
    expect(() =>
      validateConnectInnerInvoke(new Headers({ feign_inner_invoke: expired }), {
        internalInvokeSecretKey: SECRET_16,
      }),
    ).toThrow("feign_inner_invoke expired");
  });
});

describe("buildSessionContextFromConnectHeaders", () => {
  it("maps headers and url into session fields", () => {
    const session = buildSessionContextFromConnectHeaders(
      fakeHandlerContext({
        authorization: "Bearer tok",
        permission: "perm",
        signature: "sig",
        tenant: " 900001 ",
        terminal: "web",
        version: "v1",
      }),
    );
    expect(session.uri).toBe("/pkg.Service/Method");
    expect(session.domain).toBe("grpc-host:9090");
    expect(session.host).toBe("grpc");
    expect(session.tenant).toBe("900001");
    expect(session.authorization).toBe("Bearer tok");
    expect(session.terminal).toBe("web");
    expect(session.version).toBe("v1");
    expect(session.signature).toBe("sig");
    expect(session.permission).toBe("perm");
  });

  it("rejects non-numeric tenant and keeps defaults on invalid url", () => {
    const session = buildSessionContextFromConnectHeaders(fakeHandlerContext({ tenant: "not-a-number" }, "not a url"));
    expect(session.tenant).toBeNull();
    expect(session.uri).toBe("/");
    expect(session.domain).toBeNull();
    expect(session.authorization).toBeNull();
  });
});

describe("runWithConnectHandlerSession", () => {
  it("exposes session context inside fn and clears it afterwards", async () => {
    const result = await runWithConnectHandlerSession(fakeHandlerContext({ authorization: "Bearer tok", tenant: "900001" }), async () => {
      const session = sessionContextHolder.getContext();
      expect(session?.tenant).toBe("900001");
      expect(session?.authorization).toBe("Bearer tok");
      return "done";
    });
    expect(result).toBe("done");
    expect(sessionContextHolder.getContext()).toBeUndefined();
  });

  it("propagates inner-invoke validation failure before running fn", async () => {
    let ran = false;
    await expect(
      runWithConnectHandlerSession(
        fakeHandlerContext({}),
        async () => {
          ran = true;
          return "never";
        },
        { internalInvokeSecretKey: SECRET_16 },
      ),
    ).rejects.toThrow("missing feign_inner_invoke");
    expect(ran).toBe(false);
  });
});

describe("streamWithConnectHandlerSession", () => {
  // 注意：当前实现里 ALS 上下文不会传播到惰性迭代的 generator body（疑似缺陷，见测试报告），
  // 此处仅断言流的值透传与校验时机这两个稳定行为。
  it("yields all values produced by the wrapped async generator", async () => {
    const stream = streamWithConnectHandlerSession(fakeHandlerContext({ tenant: "900002" }), async function* stream() {
      yield 1;
      yield 2;
      yield 3;
    });

    const collected: number[] = [];
    for await (const item of stream) {
      collected.push(item);
    }
    expect(collected).toEqual([1, 2, 3]);
    expect(sessionContextHolder.getContext()).toBeUndefined();
  });

  it("validates inner-invoke synchronously before the stream is consumed", () => {
    expect(() =>
      streamWithConnectHandlerSession(
        fakeHandlerContext({}),
        async function* () {
          yield 1;
        },
        { internalInvokeSecretKey: SECRET_16 },
      ),
    ).toThrow("missing feign_inner_invoke");
  });
});
