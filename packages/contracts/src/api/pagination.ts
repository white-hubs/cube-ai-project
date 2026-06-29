import { z } from "zod";

/**
 * Cursor-based pagination — request and response schemas.
 *
 * Regulation references:
 * - `01-api/README.md §6` — cursor pagination, NOT offset; default 20, max 100
 * - `01-api/README.md §6.2` — `nextCursor` / `hasMore` field names (camelCase)
 *
 * Design decision: cursor is an opaque base64url string containing the last
 * seen `(createTime, id)` tuple for stable ordering. Encoding/decoding is done
 * at the repository layer; contracts only validate that the field is a string
 * when present.
 */
export const CursorPaginationRequestSchema = z.object({
  /** Opaque cursor from a previous response; omit for the first page. */
  cursor: z.string().optional(),
  /** Maximum number of items to return. Default 20, max 100. */
  limit: z.number().int().min(1).max(100).default(20),
});
export type CursorPaginationRequest = z.infer<typeof CursorPaginationRequestSchema>;

export const CursorPaginationResponseSchema = z.object({
  /** Whether more items exist beyond this page. */
  hasMore: z.boolean(),
  /** Cursor for the next page; absent when `hasMore` is false (§6.2). */
  nextCursor: z.string().optional(),
});
export type CursorPaginationResponse = z.infer<typeof CursorPaginationResponseSchema>;

/**
 * Wraps a collection response with the standard cursor-page envelope.
 *
 * Usage:
 * ```ts
 * const response: PaginatedResponse<Session> = {
 *   items: [...],
 *   page: { nextCursor: '...', hasMore: true },
 * };
 * ```
 */
export interface PaginatedResponse<T> {
  items: T[];
  page: CursorPaginationResponse;
}

/**
 * Build a `PaginatedResponse` from a raw rows array.
 * Extracts the cursor from the last item using `getCursor` and trims to `limit`.
 *
 * @param rows       - raw items fetched (fetch limit+1 to detect hasMore)
 * @param limit      - the requested limit
 * @param getCursor  - function to extract the opaque cursor from an item
 */
export function buildPaginatedResponse<T>(rows: T[], limit: number, getCursor: (item: T) => string): PaginatedResponse<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const lastItem = items.at(-1);
  return {
    items,
    page: {
      hasMore,
      ...(hasMore && lastItem ? { nextCursor: getCursor(lastItem) } : {}),
    },
  };
}
