import { describe, expect, it } from "bun:test";

import { createGrpcInnerInvokeSignature, decodeGrpcInnerInvokeSignature } from "./grpc-inner-invoke";

const SECRET_16 = "0123456789abcdef";

describe("grpc-inner-invoke signature", () => {
  it("round-trips marker and expiry through encrypt/decrypt", () => {
    const expiresAtMs = Date.now() + 60_000;
    const signature = createGrpcInnerInvokeSignature(SECRET_16, expiresAtMs);
    expect(signature).not.toContain("FEIGN_INNER_ORIGINAL");

    const decoded = decodeGrpcInnerInvokeSignature(SECRET_16, signature);
    expect(decoded.marker).toBe("FEIGN_INNER_ORIGINAL");
    expect(decoded.expiresAtMs).toBe(expiresAtMs);
  });

  it("rejects secret keys that are not exactly 16 bytes", () => {
    expect(() => createGrpcInnerInvokeSignature("short", Date.now())).toThrow("16 字节");
    expect(() => createGrpcInnerInvokeSignature("0123456789abcdef0", Date.now())).toThrow("16 字节");
    expect(() => decodeGrpcInnerInvokeSignature("short", "whatever")).toThrow("16 字节");
  });

  it("multi-byte utf8 secret is measured in bytes, not chars", () => {
    // 8 个汉字 = 24 字节，必须被拒绝
    expect(() => createGrpcInnerInvokeSignature("一二三四五六七八", Date.now())).toThrow("16 字节");
  });

  it("fails to decode when signature was produced with a different key", () => {
    const signature = createGrpcInnerInvokeSignature(SECRET_16, Date.now() + 1000);
    expect(() => decodeGrpcInnerInvokeSignature("fedcba9876543210", signature)).toThrow();
  });

  it("rejects tampered base64 payloads", () => {
    expect(() => decodeGrpcInnerInvokeSignature(SECRET_16, "AAAA")).toThrow();
  });
});
