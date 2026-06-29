import type { ChunkType, RetrievalProfile } from "../../../common/document-types";

const TIMELINE_QUERY_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?\b/u;
const NAVIGATION_QUERY_PATTERN = /(目录|章节|第.{0,8}[章节]|小节|概述|简介|引言|附录|section|chapter|heading|标题)/iu;
const QUESTION_QUERY_PATTERN = /(如何|怎么|为什么|是否|能否|什么|多少|哪些|区别|原因|步骤|\?|？)/u;
const IDENTIFIER_QUERY_PATTERN = /[a-z0-9]+(?:[-_/.][a-z0-9]+)+/iu;
const MIXED_ENTITY_QUERY_PATTERN = /[\p{Script=Han}A-Za-z]*\d+[\p{Script=Han}A-Za-z0-9-]*/u;

export interface RetrievalProfileChunkLike {
  chunkType: ChunkType;
  sourceType?: string;
  headingPath?: string[];
  text?: string;
}

function normalizeForDecision(value: string): string {
  return value.normalize("NFKC").trim().replaceAll(/\s+/gu, " ");
}

function isLikelyEntityLookupQuery(query: string): boolean {
  const normalized = normalizeForDecision(query);
  if (
    normalized === "" ||
    QUESTION_QUERY_PATTERN.test(normalized) ||
    TIMELINE_QUERY_PATTERN.test(normalized) ||
    NAVIGATION_QUERY_PATTERN.test(normalized)
  ) {
    return false;
  }

  if (IDENTIFIER_QUERY_PATTERN.test(normalized) || MIXED_ENTITY_QUERY_PATTERN.test(normalized)) {
    return true;
  }

  const tokens = normalized.split(/\s+/u).filter(Boolean);
  return normalized.length <= 24 && tokens.length <= 3;
}

export function resolveQueryRetrievalProfile(query: string): RetrievalProfile {
  const normalized = normalizeForDecision(query);
  if (normalized === "") {
    return "semantic-qa";
  }
  if (TIMELINE_QUERY_PATTERN.test(normalized)) {
    return "timeline";
  }
  if (NAVIGATION_QUERY_PATTERN.test(normalized)) {
    return "navigation";
  }
  if (isLikelyEntityLookupQuery(normalized)) {
    return "entity-lookup";
  }
  return "semantic-qa";
}

export function resolveChunkRetrievalProfile(chunk: RetrievalProfileChunkLike): RetrievalProfile {
  if (chunk.chunkType === "table-row-window" || chunk.chunkType === "properties-group") {
    return "entity-lookup";
  }
  if (chunk.chunkType === "vtt-cue-window") {
    return "timeline";
  }

  const text = normalizeForDecision(chunk.text ?? "");
  const headingDepth = chunk.headingPath?.filter((entry) => entry.trim() !== "").length ?? 0;
  const sourceType = (chunk.sourceType ?? "").toLowerCase();

  if (
    (sourceType === "md" || sourceType === "markdown" || sourceType === "mdx") &&
    headingDepth > 0 &&
    text.length > 0 &&
    text.length <= 120
  ) {
    return "navigation";
  }

  return "semantic-qa";
}
