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

export class KbClient {
  constructor(private readonly config: KbSdkConfig) {}

  async search(body: SearchBody): Promise<KnowledgeQueryResponse> {
    const raw = await kbRequestJson<unknown>(this.config, 'POST', '/search', body);
    return KnowledgeQueryResponseSchema.parse(raw);
  }
}

export function createKbClient(config: KbSdkConfig): KbClient {
  return new KbClient(config);
}
