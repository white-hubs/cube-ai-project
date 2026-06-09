/**
 * Implements PlatformKbSourcePort using cube2 content gRPC (KnowledgeBaseService)
 * + cube2 file gRPC (FileCoreService) to fetch source document bytes.
 *
 * Resolution of KB id: platformKbId is the string representation of the cube2
 * KnowledgeBase numeric id (int64). All files attached to that KB record are
 * returned as PlatformKbSourceDoc entries.
 */

import { getFileCoreClient, getKnowledgeBaseClient } from '@cube-ai/platform-adapter-ghcloud'
import type { PlatformKbSourceDoc, PlatformKbSourcePort } from '@cube-ai/kb-core'

function parsePlatformKbId(platformKbId: string): bigint {
  const normalized = platformKbId.trim()
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`cube2-platform-kb-source: invalid platformKbId '${platformKbId}' — must be a numeric string`)
  }
  return BigInt(normalized)
}

export class Cube2PlatformKbSourcePort implements PlatformKbSourcePort {
  public async listSourceDocs(platformKbId: string, signal?: AbortSignal): Promise<PlatformKbSourceDoc[]> {
    const kbClient = await getKnowledgeBaseClient()
    const detail = await kbClient.getKnowledgeBaseDetail(
      { id: parsePlatformKbId(platformKbId) },
      { signal },
    )

    if (!detail.id) {
      throw new Error(`cube2-platform-kb-source: KnowledgeBase not found for id='${platformKbId}'`)
    }

    const fileClient = await getFileCoreClient()
    const docs: PlatformKbSourceDoc[] = []

    for (const fileVo of detail.fileList ?? []) {
      if (!fileVo.id) continue

      const fileBytes = await fileClient.getFileByte({ id: fileVo.id }, { signal })
      const fileName = fileVo.name?.trim() || `file-${String(fileVo.id)}`

      docs.push({
        externalId: String(fileVo.id),
        fileName,
        bytes: fileBytes.data,
        mimeType: undefined,
      })
    }

    return docs
  }
}
