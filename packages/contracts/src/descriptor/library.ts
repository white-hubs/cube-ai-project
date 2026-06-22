import { z } from 'zod';

export const LibrarySourceTierSchema = z.enum(['tenant', 'system']);
export type LibrarySourceTier = z.infer<typeof LibrarySourceTierSchema>;

const LibraryItemBaseSchema = z.object({
  ref: z.string(),
  kind: z.enum(['agent', 'skill']),
  displayName: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

const TenantLibraryItemViewSchema = LibraryItemBaseSchema.extend({
  tier: z.literal('tenant'),
  sharedVersionNo: z.number().int().optional(),
  content: z.unknown().optional(),
});

const SystemLibraryItemViewSchema = LibraryItemBaseSchema.extend({
  tier: z.literal('system'),
  sharedVersionNo: z.undefined().optional(),
  content: z.undefined().optional(),
});

export const LibraryItemViewSchema = z.discriminatedUnion('tier', [
  TenantLibraryItemViewSchema,
  SystemLibraryItemViewSchema,
]);
export type LibraryItemView = z.infer<typeof LibraryItemViewSchema>;

export const PluginCatalogItemViewSchema = z.object({
  toolName: z.string(),
  displayName: z.string().optional(),
  description: z.string().optional(),
  tags: z.array(z.string()).optional(),
  installed: z.boolean(),
});
export type PluginCatalogItemView = z.infer<typeof PluginCatalogItemViewSchema>;

export const AvailableToolViewSchema = z.object({
  toolName: z.string(),
  enabled: z.boolean(),
});
export type AvailableToolView = z.infer<typeof AvailableToolViewSchema>;

export const InstallToolRequestSchema = z.object({
  toolName: z.string(),
});
export type InstallToolRequest = z.infer<typeof InstallToolRequestSchema>;
