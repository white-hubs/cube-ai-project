import { createCipheriv, createDecipheriv } from "node:crypto";

const AES_ALGORITHM = "aes-128-cbc";
const INNER_INVOKE_MARKER = "FEIGN_INNER_ORIGINAL";

function normalizeSecretKey(secretKey: string): string {
  if (Buffer.byteLength(secretKey, "utf8") !== 16) {
    throw new Error("internalInvokeSecretKey 长度必须为 16 字节");
  }
  return secretKey;
}

export function createGrpcInnerInvokeSignature(secretKey: string, expiresAtMs: number): string {
  const secret = normalizeSecretKey(secretKey);
  const cipher = createCipheriv(AES_ALGORITHM, secret, secret);
  const payload = `${INNER_INVOKE_MARKER}@${expiresAtMs}`;
  return cipher.update(payload, "utf8", "base64") + cipher.final("base64");
}

export function decodeGrpcInnerInvokeSignature(secretKey: string, signature: string): { marker: string; expiresAtMs: number } {
  const secret = normalizeSecretKey(secretKey);
  const decipher = createDecipheriv(AES_ALGORITHM, secret, secret);
  const decrypted = decipher.update(signature, "base64", "utf8") + decipher.final("utf8");
  const [marker, expiresAtRaw] = decrypted.split("@");
  const expiresAtMs = Number.parseInt(expiresAtRaw ?? "", 10);
  if (!marker || !Number.isFinite(expiresAtMs)) {
    throw new Error("feign_inner_invoke 内容无效");
  }
  return { expiresAtMs, marker };
}
