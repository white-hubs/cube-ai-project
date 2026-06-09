import {
  KnowledgeQueryResponseSchema,
  type KnowledgeQueryResponse,
} from '@cube-ai/contracts/platform';
import { kbRequestJson, type KbSdkConfig } from './http';

export interface SearchBody {
  query: string;
  topK?: number;
  documentId?: string;
  similarityThreshold?: number;
}

export interface SearchByDocumentsBody {
  query: string;
  documents: Array<{
    documentId: string;
    topK?: number;
    similarityThreshold?: number;
  }>;
}

export interface SearchByDirectoryBody {
  query: string;
  directoryId: string;
  topK?: number;
  similarityThreshold?: number;
}

export class KbClient {
  constructor(private readonly config: KbSdkConfig) {}

  async search(body: SearchBody): Promise<KnowledgeQueryResponse> {
    const raw = await kbRequestJson<unknown>(this.config, 'POST', '/search', body);
    return KnowledgeQueryResponseSchema.parse(raw);
  }

  async searchByDocuments(body: SearchByDocumentsBody): Promise<KnowledgeQueryResponse> {
    const raw = await kbRequestJson<unknown>(this.config, 'POST', '/search/by-documents', body);
    return KnowledgeQueryResponseSchema.parse(raw);
  }

  async searchByDirectory(body: SearchByDirectoryBody): Promise<KnowledgeQueryResponse> {
    const raw = await kbRequestJson<unknown>(this.config, 'POST', '/search/by-directory', body);
    return KnowledgeQueryResponseSchema.parse(raw);
  }
}

export function createKbClient(config: KbSdkConfig): KbClient {
  return new KbClient(config);
}
