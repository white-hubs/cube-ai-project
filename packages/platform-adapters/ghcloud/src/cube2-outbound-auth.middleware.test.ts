import { Context, contextStore } from "@dangao/bun-server";
import { describe, expect, it } from "bun:test";

import { type Cube2OutboundAuthContext, cube2OutboundAuthAls, readCube2OutboundAuthContext } from "./cube2-outbound-auth-context";
import { createCube2OutboundAuthMiddleware } from "./cube2-outbound-auth.middleware";
import { sessionContextHolder } from "./session-context";

function fakeCtx(headers: Record<string, string>) {
  return { request: { headers: new Headers(headers) } } as never;
}

describe("createCube2OutboundAuthMiddleware", () => {
  it("propagates inbound auth headers into ALS for the duration of next()", async () => {
    const middleware = createCube2OutboundAuthMiddleware();
    let inside: Cube2OutboundAuthContext | undefined;

    await middleware(fakeCtx({ authorization: "Bearer tok", tenant: "900001", terminal: "web" }), async () => {
      inside = readCube2OutboundAuthContext();
      return new Response();
    });

    expect(inside).toEqual({ authorization: "Bearer tok", tenant: "900001", terminal: "web" });
    expect(cube2OutboundAuthAls.getStore()).toBeUndefined();
  });

  it("falls back across x-tenant-id and x-project-id for tenant resolution", async () => {
    const middleware = createCube2OutboundAuthMiddleware();

    await middleware(fakeCtx({ "x-tenant-id": " 900002 " }), async () => {
      expect(readCube2OutboundAuthContext().tenant).toBe("900002");
      return new Response();
    });

    await middleware(fakeCtx({ "x-project-id": "900003" }), async () => {
      expect(readCube2OutboundAuthContext().tenant).toBe("900003");
      return new Response();
    });

    await middleware(fakeCtx({}), async () => {
      expect(readCube2OutboundAuthContext().tenant).toBeNull();
      return new Response();
    });
  });
});

describe("readCube2OutboundAuthContext", () => {
  it("returns nulls when neither ALS nor session context is available", () => {
    expect(readCube2OutboundAuthContext()).toEqual({
      authorization: null,
      tenant: null,
      terminal: null,
    });
  });

  it("falls back to session context (number tenant stringified) outside ALS", async () => {
    const req = new Request("http://localhost/agent/sessions");
    const ctx = new Context(req);

    await contextStore.run(ctx, async () => {
      sessionContextHolder.setContext({
        authorization: "Bearer session-tok",
        domain: "localhost",
        host: "127.0.0.1",
        tenant: 900009,
        terminal: "h5",
        uri: "/agent/sessions",
      });
      try {
        expect(readCube2OutboundAuthContext()).toEqual({
          authorization: "Bearer session-tok",
          tenant: "900009",
          terminal: "h5",
        });
      } finally {
        sessionContextHolder.clearContext();
      }
    });
  });

  it("prefers ALS values over session context values", async () => {
    const req = new Request("http://localhost/agent/sessions");
    const ctx = new Context(req);

    await contextStore.run(ctx, async () => {
      sessionContextHolder.setContext({
        authorization: "Bearer session-tok",
        domain: "localhost",
        host: "127.0.0.1",
        tenant: "900001",
        terminal: "h5",
        uri: "/agent/sessions",
      });
      try {
        cube2OutboundAuthAls.run({ authorization: "Bearer als-tok", tenant: "900002", terminal: "web" }, () => {
          expect(readCube2OutboundAuthContext()).toEqual({
            authorization: "Bearer als-tok",
            tenant: "900002",
            terminal: "web",
          });
        });
      } finally {
        sessionContextHolder.clearContext();
      }
    });
  });
});
