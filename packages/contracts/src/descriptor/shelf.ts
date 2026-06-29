import { z } from "zod";

export const ShelfSourceSchema = z.enum(["authored", "ref", "copy"]);
export type ShelfSource = z.infer<typeof ShelfSourceSchema>;

export const InstallRequestSchema = z.object({
  mode: z.enum(["ref", "copy"]).default("ref"),
  pin: z.boolean().default(false),
  ref: z.string(),
});
export type InstallRequest = z.infer<typeof InstallRequestSchema>;

export const ShelfEntryViewSchema = z.object({
  displayName: z.string().optional(),
  effectiveVersionNo: z.number().int().nullable(),
  enabled: z.boolean(),
  id: z.string(),
  pinVersionNo: z.number().int().nullable(),
  runnableStatus: z.enum(["runnable", "disabled", "unresolvable"]),
  source: ShelfSourceSchema,
  targetId: z.string(),
  targetKind: z.enum(["agent", "skill"]),
});
export type ShelfEntryView = z.infer<typeof ShelfEntryViewSchema>;

export const ShelfPatchSchema = z.object({
  enabled: z.boolean().optional(),
  pin: z.boolean().optional(),
});
export type ShelfPatch = z.infer<typeof ShelfPatchSchema>;
