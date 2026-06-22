import { z } from 'zod';

export const ShelfSourceSchema = z.enum(['authored', 'ref', 'copy']);
export type ShelfSource = z.infer<typeof ShelfSourceSchema>;

export const InstallRequestSchema = z.object({
  ref: z.string(),
  mode: z.enum(['ref', 'copy']).default('ref'),
  pin: z.boolean().default(false),
});
export type InstallRequest = z.infer<typeof InstallRequestSchema>;

export const ShelfEntryViewSchema = z.object({
  id: z.string(),
  targetKind: z.enum(['agent', 'skill']),
  targetId: z.string(),
  source: ShelfSourceSchema,
  pinVersionNo: z.number().int().nullable(),
  enabled: z.boolean(),
  displayName: z.string().optional(),
  effectiveVersionNo: z.number().int().nullable(),
  runnableStatus: z.enum(['runnable', 'disabled', 'unresolvable']),
});
export type ShelfEntryView = z.infer<typeof ShelfEntryViewSchema>;

export const ShelfPatchSchema = z.object({
  enabled: z.boolean().optional(),
  pin: z.boolean().optional(),
});
export type ShelfPatch = z.infer<typeof ShelfPatchSchema>;
