import { describe, expect, test } from "bun:test";

import { authenticatedUserAls } from "@cube-ai/ai-center/platform/server-shared";

import { createSubjectUserBridgeMiddleware } from "./subject-bridge.middleware";

function mockSubject() {
  return {
    tenant: 900001,
    terminal: "web",
    traceId: "trace-1",
    user: {
      displayName: "Mock User (mock-user)",
      expiresAt: Date.now() + 3_600_000,
      rawTokenSha256: "sha",
      scopes: ["engine.use", "openid"],
      tenant: 900001,
      userId: "mock-user",
    },
  };
}

function createCtx(subject: unknown) {
  return {
    path: "/sessions",
    request: new Request("http://localhost/sessions", { method: "POST" }),
    state: { subject },
  };
}

describe("subject user bridge middleware", () => {
  test("rewrites subject.user.userId + displayName from authenticated ghcloud user", async () => {
    const mw = createSubjectUserBridgeMiddleware();
    const ctx = createCtx(mockSubject());
    let called = false;

    await authenticatedUserAls.run({ isSuperAdmin: true, role: "admin", userId: "42", username: "alice@corp" }, async () => {
      await mw(ctx as never, async () => {
        called = true;
      });
    });

    expect(ctx.state.subject.user.userId).toBe("42");
    expect(ctx.state.subject.user.displayName).toBe("alice@corp");
    expect(called).toBe(true);
  });

  test("preserves tenant and scopes while rewriting the user identity", async () => {
    const mw = createSubjectUserBridgeMiddleware();
    const ctx = createCtx(mockSubject());

    await authenticatedUserAls.run({ isSuperAdmin: true, role: "admin", userId: "42", username: "alice@corp" }, async () => {
      await mw(ctx as never, async () => {});
    });

    expect(ctx.state.subject.user.tenant).toBe(900001);
    expect(ctx.state.subject.tenant).toBe(900001);
    expect(ctx.state.subject.user.scopes).toEqual(["engine.use", "openid"]);
  });

  test("leaves subject untouched when no authenticated user is present", async () => {
    const mw = createSubjectUserBridgeMiddleware();
    const ctx = createCtx(mockSubject());
    let called = false;

    await mw(ctx as never, async () => {
      called = true;
    });

    expect(ctx.state.subject.user.userId).toBe("mock-user");
    expect(called).toBe(true);
  });
});
