import { Injectable } from '@dangao/bun-server';

/**
 * Inline vs external snapshot storage decision.
 *
 * ADR-0012 §D2 defines the inline threshold as 2 KB for the *contextual
 * session snapshot storage mode* (separate from the 4 MiB agent snapshot
 * REJECT guard in snapshot-binding.md §4.1).
 *
 * ref: docs/adr/ADR-0012-session-snapshot-inline.md
 *      docs/detailed-design/05-session/snapshot-binding.md §4.1
 *      P1-06 design doc §3.5 / §6.3
 */
@Injectable()
export class SnapshotDecision {
  /** 2 KiB inline threshold (ADR-0012 §D2) */
  static readonly INLINE_THRESHOLD_BYTES = 2 * 1024;

  /**
   * Decide storage mode based on JSON-serialised byte length (UTF-8).
   * Returns 'inline' when size ≤ 2048 bytes; 'external' otherwise.
   * External path (Redis Stream) is implemented in Phase 3.
   */
  decide(payload: object): 'inline' | 'external' {
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    return bytes <= SnapshotDecision.INLINE_THRESHOLD_BYTES ? 'inline' : 'external';
  }
}
