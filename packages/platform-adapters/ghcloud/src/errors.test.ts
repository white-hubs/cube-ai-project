import { describe, expect, it } from "bun:test";

import { GhcloudPlatformError } from "./errors";

describe("GhcloudPlatformError", () => {
  it("fromCode preserves code, message and details", () => {
    const err = GhcloudPlatformError.fromCode("UPSTREAM_AUTH_FAILED", "denied", {
      body: { message: "nope" },
      status: 401,
    });
    expect(err).toBeInstanceOf(GhcloudPlatformError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("GhcloudPlatformError");
    expect(err.code).toBe("UPSTREAM_AUTH_FAILED");
    expect(err.message).toBe("denied");
    expect(err.details).toEqual({ body: { message: "nope" }, status: 401 });
  });

  it("details is undefined when omitted", () => {
    const err = GhcloudPlatformError.fromCode("UPSTREAM_NETWORK_TIMEOUT", "timeout");
    expect(err.details).toBeUndefined();
  });
});
