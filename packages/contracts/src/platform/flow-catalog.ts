import { z } from "zod";

/**
 * FlowCatalogPort — 列举 AI 中台已配置的 Flow，供 `platform.flow.list` 使用。
 * 与 `FlowInvokerPort` 分离：发现为只读 GET，与 ADR-0020 方案 C（先 list 再 invoke）对齐。
 *
 * ref: docs/adr/ADR-0020-platform-flow-sync-intent-routing.md
 */

export const FlowCatalogListRequestSchema = z.object({
  keyword: z.string().max(256).optional(),
  pageNumber: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
  tenant: z.number().int().min(0).max(2_147_483_647),
  traceId: z.string().min(1),
  userToken: z.string().min(1).optional(),
});
export type FlowCatalogListRequest = z.infer<typeof FlowCatalogListRequestSchema>;

export const FlowCatalogItemSchema = z.object({
  compileStatus: z.string().optional(),
  description: z.string().nullable().optional(),
  enabled: z.preprocess((v) => (typeof v === "number" ? v !== 0 : v), z.boolean().nullable().optional()),
  flowId: z.string().min(1),
  name: z.string(),
});
export type FlowCatalogItem = z.infer<typeof FlowCatalogItemSchema>;

export const FlowCatalogListPaginationSchema = z.object({
  currentPage: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  pages: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type FlowCatalogListPagination = z.infer<typeof FlowCatalogListPaginationSchema>;

export const FlowCatalogListResponseSchema = z.object({
  flows: z.array(FlowCatalogItemSchema),
  pagination: FlowCatalogListPaginationSchema.optional(),
});
export type FlowCatalogListResponse = z.infer<typeof FlowCatalogListResponseSchema>;

export interface FlowCatalogPort {
  list(req: FlowCatalogListRequest, signal: AbortSignal): Promise<FlowCatalogListResponse>;
}
