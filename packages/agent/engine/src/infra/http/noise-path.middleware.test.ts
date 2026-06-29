import type { Context, NextFunction } from "@dangao/bun-server";
import { describe, expect, it, mock } from "bun:test";

import { createNoisePathMiddleware, isNoisePath } from "./noise-path.middleware";

interface FakeCtx {
  path: string;
}

function makeCtx(path: string): FakeCtx {
  return { path };
}

const okNext: NextFunction = () => Promise.resolve(new Response(null, { status: 200 }));

describe("isNoisePath", () => {
  it("matches common browser probe paths", () => {
    expect(isNoisePath("/favicon.ico")).toBe(true);
    expect(isNoisePath("/robots.txt")).toBe(true);
  });

  it("does not match API or health paths", () => {
    expect(isNoisePath("/health/live")).toBe(false);
    expect(isNoisePath("/api/sessions")).toBe(false);
  });
});

describe("createNoisePathMiddleware", () => {
  it("returns 200 with status ok for root path without calling next", async () => {
    const mw = createNoisePathMiddleware();
    const next = mock(okNext);

    const res = await mw(makeCtx("/") as unknown as Context, next);

    expect(res?.status).toBe(200);
    expect(await res?.text()).toBe("status ok");
    expect(res?.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 404 for noise paths without calling next", async () => {
    const mw = createNoisePathMiddleware();
    const next = mock(okNext);

    const res = await mw(makeCtx("/favicon.ico") as unknown as Context, next);

    expect(res?.status).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("passes through non-noise paths", async () => {
    const mw = createNoisePathMiddleware();
    const next = mock(okNext);

    await mw(makeCtx("/sessions") as unknown as Context, next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
