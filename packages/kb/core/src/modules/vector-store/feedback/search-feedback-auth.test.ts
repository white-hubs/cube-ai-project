import { describe, expect, test } from "bun:test";

import { assertFeedbackAuthorized, FeedbackUnauthorizedError, resolveFeedbackAuthFromTrustedContext } from "./search-feedback-auth";

describe("search-feedback-auth (W4.2-H2)", () => {
  test("rejects missing tenant", () => {
    expect(() => assertFeedbackAuthorized({ authenticated: true, tenantId: null })).toThrow(FeedbackUnauthorizedError);
    expect(() => assertFeedbackAuthorized({ authenticated: true, tenantId: "  " })).toThrow(/tenant/i);
  });

  test("rejects anonymous (no auth credentials)", () => {
    expect(() => assertFeedbackAuthorized({ authenticated: false, tenantId: "42" })).toThrow(FeedbackUnauthorizedError);
    expect(() => assertFeedbackAuthorized({ authenticated: false, tenantId: "42" })).toThrow(/authentication/i);
  });

  test("allows authenticated tenant write", () => {
    const auth = { authenticated: true, tenantId: " 42 " };
    assertFeedbackAuthorized(auth);
    expect(auth.tenantId).toBe("42");
  });

  test("raw header-shaped fields cannot authenticate feedback", () => {
    expect(
      resolveFeedbackAuthFromTrustedContext({
        authorizationHeader: "Bearer tok",
        apiKeyHeader: "sk_test",
        tenantId: "1",
      } as never).authenticated,
    ).toBe(false);
  });

  test("trusted host subject can authenticate feedback", () => {
    expect(
      resolveFeedbackAuthFromTrustedContext({
        tenantId: "1",
        trustedSubjectId: "agent-1",
      }).authenticated,
    ).toBe(true);
    expect(
      resolveFeedbackAuthFromTrustedContext({
        tenantId: "1",
      }).authenticated,
    ).toBe(false);
  });
});
