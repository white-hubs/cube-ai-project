/**
 * Snowflake SFID generator — algorithm aligned with `engine/src/infra/sfid/sfid.service.ts`
 * so `OutboxWriterImpl` stays dependency-free from `@cube-ai/agent-engine` (package boundary).
 *
 * ref: docs/adr/ADR-0014-sfid-length-precision.md
 */

const SFID_EPOCH = 1_288_834_974_657n;

const NODE_BITS = 10;
const SEQ_BITS = 12;
const MAX_NODE = (1 << NODE_BITS) - 1;
const MAX_SEQ = (1 << SEQ_BITS) - 1;
const NODE_SHIFT = BigInt(SEQ_BITS);
const TIMESTAMP_SHIFT = BigInt(NODE_BITS + SEQ_BITS);

/**
 * Generate 19-digit decimal SFID strings (same bit layout as SfidService).
 */
export class OutboxSfidGenerator {
  private readonly nodeId: bigint;
  private seq = 0;
  private lastMs = -1;

  constructor() {
    const raw = Number(process.env.AGENTIC_ENGINE_NODE_ID ?? 0) & MAX_NODE;
    this.nodeId = BigInt(raw);
  }

  next(): string {
    let now = Date.now();

    if (now < this.lastMs) {
      const drift = this.lastMs - now;
      if (drift > 5) {
        throw new Error(`[OutboxSfidGenerator] Clock regression detected: ${drift}ms. Refusing to generate ID.`);
      }
      now = this.lastMs;
    }

    if (now === this.lastMs) {
      this.seq = (this.seq + 1) & MAX_SEQ;
      if (this.seq === 0) {
        while (Date.now() <= this.lastMs) {
          /* spin */
        }
        now = Date.now();
        this.lastMs = now;
      }
    } else {
      this.seq = 0;
      this.lastMs = now;
    }

    const ts = BigInt(now) - SFID_EPOCH;
    const id = (ts << TIMESTAMP_SHIFT) | (this.nodeId << NODE_SHIFT) | BigInt(this.seq);
    return id.toString(10);
  }
}
