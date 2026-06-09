/**
 * LlmProviderIconStorePort
 * 供应商图标持久化平台端口。对齐 ghcloud ai-application 的图标流程：
 * 客户端先把图标上传到文件服务拿到 fileId，创建/更新供应商时传入 iconFileId，
 * 服务端据此把文件「induce」绑定到供应商并解析出可访问的图标地址。
 *
 * - ghcloud 实现（@cube-ai/platform-adapter-ghcloud）：cube2 文件 gRPC（fileInduceSingle + FileCore.getById）。
 * - 本地默认实现（llm-core）：无文件服务时仅透传 fallbackIconUrl、忽略 iconFileId。
 */

export interface ProviderIconPersistInput {
  /** 供应商主键（作为文件归属 businessKey）。 */
  providerId: string;
  /** 待绑定的文件 ID；为空表示不走文件服务、直接用 fallbackIconUrl。 */
  iconFileId: string | null;
  /** 未提供 iconFileId 时使用的图标地址。 */
  fallbackIconUrl: string | null;
}

export interface LlmProviderIconStorePort {
  persistProviderIcon(input: ProviderIconPersistInput, signal?: AbortSignal): Promise<string | null>;
}
