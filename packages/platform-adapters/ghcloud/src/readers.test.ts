import { describe, expect, it } from "bun:test";

import { createGhcloudAccessTokenReader, createGhcloudExecutionAuthReaders, createHostPatReader } from "./readers";
import { PrincipalType, type SecurityContext, SecurityContextHolder } from "./security-context";
import { type SessionContext, SessionContextHolder } from "./session-context";

function makeHolders(raw: Record<string, unknown> = {}) {
  const securityHolder = new SecurityContextHolder({ getContext: () => raw } as never);
  const sessionHolder = new SessionContextHolder({ getContext: () => raw } as never);
  return { raw, securityHolder, sessionHolder };
}

function principalContext(overrides: Partial<SecurityContext["principal"]> = {}): SecurityContext {
  return {
    principal: {
      account: "alice@corp",
      admin: false,
      id: 42,
      name: "Alice Name",
      type: PrincipalType.USER,
      ...overrides,
    },
  };
}

function sessionWith(authorization: string | null): SessionContext {
  return {
    authorization,
    domain: "localhost",
    host: "127.0.0.1",
    tenant: "900001",
    terminal: null,
    uri: "/agent/sessions",
  };
}

describe("createGhcloudAccessTokenReader", () => {
  it("returns null when no principal is present in security context", async () => {
    const { securityHolder, sessionHolder } = makeHolders();
    const reader = createGhcloudAccessTokenReader(securityHolder, sessionHolder);
    expect(await reader.verifyAccessToken("any-token")).toBeNull();
  });

  it("returns null when raw token does not match the session bearer", async () => {
    const { securityHolder, sessionHolder } = makeHolders();
    securityHolder.setContext(principalContext());
    sessionHolder.setContext(sessionWith("Bearer session-token"));

    const reader = createGhcloudAccessTokenReader(securityHolder, sessionHolder);
    expect(await reader.verifyAccessToken("different-token")).toBeNull();
  });

  it("maps principal to access token record when bearer matches (case-insensitive prefix, trimmed)", async () => {
    const { securityHolder, sessionHolder } = makeHolders();
    securityHolder.setContext(principalContext({ admin: true }));
    sessionHolder.setContext(sessionWith("bearer the-token"));

    const reader = createGhcloudAccessTokenReader(securityHolder, sessionHolder);
    const record = await reader.verifyAccessToken("  the-token  ");
    expect(record).toEqual({
      isSuperAdmin: true,
      role: "admin",
      userId: "42",
      username: "alice@corp",
    });
  });

  it("non-admin principal maps to user role; username falls back to name when account empty", async () => {
    const { securityHolder, sessionHolder } = makeHolders();
    securityHolder.setContext(principalContext({ account: "" }));

    const reader = createGhcloudAccessTokenReader(securityHolder, sessionHolder);
    const record = await reader.verifyAccessToken("token-without-session");
    expect(record).toEqual({
      isSuperAdmin: false,
      role: "user",
      userId: "42",
      username: "Alice Name",
    });
  });
});

describe("createHostPatReader", () => {
  it("default reader rejects all api keys", async () => {
    const reader = createHostPatReader();
    expect(await reader.verifyApiKeyRaw("pat-anything")).toBeNull();
  });

  it("delegates to provided fallback reader unchanged", () => {
    const fallback = { verifyApiKeyRaw: async () => null };
    expect(createHostPatReader(fallback)).toBe(fallback);
  });
});

describe("createGhcloudExecutionAuthReaders", () => {
  it("wires access token reader and api key fallback together", async () => {
    const { securityHolder, sessionHolder } = makeHolders();
    securityHolder.setContext(principalContext());
    const fallback = { verifyApiKeyRaw: async () => null };

    const readers = createGhcloudExecutionAuthReaders({
      apiKeyFallback: fallback,
      securityHolder,
      sessionHolder,
    });
    expect(readers.apiKeyReader).toBe(fallback);
    const record = await readers.accessTokenReader.verifyAccessToken("tok");
    expect(record?.userId).toBe("42");
  });
});
