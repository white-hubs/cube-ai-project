/** Twitter Snowflake epoch — aligned with agent engine SfidService. */
const SFID_EPOCH = 1_288_834_974_657n;
const NODE_BITS = 10;
const SEQ_BITS = 12;
const MAX_NODE = (1 << NODE_BITS) - 1;
const MAX_SEQ = (1 << SEQ_BITS) - 1;
const NODE_SHIFT = BigInt(SEQ_BITS);
const TIMESTAMP_SHIFT = BigInt(NODE_BITS + SEQ_BITS);

let seq = 0;
let lastMs = -1;
const nodeId = BigInt(Number(Bun.env.AGENTIC_ENGINE_NODE_ID ?? process.env.AGENTIC_ENGINE_NODE_ID ?? 0) & MAX_NODE);

/** Generate a 19-digit decimal string id for KB MySQL VARCHAR primary keys. */
export function generateKbRecordId(): string {
  let now = Date.now();

  if (now < lastMs) {
    const drift = lastMs - now;
    if (drift > 5) {
      throw new Error(`[generateKbRecordId] Clock regression detected: ${drift}ms`);
    }
    now = lastMs;
  }

  if (now === lastMs) {
    seq = (seq + 1) & MAX_SEQ;
    if (seq === 0) {
      while (Date.now() <= lastMs) {
        // spin until next millisecond
      }
      now = Date.now();
      lastMs = now;
    }
  } else {
    seq = 0;
    lastMs = now;
  }

  const ts = BigInt(now) - SFID_EPOCH;
  const id = (ts << TIMESTAMP_SHIFT) | (nodeId << NODE_SHIFT) | BigInt(seq);
  return id.toString(10);
}

export function resolveKbRecordId(explicitId: string | undefined | null): string {
  const normalized = explicitId?.trim();
  return normalized && normalized.length > 0 ? normalized : generateKbRecordId();
}
