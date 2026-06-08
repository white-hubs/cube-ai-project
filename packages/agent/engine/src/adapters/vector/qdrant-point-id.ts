import { createHash } from 'node:crypto';

/** 单集合：规范 §11 / vector-store.md */
export const AGENTIC_ENGINE_MEMORY_COLLECTION = 'agentic_engine_memory';

export const PAYLOAD_AGENTIC_SFID_KEY = '_agenticSfid';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuidString(s: string): boolean {
  return UUID_RE.test(s);
}

function sfidToDeterministicUuid(externalId: string): string {
  const h = createHash('sha256')
    .update(`agentic-engine-memory/point:${externalId}`)
    .digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6]! & 0x0f) | 0x50;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Port 业务 id → Qdrant REST 接受的 point id */
export function toQdrantPointId(externalId: string): string | number {
  if (isUuidString(externalId)) return externalId;
  if (/^\d+$/.test(externalId)) {
    const bi = BigInt(externalId);
    const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
    if (bi <= maxSafe) return Number(bi);
    return sfidToDeterministicUuid(externalId);
  }
  return sfidToDeterministicUuid(externalId);
}

export function vectorHitIdFromPayload(
  payload: Record<string, unknown>,
  qdrantId: unknown,
): string {
  const ext = payload[PAYLOAD_AGENTIC_SFID_KEY];
  if (typeof ext === 'string' && ext.length > 0) return ext;
  return String(qdrantId);
}
