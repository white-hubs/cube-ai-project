import { createHash } from "node:crypto";

/**
 * Fingerprint algorithm version (W3.5-H4).
 * Bump when chunk/prefix/normalization algo changes so stored fingerprints invalidate.
 */
export const EMBEDDING_FINGERPRINT_ALGO_VERSION = "v1" as const;

export type EmbeddingFingerprintAlgoVersion = typeof EMBEDDING_FINGERPRINT_ALGO_VERSION | (string & {});

export interface EmbeddingFingerprintInput {
  embeddingText: string;
  modelCode: string;
  /** Instruction / retrieval profile that affects embed behavior (e.g. semantic-qa). */
  instructionProfile: string;
  algoVersion?: EmbeddingFingerprintAlgoVersion;
}

/** sha256 hex of source document bytes (or UTF-8 text). */
export function computeContentChecksum(content: Uint8Array | ArrayBuffer | string): string {
  const hash = createHash("sha256");
  if (typeof content === "string") {
    hash.update(content, "utf8");
  } else if (content instanceof ArrayBuffer) {
    hash.update(new Uint8Array(content));
  } else {
    hash.update(content);
  }
  return hash.digest("hex");
}

/**
 * Chunk embedding fingerprint:
 * `hash(embeddingText + modelCode + instructionProfile + algoVersion)`.
 */
export function computeEmbeddingFingerprint(input: EmbeddingFingerprintInput): string {
  const algoVersion = input.algoVersion ?? EMBEDDING_FINGERPRINT_ALGO_VERSION;
  const material = [input.embeddingText, input.modelCode, input.instructionProfile, algoVersion].join("\0");
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export interface ChunkFingerprintDiff {
  /** Chunks whose fingerprint is new or changed — need re-embed. */
  toEmbed: string[];
  /** Existing chunkIds absent from next set — delete from store. */
  toDelete: string[];
  /** Fingerprint unchanged — skip embed. */
  unchanged: string[];
}

/** Pure fingerprint set-diff by chunkId (W3.5 incremental re-embed). */
export function diffChunksByFingerprint(
  existing: Iterable<{ chunkId: string; embeddingFingerprint: string | null | undefined }>,
  next: Iterable<{ chunkId: string; embeddingFingerprint: string }>,
): ChunkFingerprintDiff {
  const existingMap = new Map<string, string | null | undefined>();
  for (const row of existing) {
    if (row.chunkId !== "") {
      existingMap.set(row.chunkId, row.embeddingFingerprint);
    }
  }
  const nextIds = new Set<string>();
  const toEmbed: string[] = [];
  const unchanged: string[] = [];
  for (const row of next) {
    if (row.chunkId === "") {
      continue;
    }
    nextIds.add(row.chunkId);
    const prev = existingMap.get(row.chunkId);
    if (prev != null && prev !== "" && prev === row.embeddingFingerprint) {
      unchanged.push(row.chunkId);
    } else {
      toEmbed.push(row.chunkId);
    }
  }
  const toDelete: string[] = [];
  for (const chunkId of existingMap.keys()) {
    if (!nextIds.has(chunkId)) {
      toDelete.push(chunkId);
    }
  }
  return {
    toDelete: toDelete.toSorted(),
    toEmbed: toEmbed.toSorted(),
    unchanged: unchanged.toSorted(),
  };
}
