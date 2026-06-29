import { createHash } from "node:crypto";

export function buildStableQdrantPointId(chunkId: string): string {
  const hex = createHash("sha256").update(chunkId).digest("hex");
  const bytes = new Uint8Array(16);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  const versionByte = bytes.at(6) ?? 0;
  const variantByte = bytes.at(8) ?? 0;
  bytes[6] = (versionByte & 0x0f) | 0x40;
  bytes[8] = (variantByte & 0x3f) | 0x80;

  const uuidHex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return [uuidHex.slice(0, 8), uuidHex.slice(8, 12), uuidHex.slice(12, 16), uuidHex.slice(16, 20), uuidHex.slice(20, 32)].join("-");
}

export function buildPointId(key: string): string {
  return buildStableQdrantPointId(key);
}
