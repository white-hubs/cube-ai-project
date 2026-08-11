export type DocumentStatus = "uploaded" | "parsing" | "indexed" | "failed" | "deleted" | "unsupported";

export type ImportJobStatus = "pending" | "processing" | "completed" | "failed" | "unsupported";

export type ParseStatus = "pending" | "success" | "failed" | "unsupported";

export type IndexStatus = "pending" | "success" | "failed" | "unsupported";

export type ChunkType = "paragraph" | "table" | "picture" | "list" | "text" | "table-row-window" | "vtt-cue-window" | "properties-group";

export type RetrievalProfile = "semantic-qa" | "entity-lookup" | "navigation" | "timeline";

/** 内容角色：影响默认是否可检索（封面/目录可入库但默认不召回） */
export type ChunkContentRole = "body" | "toc" | "cover" | "header_footer" | "noise" | "structured";

export interface ChunkSemanticMetadata {
  sheetName?: string | null;
  tableId?: string | null;
  rowStart?: number | null;
  rowEnd?: number | null;
  headers?: string[];
  keywords?: string[];
  startTime?: string | null;
  endTime?: string | null;
  cueIndex?: number | null;
  propertyNamespace?: string | null;
  retrievalProfile?: RetrievalProfile;
  /** 质量策略推断的内容角色 */
  chunkRole?: ChunkContentRole;
  /** 质量分 0~1 */
  qualityScore?: number;
  /** 质量原因码 */
  qualityReasons?: string[];
  /** 默认是否参与检索 */
  retrievableByDefault?: boolean;
}

export const DEFAULT_CHUNK_SEPARATOR = "\n\n";

export type TableChunkMode = "auto" | "row" | "window";

export type TextChunkMode = "auto" | "block" | "merge";

export interface ChunkingOptions {
  separator?: string;
  chunkSize?: number;
  chunkOverlap?: number;
  tableChunkMode?: TableChunkMode;
  textChunkMode?: TextChunkMode;
}

export interface ChunkDocumentInput {
  documentId: string;
  text: string;
  sourceType: string;
  fileName: string;
  tenantId: string | null;
  chunkingOptions?: ChunkingOptions;
}

export interface ParsedDocumentChunk extends ChunkSemanticMetadata {
  chunkIndex: number;
  displayText: string;
  embeddingText: string;
  sectionId: string;
  headingPath: string[];
  pageNo: number | null;
  chunkType: ChunkType;
  orderInSection: number;
  captionText: string | null;
  pictureDescription: string | null;
}

export interface TextChunkRecord extends ChunkSemanticMetadata {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  embeddingText: string;
  /** W3.5: hash(embeddingText + modelCode + instructionProfile + algoVersion) */
  embeddingFingerprint?: string;
  /** W3.1 staging/active generation. Missing means legacy data. */
  generationId?: string;
  tenantId: string | null;
  sourceType: string;
  fileName: string;
  sectionId: string;
  headingPath: string[];
  pageNo: number | null;
  chunkType: ChunkType;
  orderInSection: number;
  captionText: string | null;
  pictureDescription: string | null;
  /** W4.1 denormalized document metadata for dual-leg filters / Qdrant payload */
  docType?: string | null;
  lang?: string | null;
  tags?: string[] | null;
  aclGroupIds?: string[] | null;
  /** ISO / MySQL datetime string of document create_time */
  docCreatedAt?: string | null;
}

export interface ParsedDocumentContent {
  text: string;
  sourceType: string;
  fileName: string;
  chunks?: ParsedDocumentChunk[];
}

export interface ParserInput {
  file: File;
  filename: string;
  mimeType: string;
  chunkingOptions?: ChunkingOptions;
}

export interface SearchItem {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  text: string;
  fileName: string;
  sourceType: string;
  score: number;
  vectorScore?: number;
  rankScore?: number;
  sectionId?: string;
  headingPath?: string[];
  pageNo?: number | null;
  chunkType?: ChunkType;
  sheetName?: string | null;
  tableId?: string | null;
  rowStart?: number | null;
  rowEnd?: number | null;
  headers?: string[];
  keywords?: string[];
  startTime?: string | null;
  endTime?: string | null;
  cueIndex?: number | null;
  propertyNamespace?: string | null;
  retrievalProfile?: RetrievalProfile;
}

export interface ChunkPreviewItem extends ChunkSemanticMetadata {
  chunkId: string;
  chunkIndex: number;
  text: string;
  headingPath: string[];
  sectionId: string;
  pageNo: number | null;
  chunkType: ChunkType;
  orderInSection: number;
  charCount: number;
  /** 该分段被检索命中次数（仅已入库预览有统计；本地上传预览为 0） */
  recallCount: number;
}

export interface ChunkPreviewResult {
  items: ChunkPreviewItem[];
  chunkCount: number;
  /** Synchronous preview outcome. ready responses contain the completed preview items. */
  previewStatus: "ready" | "failed" | "unsupported";
  /**
   * By-id preview only: persisted pipeline state for an explicit failure/unsupported result.
   */
  documentStatus?: DocumentStatus;
  parseStatus?: ParseStatus;
  indexStatus?: IndexStatus;
  errorMessage?: string | null;
}

export interface DocumentChunkListItem extends ChunkSemanticMetadata {
  chunkId: string;
  chunkIndex: number;
  text: string;
  embeddingText: string;
  sectionId: string;
  headingPath: string[];
  pageNo: number | null;
  chunkType: ChunkType;
  orderInSection: number;
  captionText: string | null;
  pictureDescription: string | null;
  /** 分段正文字符数 */
  charCount: number;
  /** 该分段被检索命中次数（累计） */
  recallCount: number;
}

/** Read-only source detail returned to retrieval consumers. Internal embeddingText is intentionally excluded. */
export interface DocumentChunkDetail extends Omit<DocumentChunkListItem, "embeddingText"> {
  documentId: string;
  fileName: string;
  sourceType: string;
  docType?: string | null;
  lang?: string | null;
  tags?: string[];
}
