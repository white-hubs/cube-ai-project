/**
 * W4.1 — shared dual-leg ACL + metadata filter builders.
 * MySQL lexical and Qdrant vector legs must apply the same policy.
 *
 * Legacy policy: NULL / empty `acl_group_ids` → tenant-visible.
 * Tagged docs require overlap with resolved allowedGroupIds (fail-closed when empty groups).
 */

import { resolveAllowedGroupIds, type KbAclIdentity } from "./resolve-allowed-group-ids";

export type { KbAclIdentity } from "./resolve-allowed-group-ids";
export { resolveAllowedGroupIds } from "./resolve-allowed-group-ids";

export type DocumentMetadataFilters = {
  /** Inclusive ISO-8601 lower bound on the source document creation time. */
  createdAtFrom?: string;
  /** Inclusive ISO-8601 upper bound on the source document creation time. */
  createdAtTo?: string;
  docType?: string;
  lang?: string;
  /** AND semantics: every listed tag must be present on the document/chunk. */
  tags?: string[];
};

export type DocumentAccessFilterInput = {
  identity?: KbAclIdentity | null;
  /** Already-resolved ids; when set, skips resolveAllowedGroupIds. */
  allowedGroupIds?: readonly string[];
  filters?: DocumentMetadataFilters | null;
};

export type SqlPredicate = {
  sql: string;
  params: unknown[];
};

function normalizeMetadataFilters(filters: DocumentMetadataFilters | null | undefined): DocumentMetadataFilters {
  if (!filters) {
    return {};
  }
  const docType = typeof filters.docType === "string" ? filters.docType.trim() : "";
  const lang = typeof filters.lang === "string" ? filters.lang.trim() : "";
  const createdAtFrom = typeof filters.createdAtFrom === "string" ? filters.createdAtFrom.trim() : "";
  const createdAtTo = typeof filters.createdAtTo === "string" ? filters.createdAtTo.trim() : "";
  const tags = Array.isArray(filters.tags)
    ? Array.from(
        new Set(
          filters.tags
            .filter((tag): tag is string => typeof tag === "string")
            .map((tag) => tag.trim())
            .filter((tag) => tag !== ""),
        ),
      )
    : [];
  return {
    ...(createdAtFrom !== "" ? { createdAtFrom } : {}),
    ...(createdAtTo !== "" ? { createdAtTo } : {}),
    ...(docType !== "" ? { docType } : {}),
    ...(lang !== "" ? { lang } : {}),
    ...(tags.length > 0 ? { tags } : {}),
  };
}

export function resolveAccessFilter(input: DocumentAccessFilterInput): {
  allowedGroupIds: string[];
  filters: DocumentMetadataFilters;
} {
  const allowedGroupIds =
    input.allowedGroupIds !== undefined
      ? Array.from(new Set(input.allowedGroupIds.map((id) => String(id).trim()).filter((id) => id !== "")))
      : resolveAllowedGroupIds(input.identity);
  return {
    allowedGroupIds,
    filters: normalizeMetadataFilters(input.filters),
  };
}

/** MySQL ACL predicate on denormalized `document_chunk.acl_group_ids_json` (or document_record). */
export function buildAclMysqlPredicate(allowedGroupIds: readonly string[]): SqlPredicate {
  // Empty overlap array never matches tagged docs; NULL/empty ACL still passes.
  return {
    params: [JSON.stringify([...allowedGroupIds])],
    sql: `(acl_group_ids_json IS NULL OR JSON_LENGTH(COALESCE(acl_group_ids_json, JSON_ARRAY())) = 0 OR JSON_OVERLAPS(acl_group_ids_json, CAST(? AS JSON)))`,
  };
}

/** MySQL metadata AND filters on denormalized chunk columns. */
export function buildMetadataMysqlPredicate(filters: DocumentMetadataFilters | null | undefined): SqlPredicate {
  const normalized = normalizeMetadataFilters(filters);
  const parts: string[] = [];
  const params: unknown[] = [];
  if (normalized.createdAtFrom) {
    parts.push("doc_created_at >= ?");
    params.push(new Date(normalized.createdAtFrom));
  }
  if (normalized.createdAtTo) {
    parts.push("doc_created_at <= ?");
    params.push(new Date(normalized.createdAtTo));
  }
  if (normalized.docType) {
    parts.push("doc_type = ?");
    params.push(normalized.docType);
  }
  if (normalized.lang) {
    parts.push("lang = ?");
    params.push(normalized.lang);
  }
  for (const tag of normalized.tags ?? []) {
    parts.push("JSON_CONTAINS(COALESCE(tags_json, JSON_ARRAY()), CAST(? AS JSON), '$')");
    params.push(JSON.stringify(tag));
  }
  if (parts.length === 0) {
    return { params: [], sql: "" };
  }
  return { params, sql: parts.join(" AND ") };
}

export function buildDocumentAccessMysqlPredicate(input: DocumentAccessFilterInput): SqlPredicate {
  const { allowedGroupIds, filters } = resolveAccessFilter(input);
  const acl = buildAclMysqlPredicate(allowedGroupIds);
  const meta = buildMetadataMysqlPredicate(filters);
  const parts = [acl.sql, meta.sql].filter((part) => part !== "");
  return {
    params: [...acl.params, ...meta.params],
    sql: parts.join(" AND "),
  };
}

/**
 * Qdrant nested must-clause: legacy empty/missing ACL OR MatchAny allowed groups.
 * Nested as a single Filter object inside outer `must`.
 *
 * Qdrant uses plain `should` (OR / at least one). Do NOT use Elasticsearch's
 * `minimum_should_match` — that field is rejected with HTTP 400 Bad Request.
 */
export function buildAclQdrantMustClause(allowedGroupIds: readonly string[]): Record<string, unknown> {
  const should: Record<string, unknown>[] = [{ is_null: { key: "aclGroupIds" } }, { is_empty: { key: "aclGroupIds" } }];
  if (allowedGroupIds.length > 0) {
    should.push({
      key: "aclGroupIds",
      match: { any: [...allowedGroupIds] },
    });
  }
  return { should };
}

export function buildMetadataQdrantMustClauses(filters: DocumentMetadataFilters | null | undefined): Record<string, unknown>[] {
  const normalized = normalizeMetadataFilters(filters);
  const must: Record<string, unknown>[] = [];
  if (normalized.createdAtFrom || normalized.createdAtTo) {
    must.push({
      key: "createdAt",
      range: {
        ...(normalized.createdAtFrom ? { gte: normalized.createdAtFrom } : {}),
        ...(normalized.createdAtTo ? { lte: normalized.createdAtTo } : {}),
      },
    });
  }
  if (normalized.docType) {
    must.push({ key: "docType", match: { value: normalized.docType } });
  }
  if (normalized.lang) {
    must.push({ key: "lang", match: { value: normalized.lang } });
  }
  for (const tag of normalized.tags ?? []) {
    must.push({ key: "tags", match: { value: tag } });
  }
  return must;
}

export function buildDocumentAccessQdrantMustClauses(input: DocumentAccessFilterInput): Record<string, unknown>[] {
  const { allowedGroupIds, filters } = resolveAccessFilter(input);
  return [buildAclQdrantMustClause(allowedGroupIds), ...buildMetadataQdrantMustClauses(filters)];
}
