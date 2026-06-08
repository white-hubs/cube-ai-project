import { z } from 'zod';
import { SfidSchema } from '../common/ids';

/**
 * Public-facing tool descriptor (subset of full engine descriptor).
 * Only exposes fields safe for the client.
 * Ref: docs/detailed-design/08-sdk/contracts.md §3 (OQ-CONTRACTS-4)
 */
export const PublicToolDescriptorSchema = z.object({
  id:          SfidSchema,
  name:        z.string().max(128),
  displayName: z.string().max(200),
  summary:     z.string().max(512).nullable(),
  consent:     z.enum(['NEVER', 'ON_FIRST_USE', 'EACH_CALL', 'ADMIN_ONLY']),
  enabled:     z.boolean(),
});
export type PublicToolDescriptor = z.infer<typeof PublicToolDescriptorSchema>;
