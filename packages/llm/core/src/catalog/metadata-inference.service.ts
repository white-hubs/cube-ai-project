import { type LlmEndpointType } from "@cube-ai/contracts";

import { type SystemLlmModelEntity, type SystemLlmModelMatchRuleEntity } from "./entities";
import {
  type LlmDslSchema,
  type LlmRequestSchema,
  type LlmResponseSchema,
  safeParseJsonObject,
  splitModelTypes,
} from "./schema/llm-schema";

export interface LlmRemoteModelItem {
  modelCode: string;
  displayName: string;
  groupName: string;
}

export interface ModelInferenceProviderContext {
  typeCode: string;
  providerCode: string;
  iconUrl: string | null;
  systemProviderId: string | null;
}

export interface RemoteModelCandidate {
  modelCode: string;
  displayName: string;
  groupName: string;
  endpointType: LlmEndpointType | null;
  modelTypes: string[];
  isFree: boolean;
  supportsTest: boolean;
  matchedBy: "system-model" | "rule" | "fallback";
  systemModelId: string | null;
  adapterKey: string | null;
}

interface ProviderSnapshot {
  id: string;
  provider_code: string;
  type_code: string;
}

export class ModelMetadataInferenceService {
  constructor(
    private readonly deps: {
      listActiveProviders: () => Promise<ProviderSnapshot[]>;
      listActiveModels: () => Promise<SystemLlmModelEntity[]>;
      listActiveRules: () => Promise<SystemLlmModelMatchRuleEntity[]>;
    },
  ) {}

  async inferRemoteModels(provider: ModelInferenceProviderContext, remoteModels: LlmRemoteModelItem[]): Promise<RemoteModelCandidate[]> {
    const [systemProviders, systemModels, rules] = await Promise.all([
      this.deps.listActiveProviders(),
      this.deps.listActiveModels(),
      this.deps.listActiveRules(),
    ]);
    return remoteModels.map((item) => {
      const inferred = this.inferSingleModel(provider, item, systemProviders, systemModels, rules);
      return { modelCode: item.modelCode, ...inferred };
    });
  }

  private inferSingleModel(
    provider: ModelInferenceProviderContext,
    remoteModel: LlmRemoteModelItem,
    systemProviders: ProviderSnapshot[],
    systemModels: SystemLlmModelEntity[],
    rules: SystemLlmModelMatchRuleEntity[],
  ): Omit<RemoteModelCandidate, "modelCode"> {
    const matchedRule = this.matchRule(provider, remoteModel.modelCode, rules);
    const systemModel = this.matchSystemModel(provider, remoteModel.modelCode, systemProviders, systemModels);
    if (systemModel) {
      const modelTypes = splitModelTypes(systemModel.model_types);
      return {
        adapterKey: inferAdapterKey(provider.typeCode, systemModel.endpoint_type, modelTypes),
        displayName: systemModel.display_name,
        endpointType: systemModel.endpoint_type,
        groupName: systemModel.group_name,
        isFree: Boolean(systemModel.is_free),
        matchedBy: "system-model",
        modelTypes,
        supportsTest: Boolean(systemModel.supports_test),
        systemModelId: systemModel.id,
      };
    }
    if (matchedRule) {
      const modelTypes = splitModelTypes(matchedRule.model_types);
      return {
        adapterKey: inferAdapterKey(provider.typeCode, matchedRule.endpoint_type, modelTypes),
        displayName: matchedRule.display_name_template || matchedRule.normalized_name || prettifyDisplayName(remoteModel.modelCode),
        endpointType: matchedRule.endpoint_type,
        groupName: matchedRule.group_name || inferFamilyGroup(remoteModel.modelCode),
        isFree: Boolean(matchedRule.is_free),
        matchedBy: "rule",
        modelTypes,
        supportsTest: !modelTypes.includes("rerank"),
        systemModelId: null,
      };
    }
    const modelTypes = inferModelTypes(remoteModel.modelCode);
    return {
      adapterKey: inferAdapterKey(provider.typeCode, null, modelTypes),
      displayName: prettifyDisplayName(remoteModel.displayName || remoteModel.modelCode),
      endpointType: null,
      groupName: inferFamilyGroup(remoteModel.modelCode),
      isFree: inferIsFree(remoteModel.modelCode),
      matchedBy: "fallback",
      modelTypes,
      supportsTest: !modelTypes.includes("rerank"),
      systemModelId: null,
    };
  }

  private matchSystemModel(
    provider: ModelInferenceProviderContext,
    modelCode: string,
    systemProviders: ProviderSnapshot[],
    systemModels: SystemLlmModelEntity[],
  ): SystemLlmModelEntity | null {
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

  matchRule(
    provider: ModelInferenceProviderContext,
    modelCode: string,
    rules: SystemLlmModelMatchRuleEntity[],
  ): SystemLlmModelMatchRuleEntity | null {
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

  parseSchemasFromRule(rule: SystemLlmModelMatchRuleEntity | null): {
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
}

export function inferModelTypes(modelCode: string): string[] {
  const lower = modelCode.toLowerCase();
  const types: string[] = [];
  if (lower.includes("embed")) {
    types.push("embedding");
  }
  if (lower.includes("rerank")) {
    types.push("rerank");
  }
  if (lower.includes("vision") || lower.includes("-vl")) {
    types.push("vision");
  }
  if (lower.includes("image")) {
    types.push("image_generation");
  }
  if (types.length === 0) {
    types.push("chat");
  }
  return types;
}

export function inferAdapterKey(typeCode: string, endpointType: LlmEndpointType | null, modelTypes: string[]): string | null {
  if (modelTypes.includes("embedding")) {
    return "openai_embeddings";
  }
  if (endpointType === "anthropic") {
    return "anthropic_messages";
  }
  if (endpointType === "dashscope_text2image") {
    return "dashscope_text2image";
  }
  if (typeCode === "volcengine_ark" && modelTypes.includes("embedding")) {
    return "doubao_multimodal_embed";
  }
  return "openai_chat_compatible";
}

function prettifyDisplayName(modelCode: string): string {
  return modelCode.replaceAll(/[-_]/gu, " ").replaceAll(/\b\w/gu, (c) => c.toUpperCase());
}

function inferFamilyGroup(modelCode: string): string {
  const prefix = modelCode.split(/[-_/]/u)[0] ?? modelCode;
  return prettifyDisplayName(prefix);
}

function inferIsFree(modelCode: string): boolean {
  return modelCode.toLowerCase().includes("free");
}
