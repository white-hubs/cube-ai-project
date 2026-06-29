import { type LlmRemoteModelItem } from "../metadata-inference.service";
import {
  type MatchRuleRow,
  type SystemLlmModelMatchRuleRepository,
  type SystemLlmModelRepository,
  type SystemLlmProviderRepository,
  type SystemModelRow,
  type SystemProviderRow,
} from "../repositories";
import {
  type LlmDslSchema,
  type LlmRequestSchema,
  type LlmResponseSchema,
  safeParseJsonObject,
  splitModelTypes,
} from "../schema/llm-schema";

/** 移植自 ghcloud ai-application model-metadata-inference.service：远程模型元数据推断（系统模型/规则/兜底）。 */
export type ChannelProfile = "direct" | "aggregator_unified" | "aggregator_native";

const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#EEF2FF"/><path d="M10 24V12h4.2l3.8 6.2L21.8 12H26v12h-3v-7.1l-3.8 6.2h-2.4L13 16.9V24h-3z" fill="#4F46E5"/></svg>`;

const BUILTIN_ICON_SVGS: Record<string, string> = {
  "builtin:model:anthropic": `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#FFF7ED"/><path d="m18 10 6 16h-3.4l-1.1-3.2h-7L11.4 26H8l6-16h4zM13.5 20h5l-2.5-7-2.5 7z" fill="#C2410C"/></svg>`,
  "builtin:model:doubao": `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#EEF2FF"/><path d="M13 11h5.5c4.1 0 6.5 2.3 6.5 6.5S22.6 24 18.5 24H13V11zm3.2 2.8v7.4h2.1c2.1 0 3.4-1.2 3.4-3.7s-1.3-3.7-3.4-3.7h-2.1z" fill="#6366F1"/></svg>`,
  "builtin:model:embedding": `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#F5F3FF"/><circle cx="12" cy="18" r="3" fill="#8B5CF6"/><circle cx="24" cy="12" r="3" fill="#8B5CF6"/><circle cx="24" cy="24" r="3" fill="#8B5CF6"/><path d="M14.5 16.8 21 13.3M14.5 19.2 21 22.7" stroke="#8B5CF6" stroke-width="2" stroke-linecap="round"/></svg>`,
  "builtin:model:gemini": `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#EFF6FF"/><path d="M18 9l2.4 6.6L27 18l-6.6 2.4L18 27l-2.4-6.6L9 18l6.6-2.4L18 9z" fill="#3B82F6"/></svg>`,
  "builtin:model:openai": `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#ECFDF5"/><path d="M18 9.5c2.2 0 4 1.8 4 4v1.1a4 4 0 0 1 2.9 3.9 4 4 0 0 1-2.9 3.9v.1c0 2.2-1.8 4-4 4a4 4 0 0 1-3.9-2.9H13a4 4 0 0 1-3.9-4 4 4 0 0 1 2.9-3.9v-.2c0-2.2 1.8-4 4-4 .8 0 1.5.2 2.1.6.6-.4 1.2-.6 1.9-.6z" fill="#10B981"/></svg>`,
  "builtin:model:rerank": `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36"><rect width="36" height="36" rx="10" fill="#FFF7ED"/><path d="M10 14h11v3H10v-3zm0 5h16v3H10v-3z" fill="#F97316"/></svg>`,
};

export interface RemoteModelCandidate {
  modelCode: string;
  displayName: string;
  groupName: string;
  iconUrl: string;
  apiBaseUrl: string | null;
  endpointType: string | null;
  requestSchema: LlmRequestSchema | null;
  responseSchema: LlmResponseSchema | null;
  dslSchema: LlmDslSchema | null;
  nativeFamily: string | null;
  channelProfile: ChannelProfile | null;
  adapterKey: string | null;
  modelTypes: string[];
  isFree: boolean;
  supportsTest: boolean;
  matchedBy: "system-model" | "rule" | "fallback";
  systemModelId: string | null;
}

export interface ModelInferenceProviderContext {
  typeCode: string;
  providerCode: string;
  iconUrl: string | null;
  systemProviderId: string | null;
}

interface InferenceResult {
  displayName: string;
  groupName: string;
  iconUrl: string;
  apiBaseUrl: string | null;
  endpointType: string | null;
  requestSchema: LlmRequestSchema | null;
  responseSchema: LlmResponseSchema | null;
  dslSchema: LlmDslSchema | null;
  nativeFamily: string | null;
  channelProfile: ChannelProfile | null;
  adapterKey: string | null;
  modelTypes: string[];
  isFree: boolean;
  supportsTest: boolean;
  matchedBy: "system-model" | "rule" | "fallback";
  systemModelId: string | null;
}

export class ModelMetadataInferenceService {
  constructor(
    private readonly systemProviderRepository: SystemLlmProviderRepository,
    private readonly systemModelRepository: SystemLlmModelRepository,
    private readonly matchRuleRepository: SystemLlmModelMatchRuleRepository,
  ) {}

  async inferRemoteModels(provider: ModelInferenceProviderContext, remoteModels: LlmRemoteModelItem[]): Promise<RemoteModelCandidate[]> {
    const [systemProviders, systemModels, rules] = await Promise.all([
      this.systemProviderRepository.listActive(),
      this.systemModelRepository.listActive(),
      this.matchRuleRepository.listActive(),
    ]);
    return remoteModels.map((item) => {
      const inferred = this.inferSingleModel(provider, item, systemProviders, systemModels, rules);
      return {
        adapterKey: inferred.adapterKey,
        apiBaseUrl: inferred.apiBaseUrl,
        channelProfile: inferred.channelProfile,
        displayName: inferred.displayName,
        dslSchema: inferred.dslSchema,
        endpointType: inferred.endpointType,
        groupName: inferred.groupName,
        iconUrl: inferred.iconUrl,
        isFree: inferred.isFree,
        matchedBy: inferred.matchedBy,
        modelCode: item.modelCode,
        modelTypes: inferred.modelTypes,
        nativeFamily: inferred.nativeFamily,
        requestSchema: inferred.requestSchema,
        responseSchema: inferred.responseSchema,
        supportsTest: inferred.supportsTest,
        systemModelId: inferred.systemModelId,
      };
    });
  }

  private inferSingleModel(
    provider: ModelInferenceProviderContext,
    remoteModel: LlmRemoteModelItem,
    systemProviders: SystemProviderRow[],
    systemModels: SystemModelRow[],
    rules: MatchRuleRow[],
  ): InferenceResult {
    const matchedRule = this.matchRule(provider, remoteModel.modelCode, rules);
    const schemasFromRule = resolveSchemasFromRule(matchedRule);

    const systemModel = this.matchSystemModel(provider, remoteModel.modelCode, systemProviders, systemModels);
    if (systemModel) {
      const modelTypes = splitModelTypes(systemModel.model_types);
      const wire = resolveWireContextFromRule({
        endpointType: systemModel.endpoint_type,
        matchedRule,
        modelCode: remoteModel.modelCode,
        providerTypeCode: provider.typeCode,
        requestSchema: schemasFromRule.requestSchema,
      });
      return {
        adapterKey: wire.adapterKey,
        apiBaseUrl: systemModel.api_base_url,
        channelProfile: wire.channelProfile,
        displayName: systemModel.display_name,
        dslSchema: schemasFromRule.dslSchema,
        endpointType: systemModel.endpoint_type,
        groupName: systemModel.group_name,
        iconUrl: this.resolveIcon(systemModel.icon_url ?? provider.iconUrl ?? null),
        isFree: Boolean(systemModel.is_free),
        matchedBy: "system-model",
        modelTypes,
        nativeFamily: wire.nativeFamily,
        requestSchema: schemasFromRule.requestSchema,
        responseSchema: schemasFromRule.responseSchema,
        supportsTest: Boolean(systemModel.supports_test),
        systemModelId: systemModel.id.toString(),
      };
    }

    if (matchedRule) {
      const modelTypes = splitModelTypes(matchedRule.model_types);
      const supportsTest = !modelTypes.includes("rerank");
      const wire = resolveWireContextFromRule({
        endpointType: matchedRule.endpoint_type,
        matchedRule,
        modelCode: remoteModel.modelCode,
        providerTypeCode: provider.typeCode,
        requestSchema: schemasFromRule.requestSchema,
      });
      return {
        adapterKey: wire.adapterKey,
        apiBaseUrl: matchedRule.api_base_url,
        channelProfile: wire.channelProfile,
        displayName: matchedRule.display_name_template || matchedRule.normalized_name || prettifyDisplayName(remoteModel.modelCode),
        dslSchema: schemasFromRule.dslSchema,
        endpointType: matchedRule.endpoint_type,
        groupName: matchedRule.group_name || inferFamilyGroup(remoteModel.modelCode),
        iconUrl: this.resolveIcon(matchedRule.icon_url ?? provider.iconUrl ?? null),
        isFree: Boolean(matchedRule.is_free),
        matchedBy: "rule",
        modelTypes,
        nativeFamily: wire.nativeFamily,
        requestSchema: schemasFromRule.requestSchema,
        responseSchema: schemasFromRule.responseSchema,
        supportsTest,
        systemModelId: null,
      };
    }

    const modelTypes = inferModelTypes(remoteModel.modelCode);
    const wire = inferWireDefaults({
      endpointType: null,
      modelCode: remoteModel.modelCode,
      providerTypeCode: provider.typeCode,
      requestSchema: null,
    });
    return {
      adapterKey: wire.adapterKey,
      apiBaseUrl: null,
      channelProfile: wire.channelProfile,
      displayName: prettifyDisplayName(remoteModel.displayName || remoteModel.modelCode),
      dslSchema: null,
      endpointType: null,
      groupName: inferFamilyGroup(remoteModel.modelCode),
      iconUrl: this.resolveIcon(inferBuiltinIconCode(remoteModel.modelCode) ?? provider.iconUrl ?? null),
      isFree: inferIsFree(remoteModel.modelCode),
      matchedBy: "fallback",
      modelTypes,
      nativeFamily: wire.nativeFamily,
      requestSchema: null,
      responseSchema: null,
      supportsTest: !modelTypes.includes("rerank"),
      systemModelId: null,
    };
  }

  private matchSystemModel(
    provider: ModelInferenceProviderContext,
    modelCode: string,
    systemProviders: SystemProviderRow[],
    systemModels: SystemModelRow[],
  ): SystemModelRow | null {
    const matchedProviderIds = new Set<string>();
    if (provider.systemProviderId) {
      matchedProviderIds.add(provider.systemProviderId);
    }
    for (const item of systemProviders) {
      if (item.provider_code === provider.providerCode || item.type_code === provider.typeCode) {
        matchedProviderIds.add(item.id);
      }
    }
    return (
      systemModels.find(
        (item) => item.model_code === modelCode && (matchedProviderIds.size === 0 || matchedProviderIds.has(item.system_provider_id)),
      ) ?? null
    );
  }

  private matchRule(provider: ModelInferenceProviderContext, modelCode: string, rules: MatchRuleRow[]): MatchRuleRow | null {
    const lowerCode = modelCode.toLowerCase();
    for (const rule of rules) {
      if (rule.provider_type_code && rule.provider_type_code !== provider.typeCode) {
        continue;
      }
      if (rule.provider_code && rule.provider_code !== provider.providerCode) {
        continue;
      }
      const pattern = rule.pattern.toLowerCase();
      if (rule.match_type === "exact" && lowerCode === pattern) {
        return rule;
      }
      if (rule.match_type === "prefix" && lowerCode.startsWith(pattern)) {
        return rule;
      }
      if (rule.match_type === "contains" && lowerCode.includes(pattern)) {
        return rule;
      }
      if (rule.match_type === "regex" && new RegExp(rule.pattern, "iu").test(modelCode)) {
        return rule;
      }
    }
    return null;
  }

  private resolveIcon(iconCodeOrUrl: string | null): string {
    if (!iconCodeOrUrl) {
      return toDataUri(DEFAULT_ICON_SVG);
    }
    const inlineSvg = BUILTIN_ICON_SVGS[iconCodeOrUrl];
    if (inlineSvg) {
      return toDataUri(inlineSvg);
    }
    if (
      iconCodeOrUrl.startsWith("data:") ||
      iconCodeOrUrl.startsWith("http://") ||
      iconCodeOrUrl.startsWith("https://") ||
      iconCodeOrUrl.startsWith("/")
    ) {
      return iconCodeOrUrl;
    }
    return toDataUri(DEFAULT_ICON_SVG);
  }
}

function resolveSchemasFromRule(rule: MatchRuleRow | null): {
  requestSchema: LlmRequestSchema | null;
  responseSchema: LlmResponseSchema | null;
  dslSchema: LlmDslSchema | null;
} {
  if (!rule) {
    return { requestSchema: null, responseSchema: null, dslSchema: null };
  }
  return {
    dslSchema: safeParseJsonObject<LlmDslSchema>(rule.dsl_schema_json),
    requestSchema: safeParseJsonObject<LlmRequestSchema>(rule.request_schema_json),
    responseSchema: safeParseJsonObject<LlmResponseSchema>(rule.response_schema_json),
  };
}

interface WireDefaultInput {
  providerTypeCode: string;
  modelCode: string;
  endpointType: string | null;
  requestSchema: LlmRequestSchema | null;
}

interface WireDefaultResult {
  nativeFamily: string | null;
  channelProfile: ChannelProfile | null;
  adapterKey: string | null;
}

function inferNativeFamily(modelCode: string): string | null {
  const value = modelCode.toLowerCase();
  if (value.startsWith("qwen3-") || value.startsWith("qwen3.")) {
    return "qwen3";
  }
  if (value.startsWith("doubao-seedream")) {
    return "seedream";
  }
  if (value.startsWith("doubao-seedance")) {
    return "seedance";
  }
  if (value.startsWith("deepseek-")) {
    return "deepseek";
  }
  if (value.startsWith("gpt-image") || value.startsWith("dall-e")) {
    return "gpt_image";
  }
  if (value.startsWith("gpt-") || value.startsWith("o1") || value.startsWith("o3") || value.startsWith("o4-")) {
    return "gpt";
  }
  if (value.startsWith("qwen-")) {
    return "qwen";
  }
  return null;
}

function isOpenAiChatShape(input: WireDefaultInput): boolean {
  return input.requestSchema?.requestShape === "openai_chat_compatible" || input.endpointType === "openai";
}

function isOpenAiImageShape(input: WireDefaultInput): boolean {
  return input.requestSchema?.requestShape === "openai_images_generation" || input.endpointType === "openai_image";
}

function inferWireDefaults(input: WireDefaultInput): WireDefaultResult {
  const nativeFamily = inferNativeFamily(input.modelCode);

  if (input.providerTypeCode === "geekai") {
    if (isOpenAiImageShape(input)) {
      if (nativeFamily === "seedream") {
        return { adapterKey: "seedream.openai_images", channelProfile: "aggregator_native", nativeFamily };
      }
      return { adapterKey: "openai.images", channelProfile: "aggregator_unified", nativeFamily };
    }
    if (isOpenAiChatShape(input)) {
      return { adapterKey: "geekai.openai_chat", channelProfile: "aggregator_unified", nativeFamily };
    }
  }

  if (input.providerTypeCode === "volcengine_ark") {
    if (isOpenAiImageShape(input)) {
      return {
        adapterKey: nativeFamily === "seedream" ? "volcengine_ark.openai_image" : "openai.images",
        channelProfile: "direct",
        nativeFamily,
      };
    }
    if (isOpenAiChatShape(input)) {
      return { adapterKey: "openai.chat", channelProfile: "direct", nativeFamily };
    }
  }

  if (input.providerTypeCode === "dashscope") {
    if (input.requestSchema?.requestShape === "dashscope_multimodal_generation" || input.endpointType === "dashscope_text2image") {
      return { adapterKey: "dashscope.multimodal_image", channelProfile: "direct", nativeFamily };
    }
    if (isOpenAiChatShape(input)) {
      return { adapterKey: "openai.chat", channelProfile: "direct", nativeFamily };
    }
  }

  if (isOpenAiImageShape(input)) {
    return { adapterKey: "openai.images", channelProfile: "direct", nativeFamily };
  }
  if (isOpenAiChatShape(input)) {
    return { adapterKey: "openai.chat", channelProfile: "direct", nativeFamily };
  }
  return { adapterKey: null, channelProfile: null, nativeFamily };
}

function normalizeChannelProfile(value: string | null | undefined): ChannelProfile | null {
  return value === "direct" || value === "aggregator_unified" || value === "aggregator_native" ? value : null;
}

function resolveWireContextFromRule(input: WireDefaultInput & { matchedRule: MatchRuleRow | null }): WireDefaultResult {
  const defaults = inferWireDefaults(input);
  return {
    adapterKey: input.matchedRule?.adapter_key ?? defaults.adapterKey,
    channelProfile: normalizeChannelProfile(input.matchedRule?.channel_profile) ?? defaults.channelProfile,
    nativeFamily: input.matchedRule?.native_family ?? defaults.nativeFamily,
  };
}

function inferModelTypes(modelCode: string): string[] {
  const value = modelCode.toLowerCase();
  const types = new Set<string>();
  if (
    value.includes("image") ||
    value.includes("wanx") ||
    value.startsWith("wan2") ||
    value.startsWith("z-image") ||
    value.startsWith("dall-e") ||
    value.includes("gpt-image") ||
    value.includes("seedream")
  ) {
    types.add("image_generation");
  }
  if (value.includes("seedance")) {
    types.add("video_generation");
  }
  if (value.includes("seed3d") || value.startsWith("hitem3d") || value.startsWith("hyper3d")) {
    types.add("3d_generation");
  }
  if (value.includes("happyhorse") || value.includes("-t2v") || value.includes("-i2v") || value.includes("-r2v")) {
    types.add("video_generation");
  }
  if (value.startsWith("text-embedding") || value.includes("embedding-vision")) {
    types.add("embedding");
  }
  if (value.startsWith("cosyvoice") || value.includes("speech-")) {
    types.add("speech_synthesis");
  }
  if (value.startsWith("fun-asr") || value.includes("-asr")) {
    types.add("speech_recognition");
  }
  if (value.startsWith("fun-music")) {
    types.add("music_generation");
  }
  if (value.includes("embedding")) {
    types.add("embedding");
  }
  if (value.includes("rerank") || value.includes("reranker")) {
    types.add("rerank");
  }
  if (value.includes("vision") || value.includes("-vl") || value.includes("vl-")) {
    types.add("vision");
  }
  if (value.includes("search")) {
    types.add("web_search");
  }
  if (types.size === 0) {
    types.add("reasoning");
  }
  return Array.from(types);
}

function inferBuiltinIconCode(modelCode: string): string | null {
  const value = modelCode.toLowerCase();
  if (value.includes("doubao")) {
    return "builtin:model:doubao";
  }
  if (value.includes("gpt") || value.startsWith("o1") || value.startsWith("o3")) {
    return "builtin:model:openai";
  }
  if (value.includes("claude")) {
    return "builtin:model:anthropic";
  }
  if (value.includes("gemini")) {
    return "builtin:model:gemini";
  }
  if (value.includes("embedding")) {
    return "builtin:model:embedding";
  }
  if (value.includes("rerank") || value.includes("reranker")) {
    return "builtin:model:rerank";
  }
  return null;
}

function inferFamilyGroup(modelCode: string): string {
  const value = modelCode.toLowerCase();
  if (value.includes("doubao")) {
    return "Doubao";
  }
  if (value.includes("gpt-4o")) {
    return "GPT-4o";
  }
  if (value.includes("claude-3-5")) {
    return "Claude 3.5";
  }
  if (value.includes("claude")) {
    return "Claude";
  }
  if (value.includes("gemini-1.5")) {
    return "Gemini 1.5";
  }
  if (value.includes("gemini")) {
    return "Gemini";
  }
  if (value.includes("deepseek")) {
    return "DeepSeek";
  }
  if (value.includes("qwen")) {
    return "Qwen";
  }
  if (value.includes("glm")) {
    return "GLM";
  }
  if (value.includes("mistral")) {
    return "Mistral";
  }
  if (value.includes("embedding")) {
    return "Embedding";
  }
  if (value.includes("rerank") || value.includes("reranker")) {
    return "Rerank";
  }
  const [family] = modelCode.split(/[-_:]/u);
  return family ? prettifyDisplayName(family) : "General";
}

function inferIsFree(modelCode: string): boolean {
  const value = modelCode.toLowerCase();
  return value.includes("lite") || value.includes("mini") || value.includes("flash");
}

function prettifyDisplayName(value: string): string {
  if (!value.trim()) {
    return "Unknown Model";
  }
  return value
    .split(/[-_]/u)
    .filter(Boolean)
    .map((item) => (item.length <= 3 ? item.toUpperCase() : item.charAt(0).toUpperCase() + item.slice(1)))
    .join(" ");
}

function toDataUri(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
