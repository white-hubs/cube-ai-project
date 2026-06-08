import { z } from 'zod';
import { EpochMsSchema } from '../common/time';

/**
 * SSE event envelope (aligned with 01-api/session.md §15 event dictionary).
 * `schema` is `lowercase-kebab-v{N}` per regulation §5.2 example.
 *
 * NOTE: P1-01 originally defined Phase-0a-style `TurnStartedEventSchema` /
 * `PingEventSchema` placeholders here. They are now superseded by the
 * canonical 13-event union in `./events.ts` (P1-09, aligned with
 * `docs/detailed-design/08-sdk/contracts.md` §4.3). This module retains
 * only the `SseEventBaseSchema` envelope, which downstream extensions
 * may keep using as a building block.
 */
export const SseEventBaseSchema = z.object({
  id: z.string(),
  event: z.string(),
  schema: z.string().regex(/^[a-z][a-z0-9-]*-v\d+$/),
  time: EpochMsSchema,
});
export type SseEventBase = z.infer<typeof SseEventBaseSchema>;
