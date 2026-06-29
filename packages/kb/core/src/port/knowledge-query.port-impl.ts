import { Inject, Injectable } from "@dangao/bun-server";

import {
  type KnowledgeHit,
  type KnowledgeQueryPort,
  type KnowledgeQueryRequest,
  type KnowledgeQueryResponse,
} from "@cube-ai/contracts/platform";
import { tenantContextAls } from "@cube-ai/tenant-context";

import { type SearchItem } from "../modules/common/document-types";
import { RetrievalService } from "../modules/vector-store/services/retrieval.service";

/** tenant:number → projectId:string (ghcloud parity: numeric tenant id as string). */
export function mapTenantToProjectId(tenant: number): string {
  return String(tenant);
}

/** kbId → directoryId (M3 decision: kbId is directory id). */
export function mapKbIdsToDirectoryIds(kbIds: readonly string[] | undefined): string[] {
  if (!kbIds || kbIds.length === 0) {
    return [];
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of kbIds) {
    const id = raw.trim();
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function mapSearchItemToKnowledgeHit(item: SearchItem, kbId: string): KnowledgeHit {
  const snippet = (item.text && item.text.trim()) || "";
  const score = Math.min(1, Math.max(0, item.rankScore ?? item.score ?? 0));
  return {
    docId: item.documentId,
    kbId,
    link: undefined,
    score,
    snippet,
    title: item.fileName || item.headingPath?.at(-1),
  };
}

@Injectable()
export class KnowledgeQueryPortImpl implements KnowledgeQueryPort {
  constructor(@Inject(RetrievalService) private readonly retrievalService: RetrievalService) {}

  async query(req: KnowledgeQueryRequest, _signal: AbortSignal): Promise<KnowledgeQueryResponse> {
    const directoryIds = mapKbIdsToDirectoryIds(req.kbIds);
    if (directoryIds.length === 0) {
      return { hits: [], truncated: false };
    }

    const tenantId = mapTenantToProjectId(req.tenant);
    return tenantContextAls.run({ tenantId }, async () => {
      const perDirectory = await Promise.all(
        directoryIds.map(async (directoryId) => {
          const result = await this.retrievalService.searchByDirectory({
            directoryId,
            query: req.query,
            similarityThreshold: req.scoreThreshold,
            topK: req.topK,
          });
          return result.items.map((item) => mapSearchItemToKnowledgeHit(item, directoryId));
        }),
      );

      const hits = perDirectory
        .flat()
        .toSorted((left, right) => right.score - left.score)
        .slice(0, req.topK);

      return {
        hits,
        truncated: perDirectory.flat().length > req.topK,
      };
    });
  }
}
