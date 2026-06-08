import { Injectable } from '@dangao/bun-server';

/**
 * Twitter Snowflake epoch (2010-11-04T01:42:54.657Z).
 * Using this epoch ensures IDs generated in 2024+ are exactly 19 decimal
 * digits long (41-bit relative timestamp × 2^22 ≈ 1.8e18 for current dates).
 *
 * ref: docs/technical-design/phase-1/P1-01-foundations.md §4.1
 */
const SFID_EPOCH = 1_288_834_974_657n;

/**
 * Bit widths per Snowflake specification (docs/detailed-design/00-foundations/
 * naming-and-db-conventions.md §2.1):
 *   41 bits  — millisecond timestamp (relative to SFID_EPOCH)
 *   10 bits  — machine node ID
 *   12 bits  — per-millisecond sequence number
 * Total = 63 bits → fits in BIGINT(20); decimal repr always 19 digits for dates
 * between ~2010 and 2079.
 */
const NODE_BITS = 10;
const SEQ_BITS = 12;
const MAX_NODE = (1 << NODE_BITS) - 1; // 1023
const MAX_SEQ = (1 << SEQ_BITS) - 1; // 4095
const NODE_SHIFT = BigInt(SEQ_BITS); // 12
const TIMESTAMP_SHIFT = BigInt(NODE_BITS + SEQ_BITS); // 22

@Injectable()
export class SfidService {
  private readonly nodeId: bigint;
  private seq = 0;
  private lastMs = -1;

  constructor() {
    const raw =
      Number(process.env.AGENTIC_ENGINE_NODE_ID ?? 0) & MAX_NODE;
    this.nodeId = BigInt(raw);
  }

  /**
   * Generate the next Snowflake ID as a 19-digit decimal string.
   * Thread-safe within a single Bun process (single-threaded event loop).
   *
   * @throws {Error} if the system clock moves backward by more than 5 ms.
   */
  next(): string {
    let now = Date.now();

    if (now < this.lastMs) {
      const drift = this.lastMs - now;
      if (drift > 5) {
        throw new Error(
          `[SfidService] Clock regression detected: ${drift}ms. Refusing to generate ID.`,
        );
      }
      // Small drift (≤5 ms) — spin until clock catches up
      now = this.lastMs;
    }

    if (now === this.lastMs) {
      this.seq = (this.seq + 1) & MAX_SEQ;
      if (this.seq === 0) {
        // Sequence exhausted within the same millisecond; busy-wait
        while (Date.now() <= this.lastMs) {
          // spin
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

  /**
   * Parse a Snowflake ID back into its constituent fields.
   * Useful for debugging and auditing.
   */
  parse(id: string): { timestamp: bigint; node: number; seq: number } {
    const n = BigInt(id);
    const seq = Number(n & BigInt(MAX_SEQ));
    const node = Number((n >> NODE_SHIFT) & BigInt(MAX_NODE));
    const ts = (n >> TIMESTAMP_SHIFT) + SFID_EPOCH;
    return { timestamp: ts, node, seq };
  }
}
