import type { LlmProviderIconStorePort, ProviderIconPersistInput } from '@cube-ai/contracts/platform';

/**
 * 本地回退图标存储：无 cube2 文件服务时，忽略 iconFileId，直接透传 fallbackIconUrl。
 * ghcloud 环境改用 @cube-ai/platform-adapter-ghcloud 的 Cube2ProviderIconStore。
 */
export class LocalProviderIconStore implements LlmProviderIconStorePort {
  async persistProviderIcon(input: ProviderIconPersistInput): Promise<string | null> {
    return input.fallbackIconUrl?.trim() || null;
  }
}
