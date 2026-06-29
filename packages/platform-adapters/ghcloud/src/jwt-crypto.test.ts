import { describe, expect, it } from "bun:test";

import { importRsaVerificationKey, verifyJwtRs256 } from "./jwt-crypto";
import { createTestJwtKeyPair, signTestJwt } from "./test-helpers/jwt-test-keys";

function encodeBase64Url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64").replaceAll(/\+/gu, "-").replaceAll(/\//gu, "_").replaceAll(/=+$/gu, "");
}

describe("importRsaVerificationKey", () => {
  it("returns null for malformed jwk instead of throwing", async () => {
    const key = await importRsaVerificationKey({ e: "!!!", kty: "RSA", n: "###" });
    expect(key).toBeNull();
  });
});

describe("verifyJwtRs256", () => {
  it("verifies a correctly signed token and returns its payload", async () => {
    const { privateKey, publicKey } = await createTestJwtKeyPair();
    const token = await signTestJwt(privateKey, { account: "bob", id: 7, tenants: [900001] });

    const payload = await verifyJwtRs256(token, publicKey);
    expect(payload.id).toBe(7);
    expect(payload.account).toBe("bob");
    expect(payload.tenants).toEqual([900001]);
  });

  it("rejects tokens that are not three dot-separated segments", async () => {
    const { publicKey } = await createTestJwtKeyPair();
    await expect(verifyJwtRs256("only.two", publicKey)).rejects.toThrow("invalid jwt format");
  });

  it("rejects unsupported algorithms before signature verification", async () => {
    const { publicKey } = await createTestJwtKeyPair();
    const header = encodeBase64Url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = encodeBase64Url(JSON.stringify({ id: 1 }));
    await expect(verifyJwtRs256(`${header}.${payload}.sig`, publicKey)).rejects.toThrow("unsupported jwt alg");
  });

  it("rejects tokens whose payload was tampered after signing", async () => {
    const { privateKey, publicKey } = await createTestJwtKeyPair();
    const token = await signTestJwt(privateKey, { admin: false, id: 7 });
    const [header, , signature] = token.split(".");
    const forgedPayload = encodeBase64Url(JSON.stringify({ admin: true, id: 7 }));

    await expect(verifyJwtRs256(`${header}.${forgedPayload}.${signature}`, publicKey)).rejects.toThrow("invalid jwt signature");
  });

  it("rejects tokens signed by a different key pair", async () => {
    const { privateKey } = await createTestJwtKeyPair();
    const { publicKey: otherPublicKey } = await createTestJwtKeyPair();
    const token = await signTestJwt(privateKey, { id: 9 });

    await expect(verifyJwtRs256(token, otherPublicKey)).rejects.toThrow("invalid jwt signature");
  });
});
