/**
 * Chunk 质量策略（成熟产品形态的 L0/L1）：
 * - 输出连续 qualityScore + reasons + role，而不是只写死 boolean
 * - indexable：能否进索引（硬门禁）
 * - retrievableByDefault：默认是否参与检索（软策略；封面/目录可入库但默认不召回）
 * - 阈值外置，可通过 createChunkQualityPolicy / AppConfig 覆盖
 */

import { type ChunkContentRole } from "./document-types";

export type { ChunkContentRole };

export type ChunkQualityReason =
  | "empty_text"
  | "placeholder_unknown"
  | "punctuation_only"
  | "toc_leader"
  | "low_information_density"
  | "cover_page"
  | "toc_section"
  | "header_footer_like";

export interface ChunkQualityPolicy {
  /** 有效字母数字最少个数；低于此值视为信息量不足 */
  minMeaningfulChars: number;
  /** qualityScore >= 该值才允许入库 */
  minScoreToIndex: number;
  /** qualityScore >= 该值且 role 默认可检索时，才进入默认召回 */
  minScoreToRetrieve: number;
}

export interface ChunkQualityInput {
  text: string;
  embeddingText?: string | null;
  headingPath?: string[] | null;
  pageNo?: number | null;
  chunkType?: string | null;
  sectionId?: string | null;
}

export interface ChunkQualityAssessment {
  qualityScore: number;
  reasons: ChunkQualityReason[];
  role: ChunkContentRole;
  indexable: boolean;
  retrievableByDefault: boolean;
}

export const DEFAULT_CHUNK_QUALITY_POLICY: ChunkQualityPolicy = {
  minMeaningfulChars: 4,
  minScoreToIndex: 0.25,
  minScoreToRetrieve: 0.35,
};

const UNKNOWN_EXACT = /^(?:<unknown>|unknown|null|n\/a|none|undefined)$/iu;
const TOC_OR_LEADER = /^(?:[\s.·•…⋯\-—_─=*＊※]+|\d+){2,}$/u;
const ONLY_PUNCT_OR_SPACE = /^[\s\p{P}\p{S}]+$/u;
const TOC_HEADING = /^(?:目\s*次|目录|contents|table\s+of\s+contents)$/iu;
const HEADER_FOOTER_HEADING = /^(?:页眉|页脚|header|footer)$/iu;

const HARD_DROP_REASONS: ReadonlySet<ChunkQualityReason> = new Set(["empty_text", "placeholder_unknown", "punctuation_only", "toc_leader"]);

export function createChunkQualityPolicy(overrides: Partial<ChunkQualityPolicy> = {}): ChunkQualityPolicy {
  return {
    ...DEFAULT_CHUNK_QUALITY_POLICY,
    ...overrides,
  };
}

export function chunkQualityPolicyFromConfig(config: {
  chunkQualityMinMeaningfulChars: number;
  chunkQualityMinScoreToIndex: number;
  chunkQualityMinScoreToRetrieve: number;
}): ChunkQualityPolicy {
  return createChunkQualityPolicy({
    minMeaningfulChars: config.chunkQualityMinMeaningfulChars,
    minScoreToIndex: config.chunkQualityMinScoreToIndex,
    minScoreToRetrieve: config.chunkQualityMinScoreToRetrieve,
  });
}

function countMeaningfulChars(text: string): number {
  return text.replaceAll(/[^\p{Letter}\p{Number}]+/gu, "").length;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return Number(value.toFixed(4));
}

function parseHeadingPath(raw: string[] | null | undefined): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function inferRole(input: ChunkQualityInput): ChunkContentRole {
  const chunkType = String(input.chunkType ?? "");
  if (chunkType === "table-row-window" || chunkType === "vtt-cue-window" || chunkType === "properties-group" || chunkType === "table") {
    return "structured";
  }

  const headings = parseHeadingPath(input.headingPath);
  const lastHeading = headings.at(-1)?.trim() ?? "";
  if (lastHeading !== "" && TOC_HEADING.test(lastHeading)) {
    return "toc";
  }
  if (lastHeading !== "" && HEADER_FOOTER_HEADING.test(lastHeading)) {
    return "header_footer";
  }

  const sectionId = String(input.sectionId ?? "");
  if (/^(?:heading:)?(?:目-?次|目录)/u.test(sectionId) || /toc/i.test(sectionId)) {
    return "toc";
  }

  if (input.pageNo === 1 && headings.length === 0) {
    return "cover";
  }

  return "body";
}

function finalizeAssessment(
  score: number,
  reasons: ChunkQualityReason[],
  role: ChunkContentRole,
  policy: ChunkQualityPolicy,
): ChunkQualityAssessment {
  const qualityScore = clamp01(score);
  const hardDrop = reasons.some((reason) => HARD_DROP_REASONS.has(reason));
  const indexable = !hardDrop && qualityScore >= policy.minScoreToIndex;
  const roleRetrievable = role === "body" || role === "structured";
  const retrievableByDefault = indexable && roleRetrievable && qualityScore >= policy.minScoreToRetrieve;

  return {
    indexable,
    qualityScore,
    reasons,
    retrievableByDefault,
    role,
  };
}

/** 评估单个 chunk 的质量与角色。 */
export function assessChunkQuality(
  input: ChunkQualityInput,
  policy: ChunkQualityPolicy = DEFAULT_CHUNK_QUALITY_POLICY,
): ChunkQualityAssessment {
  const trimmed = String(input.text ?? "").trim();
  const reasons: ChunkQualityReason[] = [];
  let role = inferRole(input);
  let score = 1;

  if (trimmed === "") {
    return finalizeAssessment(0, ["empty_text"], "noise", policy);
  }

  if (UNKNOWN_EXACT.test(trimmed)) {
    return finalizeAssessment(0, ["placeholder_unknown"], "noise", policy);
  }

  const withoutUnknown = trimmed.replaceAll(/<unknown>/giu, "").trim();
  if (withoutUnknown === "" || UNKNOWN_EXACT.test(withoutUnknown)) {
    return finalizeAssessment(0, ["placeholder_unknown"], "noise", policy);
  }

  if (TOC_OR_LEADER.test(trimmed)) {
    return finalizeAssessment(0.05, ["toc_leader"], "noise", policy);
  }

  if (ONLY_PUNCT_OR_SPACE.test(trimmed)) {
    return finalizeAssessment(0.05, ["punctuation_only"], "noise", policy);
  }

  const meaningful = countMeaningfulChars(withoutUnknown);
  if (meaningful < policy.minMeaningfulChars) {
    reasons.push("low_information_density");
    score = Math.min(score, (meaningful / Math.max(policy.minMeaningfulChars, 1)) * 0.3);
    role = role === "body" ? "noise" : role;
  } else if (meaningful < policy.minMeaningfulChars * 3) {
    // 信息量偏弱但不至于直接判死
    score = Math.min(score, 0.55 + meaningful / 100);
  }

  // 目录引导线：大量点线 + 极少有效字符
  if (meaningful < 12 && /[.…·⋯]{6,}/u.test(trimmed)) {
    reasons.push("toc_leader");
    score = Math.min(score, 0.08);
    role = "noise";
  }

  if (role === "toc") {
    reasons.push("toc_section");
    score = Math.min(score, 0.45);
  } else if (role === "cover") {
    reasons.push("cover_page");
    score = Math.min(score, 0.5);
  } else if (role === "header_footer") {
    reasons.push("header_footer_like");
    score = Math.min(score, 0.4);
  }

  return finalizeAssessment(score, reasons, role, policy);
}

/** @deprecated 兼容旧调用；请优先使用 assessChunkQuality */
export function isLowQualityChunkText(text: string, policy: ChunkQualityPolicy = DEFAULT_CHUNK_QUALITY_POLICY): boolean {
  return !assessChunkQuality({ text }, policy).indexable;
}

/** 是否应写入向量库（硬门禁）。 */
export function isIndexableChunk(chunk: ChunkQualityInput, policy: ChunkQualityPolicy = DEFAULT_CHUNK_QUALITY_POLICY): boolean {
  return assessChunkQuality(chunk, policy).indexable;
}

/** 默认检索是否应返回（软策略）。可吃 assessment 结果，或带 text 的原始 chunk。 */
export function isRetrievableChunk(
  chunk:
    | Pick<ChunkQualityAssessment, "retrievableByDefault" | "qualityScore">
    | (ChunkQualityInput & { retrievableByDefault?: boolean | null; qualityScore?: number | null; chunkRole?: string | null }),
  policy: ChunkQualityPolicy = DEFAULT_CHUNK_QUALITY_POLICY,
): boolean {
  if (typeof chunk.retrievableByDefault === "boolean") {
    if (!chunk.retrievableByDefault) {
      return false;
    }
    if (typeof chunk.qualityScore === "number" && Number.isFinite(chunk.qualityScore)) {
      return chunk.qualityScore >= policy.minScoreToRetrieve;
    }
    return true;
  }
  if (!("text" in chunk) || typeof chunk.text !== "string") {
    return false;
  }
  return assessChunkQuality(chunk, policy).retrievableByDefault;
}
