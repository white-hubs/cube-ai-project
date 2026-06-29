import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "bun:test";

import { formatConnectErrorMessage, isConnectError, mapConnectErrorToHttpStatus } from "./cube2-connect-error";

describe("isConnectError", () => {
  it("discriminates ConnectError from plain errors", () => {
    expect(isConnectError(new ConnectError("x", Code.NotFound))).toBe(true);
    expect(isConnectError(new Error("x"))).toBe(false);
    expect(isConnectError("x")).toBe(false);
    expect(isConnectError(undefined)).toBe(false);
  });
});

describe("mapConnectErrorToHttpStatus", () => {
  it("maps well-known gRPC codes to HTTP statuses", () => {
    expect(mapConnectErrorToHttpStatus(Code.Unauthenticated)).toBe(401);
    expect(mapConnectErrorToHttpStatus(Code.PermissionDenied)).toBe(403);
    expect(mapConnectErrorToHttpStatus(Code.NotFound)).toBe(404);
    expect(mapConnectErrorToHttpStatus(Code.InvalidArgument)).toBe(400);
    expect(mapConnectErrorToHttpStatus(Code.Unavailable)).toBe(503);
    expect(mapConnectErrorToHttpStatus(Code.DeadlineExceeded)).toBe(503);
  });

  it("maps everything else to 502 upstream failure", () => {
    expect(mapConnectErrorToHttpStatus(Code.Internal)).toBe(502);
    expect(mapConnectErrorToHttpStatus(Code.Unknown)).toBe(502);
    expect(mapConnectErrorToHttpStatus(Code.ResourceExhausted)).toBe(502);
  });
});

describe("formatConnectErrorMessage", () => {
  it("includes code name and original message", () => {
    const msg = formatConnectErrorMessage(new ConnectError("boom", Code.Internal));
    expect(msg).toContain("Internal");
    expect(msg).toContain("boom");
    expect(msg).not.toContain("CUBE2_INTERNAL_INVOKE_SECRET_KEY");
  });

  it("appends auth configuration hint only for Unauthenticated", () => {
    const msg = formatConnectErrorMessage(new ConnectError("no creds", Code.Unauthenticated));
    expect(msg).toContain("Unauthenticated");
    expect(msg).toContain("CUBE2_INTERNAL_INVOKE_SECRET_KEY");
  });
});
