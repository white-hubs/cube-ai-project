import { Inject, Injectable } from "@dangao/bun-server";

import { APP_CONFIG_TOKEN, type AppConfig } from "../../../../config/app.config";
import { type ParsedDocumentChunk, type ParsedDocumentContent, type ParserInput } from "../../../common/document-types";

export interface DoclingClientOptions {
  baseUrl: string;
  timeoutMs: number;
  apiKey?: string;
  enablePictureDescription: boolean;
  maxChunkTokens: number;
}

interface DoclingChunkResponse {
  chunks?: unknown;
  documents?: unknown;
}

interface DoclingDocumentResult {
  content?: unknown;
}

interface DoclingRequestOptions {
  enablePictureDescription: boolean;
  maxChunkTokens: number;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

function pickFirstNumber(value: unknown): number | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const firstNumber = value.find((item): item is number => typeof item === "number" && Number.isFinite(item));
  return firstNumber ?? null;
}

function slugifySectionPart(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
}

function buildSectionId(headingPath: string[], pageNo: number | null): string {
  if (headingPath.length > 0) {
    const slug = slugifySectionPart(headingPath.join(" > "));
    if (slug !== "") {
      return `heading:${slug}`;
    }
  }
  if (typeof pageNo === "number") {
    return `page:${pageNo}`;
  }
  return "document-root";
}

function inferChunkType(metadata: Record<string, unknown>, captionText: string | null): ParsedDocumentChunk["chunkType"] {
  const candidates = [metadata.chunk_type, metadata.chunkType, metadata.kind, metadata.label, metadata.doc_item_label, metadata.item_type];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const normalized = candidate.toLowerCase();
    if (normalized.includes("table")) {
      return "table";
    }
    if (normalized.includes("picture") || normalized.includes("image") || normalized.includes("figure")) {
      return "picture";
    }
    if (normalized.includes("list")) {
      return "list";
    }
    if (normalized.includes("paragraph")) {
      return "paragraph";
    }
  }

  return captionText ? "picture" : "paragraph";
}

function extractPictureDescription(metadata: Record<string, unknown>): string | null {
  const candidates = [
    metadata.picture_description,
    metadata.pictureDescription,
    metadata.image_description,
    metadata.imageDescription,
    metadata.description,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate;
    }
  }

  return null;
}

function normalizeParsedChunk(chunk: unknown, orderInSection: number): ParsedDocumentChunk {
  const record = (chunk ?? {}) as Record<string, unknown>;
  const headingPath = normalizeStringArray(record.headings);
  const pageNo = pickFirstNumber(record.page_numbers);
  const captionText = normalizeStringArray(record.captions).join("\n").trim() || null;
  const metadata = typeof record.metadata === "object" && record.metadata !== null ? (record.metadata as Record<string, unknown>) : {};
  const embeddingText = typeof record.text === "string" ? record.text : "";
  const rawText = typeof record.raw_text === "string" ? record.raw_text : "";
  const displayText = rawText.trim() !== "" ? rawText : embeddingText;

  return {
    captionText,
    chunkIndex: typeof record.chunk_index === "number" ? record.chunk_index : 0,
    chunkType: inferChunkType(metadata, captionText),
    displayText,
    embeddingText,
    headingPath,
    orderInSection,
    pageNo,
    pictureDescription: extractPictureDescription(metadata),
    sectionId: buildSectionId(headingPath, pageNo),
  };
}

function extractDocumentText(documents: unknown, chunks: ParsedDocumentChunk[]): string {
  if (Array.isArray(documents)) {
    for (const document of documents) {
      const record = (document ?? {}) as DoclingDocumentResult;
      const content = typeof record.content === "object" && record.content !== null ? (record.content as Record<string, unknown>) : {};
      const candidates = [content.text_content, content.md_content, content.html_content, content.doctags_content];
      for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim() !== "") {
          return candidate;
        }
      }
    }
  }

  return chunks
    .map((chunk) => chunk.displayText)
    .filter((text) => text.trim() !== "")
    .join("\n\n");
}

function shouldRetryWithoutPictureDescription(status: number, message: string, enablePictureDescription: boolean): boolean {
  if (!enablePictureDescription) {
    return false;
  }

  const normalizedMessage = message.toLowerCase();
  return (
    status === 404 &&
    (normalizedMessage.includes("task result not found") ||
      normalizedMessage.includes("artifacts_path") ||
      normalizedMessage.includes("smolvlm") ||
      normalizedMessage.includes("picture description"))
  );
}

@Injectable()
export class DoclingClient {
  public constructor(
    @Inject(APP_CONFIG_TOKEN) private readonly config: AppConfig,
    private readonly overrides: Partial<DoclingClientOptions> = {},
  ) {}

  private resolveOptions(input?: ParserInput): DoclingClientOptions {
    const config = this.config;
    return {
      apiKey: this.overrides.apiKey ?? config.doclingApiKey,
      baseUrl: this.overrides.baseUrl ?? config.doclingBaseUrl,
      enablePictureDescription: this.overrides.enablePictureDescription ?? config.doclingEnablePictureDescription,
      maxChunkTokens: input?.chunkingOptions?.chunkSize ?? this.overrides.maxChunkTokens ?? config.ingestionChunkSize,
      timeoutMs: this.overrides.timeoutMs ?? config.doclingTimeoutMs,
    };
  }

  private buildRequestForm(input: ParserInput, options: DoclingRequestOptions): FormData {
    const form = new FormData();
    form.append("files", input.file, input.filename);
    form.set("target_type", "inbody");
    form.set("include_converted_doc", "true");
    form.set("convert_do_picture_description", String(options.enablePictureDescription));
    form.set("chunking_include_raw_text", "true");
    form.set("chunking_merge_peers", "true");
    form.set("chunking_max_tokens", String(options.maxChunkTokens));
    form.set("convert_do_table_structure", "false");
    form.set("convert_do_ocr", "false");
    return form;
  }

  private async requestDocling(
    input: ParserInput,
    options: DoclingClientOptions,
    enablePictureDescription: boolean,
  ): Promise<DoclingChunkResponse> {
    const headers: Record<string, string> = {};
    if (options.apiKey) {
      headers.Authorization = `Bearer ${options.apiKey}`;
    }

    const startedAt = Date.now();
    const response = await fetch(`${options.baseUrl.replace(/\/$/u, "")}/v1/chunk/hybrid/file`, {
      body: this.buildRequestForm(input, {
        enablePictureDescription,
        maxChunkTokens: options.maxChunkTokens,
      }),
      headers,
      method: "POST",
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
      const message = await response.text();
      console.warn(
        `[docling] hybrid failed file=${input.filename} status=${response.status} wallMs=${Date.now() - startedAt} pictureDescription=${enablePictureDescription}`,
      );
      if (shouldRetryWithoutPictureDescription(response.status, message, enablePictureDescription)) {
        return this.requestDocling(input, options, false);
      }
      throw new Error(`Docling 解析失败: ${response.status} ${message}`);
    }

    const payload = (await response.json()) as DoclingChunkResponse & { processing_time?: number };
    const chunkCount = Array.isArray(payload.chunks) ? payload.chunks.length : 0;
    console.info(
      `[docling] hybrid ok file=${input.filename} chunks=${chunkCount} wallMs=${Date.now() - startedAt} processingTime=${payload.processing_time ?? "n/a"} pictureDescription=${enablePictureDescription}`,
    );
    return payload;
  }

  public async parseAndChunk(input: ParserInput): Promise<ParsedDocumentContent> {
    const options = this.resolveOptions(input);
    const payload = await this.requestDocling(input, options, options.enablePictureDescription);
    const sourceType = input.mimeType || "docling";
    const sectionOrderMap = new Map<string, number>();
    const chunks = Array.isArray(payload.chunks)
      ? payload.chunks.map((chunk) => {
          const record = (chunk ?? {}) as Record<string, unknown>;
          const headingPath = normalizeStringArray(record.headings);
          const pageNo = pickFirstNumber(record.page_numbers);
          const sectionId = buildSectionId(headingPath, pageNo);
          const orderInSection = sectionOrderMap.get(sectionId) ?? 0;
          sectionOrderMap.set(sectionId, orderInSection + 1);

          const normalized = normalizeParsedChunk(chunk, orderInSection);
          return {
            ...normalized,
            sectionId,
          };
        })
      : [];
    const documentText = extractDocumentText(payload.documents, chunks);

    return {
      chunks,
      fileName: input.filename,
      sourceType,
      text: documentText,
    };
  }
}
