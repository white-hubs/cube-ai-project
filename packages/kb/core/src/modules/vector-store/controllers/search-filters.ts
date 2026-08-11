import { BadRequestException } from "@dangao/bun-server";

import type { DocumentMetadataFilters } from "../access/document-access-filter";

const ALLOWED_FILTER_FIELDS = new Set(["createdAtFrom", "createdAtTo", "docType", "lang", "tags"]);

function parseIsoDate(value: unknown, field: "createdAtFrom" | "createdAtTo"): string {
  const isoTimestamp =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value.trim());
  if (!isoTimestamp) {
    throw new BadRequestException(`filters.${field} must be an ISO-8601 timestamp when provided`);
  }
  const timestamp = Date.parse(value.trim());
  if (!Number.isFinite(timestamp)) {
    throw new BadRequestException(`filters.${field} must be an ISO-8601 timestamp when provided`);
  }
  return new Date(timestamp).toISOString();
}

/**
 * Parse optional search metadata filters from request body.
 * Rejects client-supplied ACL fields (`allowedGroupIds` / `aclGroupIds`) — ACL is server-injected only.
 */
export function parseSearchMetadataFilters(raw: unknown): DocumentMetadataFilters | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new BadRequestException("filters must be an object when provided");
  }
  const record = raw as Record<string, unknown>;
  if ("allowedGroupIds" in record || "aclGroupIds" in record || "groupIds" in record) {
    throw new BadRequestException("filters must not include allowedGroupIds/aclGroupIds/groupIds; ACL is server-injected");
  }
  const unknownFields = Object.keys(record).filter((field) => !ALLOWED_FILTER_FIELDS.has(field));
  if (unknownFields.length > 0) {
    throw new BadRequestException(`unsupported filters: ${unknownFields.toSorted().join(", ")}`);
  }

  const filters: DocumentMetadataFilters = {};
  if (record.createdAtFrom !== undefined) {
    filters.createdAtFrom = parseIsoDate(record.createdAtFrom, "createdAtFrom");
  }
  if (record.createdAtTo !== undefined) {
    filters.createdAtTo = parseIsoDate(record.createdAtTo, "createdAtTo");
  }
  if (filters.createdAtFrom && filters.createdAtTo && filters.createdAtFrom > filters.createdAtTo) {
    throw new BadRequestException("filters.createdAtFrom must be earlier than or equal to filters.createdAtTo");
  }
  if (record.docType !== undefined) {
    if (typeof record.docType !== "string" || record.docType.trim() === "") {
      throw new BadRequestException("filters.docType must be a non-empty string when provided");
    }
    filters.docType = record.docType.trim();
  }
  if (record.lang !== undefined) {
    if (typeof record.lang !== "string" || record.lang.trim() === "") {
      throw new BadRequestException("filters.lang must be a non-empty string when provided");
    }
    filters.lang = record.lang.trim();
  }
  if (record.tags !== undefined) {
    if (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== "string" || tag.trim() === "")) {
      throw new BadRequestException("filters.tags must be an array of non-empty strings when provided");
    }
    filters.tags = record.tags.map((tag) => (tag as string).trim());
  }

  if (!filters.createdAtFrom && !filters.createdAtTo && !filters.docType && !filters.lang && (!filters.tags || filters.tags.length === 0)) {
    return undefined;
  }
  return filters;
}
