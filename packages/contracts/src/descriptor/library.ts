import { z } from "zod";

export const LibrarySourceTierSchema = z.enum(["tenant", "system"]);
export type LibrarySourceTier = z.infer<typeof LibrarySourceTierSchema>;

const LibraryItemBaseSchema = z.object({
  description: z.string().optional(),
  displayName: z.string().optional(),
  kind: z.enum(["agent", "skill"]),
  ref: z.string(),
  tags: z.array(z.string()).optional(),
});

const TenantLibraryItemViewSchema = LibraryItemBaseSchema.extend({
  content: z.unknown().optional(),
  sharedVersionNo: z.number().int().optional(),
  tier: z.literal("tenant"),
});

const SystemLibraryItemViewSchema = LibraryItemBaseSchema.extend({
  content: z.undefined().optional(),
  sharedVersionNo: z.undefined().optional(),
  tier: z.literal("system"),
});

export const LibraryItemViewSchema = z.discriminatedUnion("tier", [TenantLibraryItemViewSchema, SystemLibraryItemViewSchema]);
export type LibraryItemView = z.infer<typeof LibraryItemViewSchema>;

export const PluginCatalogItemViewSchema = z.object({
  description: z.string().optional(),
  displayName: z.string().optional(),
  installed: z.boolean(),
  tags: z.array(z.string()).optional(),
  toolName: z.string(),
});
export type PluginCatalogItemView = z.infer<typeof PluginCatalogItemViewSchema>;

export const AvailableToolViewSchema = z.object({
  enabled: z.boolean(),
  toolName: z.string(),
});
export type AvailableToolView = z.infer<typeof AvailableToolViewSchema>;

export const InstallToolRequestSchema = z.object({
  toolName: z.string(),
});
export type InstallToolRequest = z.infer<typeof InstallToolRequestSchema>;
