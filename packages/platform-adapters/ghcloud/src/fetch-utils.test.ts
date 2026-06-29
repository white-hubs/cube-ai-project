import { describe, expect, it } from "bun:test";

import { GhcloudPlatformError } from "./errors";
import { doFetchJson } from "./fetch-utils";

function neverAbort(): AbortSignal {
  return new AbortController().signal;
}

function asFetch(impl: (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch {
  return impl as unknown as typeof fetch;
}

async function expectPlatformError(promise: Promise<unknown>, code: GhcloudPlatformError["code"]): Promise<GhcloudPlatformError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(GhcloudPlatformError);
    const err = e as GhcloudPlatformError;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected GhcloudPlatformError(${code}) but promise resolved`);
}

describe("doFetchJson", () => {
  it("returns parsed JSON body and status on 2xx", async () => {
    const out = await doFetchJson({
      fetchImpl: asFetch(async () => Response.json({ ok: true, n: 7 }, { status: 200 })),
      headers: { Accept: "application/json" },
      method: "GET",
      signal: neverAbort(),
      timeoutMs: 1000,
      url: "http://upstream/ok",
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ n: 7, ok: true });
  });

  it("serializes bodyJson for POST and forwards method/headers", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const out = await doFetchJson({
      bodyJson: { name: "一只小猫" },
      fetchImpl: asFetch(async (url, init) => {
        seenUrl = String(url);
        seenInit = init;
        return new Response('{"id":1}', { status: 201 });
      }),
      headers: { "x-trace": "abc" },
      method: "POST",
      signal: neverAbort(),
      timeoutMs: 1000,
      url: "http://upstream/create",
    });
    expect(out.status).toBe(201);
    expect(seenUrl).toBe("http://upstream/create");
    expect(seenInit?.method).toBe("POST");
    expect(((seenInit?.headers ?? {}) as Record<string, string>)["x-trace"]).toBe("abc");
    expect(JSON.parse(String(seenInit?.body))).toEqual({ name: "一只小猫" });
  });

  it("omits body when bodyJson is undefined", async () => {
    let seenBody: unknown = "sentinel";
    await doFetchJson({
      fetchImpl: asFetch(async (_url, init) => {
        seenBody = init?.body;
        return new Response("[]", { status: 200 });
      }),
      headers: {},
      method: "GET",
      signal: neverAbort(),
      timeoutMs: 1000,
      url: "http://upstream/list",
    });
    expect(seenBody).toBeUndefined();
  });

  it("empty 2xx body parses to undefined; non-JSON text body kept as raw string", async () => {
    const empty = await doFetchJson({
      fetchImpl: asFetch(async () => new Response("", { status: 204 })),
      headers: {},
      method: "DELETE",
      signal: neverAbort(),
      timeoutMs: 1000,
      url: "http://upstream/empty",
    });
    expect(empty.body).toBeUndefined();

    const text = await doFetchJson({
      fetchImpl: asFetch(async () => new Response("plain text", { status: 200 })),
      headers: {},
      method: "GET",
      signal: neverAbort(),
      timeoutMs: 1000,
      url: "http://upstream/text",
    });
    expect(text.body).toBe("plain text");
  });

  it("maps 401/403 to UPSTREAM_AUTH_FAILED with status + body details", async () => {
    for (const status of [401, 403]) {
      const err = await expectPlatformError(
        doFetchJson({
          fetchImpl: asFetch(async () => Response.json({ message: "denied" }, { status })),
          headers: {},
          method: "GET",
          signal: neverAbort(),
          timeoutMs: 1000,
          url: "http://upstream/secure",
        }),
        "UPSTREAM_AUTH_FAILED",
      );
      expect(err.details?.status).toBe(status);
      expect(err.details?.body).toEqual({ message: "denied" });
    }
  });

  it("maps 404 to RESOURCE_NOT_FOUND_REMOTE", async () => {
    const err = await expectPlatformError(
      doFetchJson({
        fetchImpl: asFetch(async () => new Response("not found", { status: 404 })),
        headers: {},
        method: "GET",
        signal: neverAbort(),
        timeoutMs: 1000,
        url: "http://upstream/missing",
      }),
      "RESOURCE_NOT_FOUND_REMOTE",
    );
    expect(err.details?.status).toBe(404);
    expect(err.message).toContain("HTTP 404");
  });

  it("maps other non-2xx (incl. non-JSON 5xx) to UPSTREAM_TOOL_HTTP_FAILED", async () => {
    const err = await expectPlatformError(
      doFetchJson({
        fetchImpl: asFetch(async () => new Response("<html>Internal Server Error</html>", { status: 500 })),
        headers: {},
        method: "POST",
        signal: neverAbort(),
        timeoutMs: 1000,
        url: "http://upstream/boom",
      }),
      "UPSTREAM_TOOL_HTTP_FAILED",
    );
    expect(err.details?.status).toBe(500);
    expect(err.details?.body).toBe("<html>Internal Server Error</html>");
  });

  it("maps per-call timeout to UPSTREAM_NETWORK_TIMEOUT", async () => {
    const hangUntilAbort = asFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );

    const err = await expectPlatformError(
      doFetchJson({
        fetchImpl: hangUntilAbort,
        headers: {},
        method: "GET",
        signal: neverAbort(),
        timeoutMs: 10,
        url: "http://upstream/slow",
      }),
      "UPSTREAM_NETWORK_TIMEOUT",
    );
    expect(err.message).toContain("timed out after 10ms");
  });

  it("caller abort signal also aborts the composed fetch", async () => {
    const caller = new AbortController();
    const hangUntilAbort = asFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        }),
    );

    const pending = doFetchJson({
      fetchImpl: hangUntilAbort,
      headers: {},
      method: "GET",
      signal: caller.signal,
      timeoutMs: 60_000,
      url: "http://upstream/cancelled",
    });
    caller.abort();
    await expectPlatformError(pending, "UPSTREAM_NETWORK_TIMEOUT");
  });

  it("maps generic network failure to UPSTREAM_TOOL_HTTP_FAILED with cause message", async () => {
    const err = await expectPlatformError(
      doFetchJson({
        fetchImpl: asFetch(async () => {
          throw new TypeError("Unable to connect");
        }),
        headers: {},
        method: "GET",
        signal: neverAbort(),
        timeoutMs: 1000,
        url: "http://upstream/down",
      }),
      "UPSTREAM_TOOL_HTTP_FAILED",
    );
    expect(err.message).toContain("Unable to connect");
  });
});
