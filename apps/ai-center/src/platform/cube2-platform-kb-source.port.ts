/**
 * Implements PlatformKbSourcePort using cube2 content gRPC (KnowledgeBaseService)
 * + cube2 file gRPC (FileCoreService) to fetch source document bytes.
 *
 * Resolution of KB id: platformKbId is the string representation of the cube2
 * KnowledgeBase numeric id (int64). All files attached to that KB record are
 * returned as PlatformKbSourceDoc entries.
 */

import type { PlatformKbSourceDoc, PlatformKbSourcePort } from "@cube-ai/kb-core";
import { getFileCoreClient, getKnowledgeBaseClient } from "@cube-ai/platform-adapter-ghcloud";

function parsePlatformKbId(platformKbId: string): bigint {
  const normalized = platformKbId.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`cube2-platform-kb-source: invalid platformKbId '${platformKbId}' — must be a numeric string`);
  }
  return BigInt(normalized);
}

function parseExternalFileId(externalId: string): bigint {
  const normalized = externalId.trim();
  if (!/^\d+$/u.test(normalized)) {
    throw new Error(`cube2-platform-kb-source: invalid external file id '${externalId}' — must be a numeric string`);
  }
  return BigInt(normalized);
}

export class Cube2PlatformKbSourcePort implements PlatformKbSourcePort {
  public async listSourceDocs(platformKbId: string, signal?: AbortSignal): Promise<PlatformKbSourceDoc[]> {
    const kbClient = await getKnowledgeBaseClient();
    const detail = await kbClient.getKnowledgeBaseDetail({ id: parsePlatformKbId(platformKbId) }, { signal });

    if (!detail.id) {
      throw new Error(`cube2-platform-kb-source: KnowledgeBase not found for id='${platformKbId}'`);
    }

    const docs: PlatformKbSourceDoc[] = [];
    for (const fileVo of detail.fileList ?? []) {
      if (!fileVo.id) {
        continue;
      }
      docs.push(await this.fetchFileAsSourceDoc(String(fileVo.id), fileVo.name, signal));
    }

    return docs;
  }

  public async getSourceDocByExternalId(
    platformKbId: string,
    externalId: string,
    signal?: AbortSignal,
  ): Promise<PlatformKbSourceDoc | null> {
    const normalizedExternalId = externalId.trim();
    const kbClient = await getKnowledgeBaseClient();
    const detail = await kbClient.getKnowledgeBaseDetail({ id: parsePlatformKbId(platformKbId) }, { signal });

    if (!detail.id) {
      throw new Error(`cube2-platform-kb-source: KnowledgeBase not found for id='${platformKbId}'`);
    }

    const fileVo = (detail.fileList ?? []).find((file) => file.id !== undefined && String(file.id) === normalizedExternalId);
    if (!fileVo?.id) {
      return null;
    }

    return this.fetchFileAsSourceDoc(String(fileVo.id), fileVo.name, signal);
  }

  public async getSourceDocByKnowledgeBaseId(knowledgeBaseId: string, signal?: AbortSignal): Promise<PlatformKbSourceDoc | null> {
    const kbClient = await getKnowledgeBaseClient();
    const detail = await kbClient.getKnowledgeBaseDetail({ id: parsePlatformKbId(knowledgeBaseId) }, { signal });
    if (!detail.id) {
      return null;
    }

    const fileVo = (detail.fileList ?? []).find((file) => file.id !== undefined);
    if (!fileVo?.id) {
      return null;
    }

    return this.fetchFileAsSourceDoc(String(fileVo.id), fileVo.name, signal);
  }

  public async getSourceDocByFileId(externalId: string, signal?: AbortSignal): Promise<PlatformKbSourceDoc | null> {
    const fileId = parseExternalFileId(externalId);
    const fileClient = await getFileCoreClient();
    const fileResponse = await fileClient.getById({ id: fileId }, { signal });
    if (!fileResponse.file?.id) {
      return null;
    }

    return this.fetchFileAsSourceDoc(String(fileResponse.file.id), fileResponse.file.name, signal);
  }

  private async fetchFileAsSourceDoc(externalId: string, fileName: string | undefined, signal?: AbortSignal): Promise<PlatformKbSourceDoc> {
    const fileClient = await getFileCoreClient();
    const fileBytes = await fileClient.getFileByte({ id: BigInt(externalId) }, { signal });
    const resolvedFileName = fileName?.trim() || `file-${externalId}`;

    return {
      bytes: fileBytes.data,
      externalId,
      fileName: resolvedFileName,
      mimeType: undefined,
    };
  }
}
