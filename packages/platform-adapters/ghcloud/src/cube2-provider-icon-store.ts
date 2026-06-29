/**
 * Cube2ProviderIconStore — ghcloud implementation of LlmProviderIconStorePort.
 *
 * Mirrors the persistProviderIcon logic from:
 *   ghcloud/prod/cube-services/ai-application/src/services/llm-catalog.service.ts
 *
 * Flow:
 *   1. iconFileId 为空 → 直接返回 fallbackIconUrl（trim 后空则 null）。
 *   2. iconFileId 非纯数字串 → throw BadRequestException('iconFileId 非法')。
 *   3. FileOperateService.fileInduceSingle({ sceneCode, businessKey, fileId })
 *      → value !== true → throw HttpException(500, '供应商图标持久化失败')。
 *   4. FileCoreService.getById({ id: fileId })
 *      → endpointPath || path || name || fallbackIconUrl；空则抛异常。
 */

import { BadRequestException, HttpException } from "@dangao/bun-server";

import type { LlmProviderIconStorePort, ProviderIconPersistInput } from "@cube-ai/contracts/platform";

import type { Cube2FileClients } from "./cube2-file-client";

const PROVIDER_ICON_SCENE_CODE = "AI_APPLICATION::LLM_PROVIDER::ICON";

export class Cube2ProviderIconStore implements LlmProviderIconStorePort {
  constructor(private readonly fileClients: Cube2FileClients) {}

  async persistProviderIcon(input: ProviderIconPersistInput, signal?: AbortSignal): Promise<string | null> {
    const iconFileId = parseOptionalFileId(input.iconFileId);
    const normalizedFallbackIconUrl = input.fallbackIconUrl?.trim() || null;

    if (iconFileId === null || iconFileId === undefined) {
      return normalizedFallbackIconUrl;
    }

    const providerId = BigInt(input.providerId);

    const fileOperateClient = await this.fileClients.getFileOperateClient();
    const induceResponse = await fileOperateClient.fileInduceSingle(
      {
        businessKey: providerId,
        fileId: iconFileId,
        sceneCode: PROVIDER_ICON_SCENE_CODE,
      },
      { signal },
    );

    if (induceResponse.value !== true) {
      throw new HttpException(500, "供应商图标持久化失败");
    }

    const fileCoreClient = await this.fileClients.getFileCoreClient();
    const fileResponse = await fileCoreClient.getById({ id: iconFileId }, { signal });

    const persistedIconUrl =
      fileResponse.file?.endpointPath?.trim() ||
      fileResponse.file?.path?.trim() ||
      fileResponse.file?.name?.trim() ||
      normalizedFallbackIconUrl;

    if (!persistedIconUrl) {
      throw new HttpException(500, "供应商图标地址解析失败");
    }

    return persistedIconUrl;
  }
}

function parseOptionalFileId(raw: string | null | undefined): bigint | null {
  const normalized = raw?.trim();
  if (!normalized) {
    return null;
  }
  if (!/^\d+$/u.test(normalized)) {
    throw new BadRequestException("iconFileId 非法");
  }
  return BigInt(normalized);
}
