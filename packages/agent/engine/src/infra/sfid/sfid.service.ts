import { Injectable } from "@dangao/bun-server";

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

/**
 * Explicit node-id override `AGENTIC_ENGINE_NODE_ID` (设了就用、跳过 Redis 租约)。
 * 未设 / 非数值时返回 `undefined` —— **绝不静默默认 0**；由 bootstrap 的节点租约
 * 在启动时 `configureNode()`，仍拿不到唯一 id 就 fail-closed 拒绝出号。
 */
function readEnvNodeId(): number | undefined {
  const raw = process.env.AGENTIC_ENGINE_NODE_ID;
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

@Injectable()
export class SfidService {
  /**
   * `undefined` until a node id is assigned — either at construction (explicit
   * arg / `AGENTIC_ENGINE_NODE_ID` via {@link sharedSfidService}) or once at
   * bootstrap via a Redis node lease ({@link configureNode}).
   *
   * Fix A (串消息根因): 绝不静默默认 0。拿不到确定唯一的 nodeId 时 `next()`
   * 直接抛错 (fail-closed)，避免多副本都用 node 0 → sessionId 跨副本碰撞。
   */
  private nodeId: bigint | undefined;
  private seq = 0;
  private lastMs = -1;

  constructor(nodeId?: number) {
    const resolved = nodeId ?? readEnvNodeId();
    if (resolved !== undefined) {
      this.nodeId = BigInt(resolved & MAX_NODE);
    }
  }

  /** Whether a node id has been assigned and {@link next} can generate ids. */
  get isConfigured(): boolean {
    return this.nodeId !== undefined;
  }

  /**
   * Assign the process-wide node id exactly once (from a Redis node lease at
   * bootstrap). Idempotent for the same value; refuses a conflicting reassign
   * so a mis-wired second caller can never silently repartition the id space.
   */
  configureNode(nodeId: number): void {
    const next = BigInt(nodeId & MAX_NODE);
    if (this.nodeId !== undefined && this.nodeId !== next) {
      throw new Error(`[SfidService] node already configured to ${this.nodeId}; refusing to reassign to ${next}`);
    }
    this.nodeId = next;
  }

  /**
   * Generate the next Snowflake ID as a 19-digit decimal string.
   * Thread-safe within a single Bun process (single-threaded event loop).
   *
   * @throws {Error} if the node id has not been configured (fail-closed).
   * @throws {Error} if the system clock moves backward by more than 5 ms.
   */
  next(): string {
    const nodeId = this.nodeId;
    if (nodeId === undefined) {
      throw new Error(
        "[SfidService] nodeId not configured — refusing to generate SFID (fail-closed). " +
          "Acquire a node lease at bootstrap or set AGENTIC_ENGINE_NODE_ID.",
      );
    }

    let now = Date.now();

    if (now < this.lastMs) {
      const drift = this.lastMs - now;
      if (drift > 5) {
        throw new Error(`[SfidService] Clock regression detected: ${drift}ms. Refusing to generate ID.`);
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
    const id = (ts << TIMESTAMP_SHIFT) | (nodeId << NODE_SHIFT) | BigInt(this.seq);
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
