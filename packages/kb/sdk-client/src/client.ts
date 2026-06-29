import { type KbSdkConfig, kbRequestJson } from "./http";

export interface SearchBody {
  query: string;
  topK?: number;
  documentId?: string;
  similarityThreshold?: number;
}

export interface SearchByDocumentsBody {
  query: string;
  documents: {
    documentId: string;
    topK?: number;
    similarityThreshold?: number;
  }[];
}

export interface SearchByDirectoryBody {
  query: string;
  directoryId: string;
  topK?: number;
  similarityThreshold?: number;
}

/** kb-core 检索接口返回的单个 chunk 条目（字段与 retrieval.service.ts SearchItem 对齐）。 */
export interface KbSearchItem {
  text?: string | null;
  score?: number | null;
  headingPath?: string[] | null;
  keywords?: string[] | null;
  headers?: string[] | null;
  chunkId?: string | null;
  chunkIndex?: number | null;
  documentId?: string | null;
  sectionId?: string | null;
  [key: string]: unknown;
}

/** kb-core 检索接口的真实响应格式：`{ items: KbSearchItem[] }`。 */
export interface KbSearchResult {
  items: KbSearchItem[];
}

export class KbClient {
  constructor(private readonly config: KbSdkConfig) {}

  async search(body: SearchBody): Promise<KbSearchResult> {
    const raw = await kbRequestJson<{ items?: KbSearchItem[] }>(this.config, "POST", "/search", body);
    return { items: (raw as { items?: KbSearchItem[] }).items ?? [] };
  }

  async searchByDocuments(body: SearchByDocumentsBody): Promise<KbSearchResult> {
    const raw = await kbRequestJson<{ items?: KbSearchItem[] }>(this.config, "POST", "/search/by-documents", body);
    return { items: (raw as { items?: KbSearchItem[] }).items ?? [] };
  }

  async searchByDirectory(body: SearchByDirectoryBody): Promise<KbSearchResult> {
    const raw = await kbRequestJson<{ items?: KbSearchItem[] }>(this.config, "POST", "/search/by-directory", body);
    return { items: (raw as { items?: KbSearchItem[] }).items ?? [] };
  }
}

export function createKbClient(config: KbSdkConfig): KbClient {
  return new KbClient(config);
}
