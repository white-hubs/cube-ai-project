import { BadRequestException, HttpException, NotFoundException } from '@dangao/bun-server';
import type { LlmProviderIconStorePort } from '@cube-ai/contracts/platform';
import { generateNumericId } from '../generate-id';
import type { LlmRemoteModelItem } from '../metadata-inference.service';
import { LlmTypeAdapterService } from '../connectivity/llm-type-adapter.service';
import type {
  SystemLlmProviderTypeRepository,
  TenantLlmModelRepository,
  TenantLlmProviderRepository,
  TenantModelRow,
  TenantProviderRow,
} from '../repositories';
import {
  validateDslSchema,
  validateRequestSchema,
  validateResponseSchema,
  type LlmDslSchema,
  type LlmRequestSchema,
  type LlmResponseSchema,
} from '../schema/llm-schema';
import { LlmCatalogProvisioningService } from './llm-catalog-provisioning.service';
import {
  ModelMetadataInferenceService,
  type RemoteModelCandidate,
} from './model-metadata-inference.service';

export interface ProviderTypeVo {
  code: string;
  displayName: string;
  description: string | null;
}

export interface EndpointTypeVo {
  code: string;
  displayName: string;
  description: string | null;
}

const ENDPOINT_TYPE_ENUM: EndpointTypeVo[] = [
  { code: 'openai', displayName: 'OpenAI', description: 'OpenAI Chat Completions 兼容协议' },
  { code: 'openai_response', displayName: 'OpenAI-Response', description: 'OpenAI Responses API 协议' },
  { code: 'dashscope_text2image', displayName: 'DashScope 文生图', description: '阿里云百炼 DashScope 文生图协议' },
  { code: 'anthropic', displayName: 'Anthropic', description: 'Anthropic Messages API 协议' },
  { code: 'gemini', displayName: 'Gemini', description: 'Google Gemini Generative Language API 协议' },
  { code: 'azure_openai', displayName: 'Azure OpenAI', description: 'Azure OpenAI 协议' },
  { code: 'new_api', displayName: 'New API', description: 'OpenAI 兼容网关协议' },
  { code: 'openai_image', displayName: '图像生成 (OpenAI)', description: 'OpenAI Images API 协议' },
  { code: 'jina_rerank', displayName: 'Jina 重排序', description: 'Jina Rerank API 协议' },
  { code: 'volcengine_ark', displayName: '火山方舟', description: '火山方舟 Ark OpenAI 兼容 API（/api/v3）' },
  { code: 'geekai', displayName: '极客智坊', description: '极客智坊模型代理 OpenAI 兼容 API（https://geekai.co/api/v1）' },
];

const API_KEY_MASK = '****';

export interface TenantProviderVo {
  id: string;
  tenant: number;
  systemProviderId: string | null;
  providerCode: string;
  typeCode: string;
  name: string;
  iconUrl: string | null;
  apiKey: string | null;
  apiBaseUrl: string | null;
  enabled: boolean;
  isCustom: boolean;
  remark: string | null;
}

export interface TenantModelVo {
  id: string;
  providerId: string;
  modelCode: string;
  displayName: string;
  groupName: string;
  sortOrder: number;
  remark: string | null;
  iconUrl: string | null;
  apiBaseUrl: string | null;
  systemModelId: string | null;
  endpointType: string | null;
  requestSchema: LlmRequestSchema | null;
  responseSchema: LlmResponseSchema | null;
  dslSchema: LlmDslSchema | null;
  modelTypes: string[];
  supportsMultimodalInput: boolean;
  isFree: boolean;
  supportsTest: boolean;
}

export interface ModelDetectionVo {
  ok: boolean;
  message: string;
  modelId: string;
  modelCode: string;
  supportsTest: boolean;
}

export interface RemoteModelCandidateVo extends RemoteModelCandidate {
  alreadyAdded: boolean;
}

export interface LlmModelRuntimeConfigVo {
  modelCode: string;
  displayName: string;
  endpointType: string;
  apiBaseUrl: string;
  apiKey: string;
  requestSchema: LlmRequestSchema | null;
  responseSchema: LlmResponseSchema | null;
  dslSchema: LlmDslSchema | null;
  modelTypes: string[];
  supportsMultimodalInput: boolean;
  isFree: boolean;
  providerCode: string;
}

/**
 * 移植自 ghcloud LlmCatalogService：LLM 目录管理面全量 CRUD + 远程发现/连通性测试。
 * 适配点：mysql2 仓储、租户 resolver（替代 sessionContextHolder）、图标平台端口（替代 cube2 工厂直连）。
 */
export class LlmCatalogService {
  constructor(
    private readonly systemTypeRepository: SystemLlmProviderTypeRepository,
    private readonly tenantProviderRepository: TenantLlmProviderRepository,
    private readonly tenantModelRepository: TenantLlmModelRepository,
    private readonly llmTypeAdapterService: LlmTypeAdapterService,
    private readonly modelMetadataInferenceService: ModelMetadataInferenceService,
    private readonly llmCatalogProvisioningService: LlmCatalogProvisioningService,
    private readonly iconStore: LlmProviderIconStorePort,
    private readonly getTenant: () => number,
  ) {}

  private parseOptionalObjectJson<T extends Record<string, unknown>>(raw: string | null | undefined): T | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : null;
    } catch {
      return null;
    }
  }

  private parseModelTypes(raw: string | null | undefined): string[] {
    return raw ? raw.split(',').map((item) => item.trim()).filter(Boolean) : [];
  }

  private supportsMultimodalInput(modelTypes: string[]): boolean {
    return modelTypes.some((item) => item.trim().toLowerCase() === 'vision');
  }

  private validateModelSchemas(
    requestSchema: LlmRequestSchema | null | undefined,
    responseSchema: LlmResponseSchema | null | undefined,
    dslSchema?: LlmDslSchema | null | undefined,
  ): void {
    const errors = [...validateRequestSchema(requestSchema), ...validateResponseSchema(responseSchema), ...validateDslSchema(dslSchema)];
    if (errors.length > 0) throw new BadRequestException(errors.join('; '));
  }

  private async persistProviderIcon(
    providerId: string,
    iconFileIdRaw: string | null | undefined,
    fallbackIconUrl: string | null | undefined,
  ): Promise<string | null> {
    return this.iconStore.persistProviderIcon({
      providerId,
      iconFileId: iconFileIdRaw?.trim() || null,
      fallbackIconUrl: fallbackIconUrl ?? null,
    });
  }

  private maskProviderApiKey(raw: string | null | undefined): string | null {
    const value = raw?.trim();
    if (!value) return null;
    if (value.length <= 4) return API_KEY_MASK;
    if (value.length <= 8) return `${value.slice(0, 2)}${API_KEY_MASK}${value.slice(-2)}`;
    return `${value.slice(0, 4)}${API_KEY_MASK}${value.slice(-4)}`;
  }

  private toProviderVo(row: TenantProviderRow): TenantProviderVo {
    return {
      id: String(row.id),
      tenant: row.tenant,
      systemProviderId: row.system_provider_id == null ? null : row.system_provider_id.toString(),
      providerCode: row.provider_code,
      typeCode: row.type_code,
      name: row.name,
      iconUrl: row.icon_url,
      apiKey: this.maskProviderApiKey(row.api_key),
      apiBaseUrl: row.api_base_url,
      enabled: Boolean(row.enabled),
      isCustom: Boolean(row.is_custom),
      remark: row.remark,
    };
  }

  private async requireProvider(providerId: string): Promise<TenantProviderRow> {
    const provider = await this.tenantProviderRepository.findByIdForTenant(providerId);
    if (!provider) throw new NotFoundException('供应商不存在');
    return provider;
  }

  async listProviderTypes(): Promise<ProviderTypeVo[]> {
    const rows = await this.systemTypeRepository.listEnabled();
    return rows.map((row) => ({ code: row.code, displayName: row.display_name, description: row.description }));
  }

  listEndpointTypes(): EndpointTypeVo[] {
    return ENDPOINT_TYPE_ENUM;
  }

  async listProviders(): Promise<TenantProviderVo[]> {
    let rows = await this.tenantProviderRepository.listByTenant();
    if (rows.length === 0) {
      // 首次访问模型管理且当前租户尚未初始化时，自动执行一次系统目录同步。
      await this.llmCatalogProvisioningService.syncTenantCatalog(this.getTenant());
      rows = await this.tenantProviderRepository.listByTenant();
    }
    return rows.map((item) => this.toProviderVo(item));
  }

  async getProviderType(code: string): Promise<ProviderTypeVo> {
    const normalized = code.trim();
    if (!normalized) throw new BadRequestException('provider type code 不能为空');
    const rows = await this.systemTypeRepository.listEnabled();
    const found = rows.find((item) => item.code === normalized);
    if (!found) throw new NotFoundException('提供商类型不存在');
    return { code: found.code, displayName: found.display_name, description: found.description };
  }

  async getProvider(providerId: string): Promise<TenantProviderVo> {
    return this.toProviderVo(await this.requireProvider(providerId));
  }

  async createProvider(body: {
    providerCode: string;
    typeCode: string;
    name: string;
    iconUrl?: string | null;
    iconFileId?: string | null;
    apiKey?: string | null;
    apiBaseUrl?: string | null;
    enabled?: boolean;
    remark?: string | null;
  }): Promise<TenantProviderVo> {
    this.getTenant();
    const providerCode = body.providerCode.trim();
    const name = body.name.trim();
    const typeCode = body.typeCode.trim();
    if (!providerCode || !name || !typeCode) throw new BadRequestException('providerCode/typeCode/name 不能为空');
    const id = generateNumericId();
    const persistedIconUrl = await this.persistProviderIcon(id, body.iconFileId, body.iconUrl);
    await this.tenantProviderRepository.insertRow({
      id,
      system_provider_id: null,
      provider_code: providerCode,
      type_code: typeCode,
      name,
      icon_url: persistedIconUrl,
      api_key: body.apiKey ?? null,
      api_base_url: body.apiBaseUrl ?? null,
      enabled: body.enabled ?? false,
      is_custom: true,
      remark: body.remark ?? null,
    });
    return this.toProviderVo((await this.tenantProviderRepository.findByIdForTenant(id)) as TenantProviderRow);
  }

  async updateProvider(
    providerId: string,
    body: {
      typeCode?: string | null;
      name?: string | null;
      iconUrl?: string | null;
      iconFileId?: string | null;
      enabled?: boolean;
      remark?: string | null;
    },
  ): Promise<TenantProviderVo> {
    const provider = await this.requireProvider(providerId);
    const patch: Partial<TenantProviderRow> = {};
    if (body.typeCode !== undefined) {
      const normalizedTypeCode = body.typeCode?.trim() || '';
      if (!normalizedTypeCode) throw new BadRequestException('提供商类型不能为空');
      if (!provider.is_custom) throw new BadRequestException('内置供应商不允许修改提供商类型');
      const enabledTypes = await this.systemTypeRepository.listEnabled();
      const exists = enabledTypes.some((item) => item.code === normalizedTypeCode);
      if (!exists) throw new NotFoundException('提供商类型不存在');
      patch.type_code = normalizedTypeCode;
    }
    if (body.name !== undefined && body.name !== null && body.name.trim() !== '') {
      patch.name = body.name.trim();
    }
    if (body.iconUrl !== undefined) {
      patch.icon_url = await this.persistProviderIcon(provider.id.toString(), body.iconFileId, body.iconUrl);
    } else if (body.iconFileId !== undefined) {
      patch.icon_url = await this.persistProviderIcon(provider.id.toString(), body.iconFileId, provider.icon_url);
    }
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    if (body.remark !== undefined) patch.remark = body.remark;
    await this.tenantProviderRepository.updateRow(providerId, patch);
    return this.toProviderVo((await this.tenantProviderRepository.findByIdForTenant(providerId)) as TenantProviderRow);
  }

  async deleteProvider(providerId: string): Promise<void> {
    const provider = await this.requireProvider(providerId);
    if (!provider.is_custom) throw new BadRequestException('内置供应商副本不允许删除');
    const models = await this.tenantModelRepository.listByProvider(provider.id.toString());
    for (const model of models) {
      await this.tenantModelRepository.logicalDelete(model.id.toString());
    }
    await this.tenantProviderRepository.logicalDelete(providerId);
  }

  async updateProviderSettings(
    providerId: string,
    body: { apiKey?: string | null; apiBaseUrl?: string | null; enabled?: boolean },
  ): Promise<TenantProviderVo> {
    await this.requireProvider(providerId);
    const patch: Partial<TenantProviderRow> = {};
    if (body.apiKey !== undefined) patch.api_key = body.apiKey?.trim() || null;
    if (body.apiBaseUrl !== undefined) patch.api_base_url = body.apiBaseUrl?.trim() || null;
    if (body.enabled !== undefined) patch.enabled = body.enabled;
    await this.tenantProviderRepository.updateRow(providerId, patch);
    return this.toProviderVo((await this.tenantProviderRepository.findByIdForTenant(providerId)) as TenantProviderRow);
  }

  async testConnection(providerId: string): Promise<{ ok: boolean; message: string }> {
    const provider = await this.requireProvider(providerId);
    if (!provider.api_base_url?.trim()) throw new BadRequestException('请先配置 API地址');
    const adapter = this.llmTypeAdapterService.getAdapter(provider.type_code);
    return adapter.testConnection({
      typeCode: provider.type_code,
      apiBaseUrl: provider.api_base_url.trim(),
      apiKey: provider.api_key,
    });
  }

  async testModel(providerId: string, modelId: string): Promise<ModelDetectionVo> {
    const provider = await this.requireProvider(providerId);
    const model = await this.tenantModelRepository.findByIdForTenant(modelId);
    if (!model || model.tenant_provider_id.toString() !== provider.id.toString()) {
      throw new NotFoundException('模型不存在');
    }
    if (!provider.api_base_url?.trim()) {
      return { ok: false, message: '请先配置 API 地址', modelId: model.id.toString(), modelCode: model.model_code, supportsTest: Boolean(model.supports_test) };
    }
    if (!model.supports_test) {
      return { ok: false, message: '当前模型类型暂不支持检测', modelId: model.id.toString(), modelCode: model.model_code, supportsTest: false };
    }
    const adapterType = model.endpoint_type?.trim() || provider.type_code;
    try {
      const adapter = this.llmTypeAdapterService.getAdapter(adapterType);
      const result = await adapter.testModelConnection({
        typeCode: provider.type_code,
        apiBaseUrl: model.api_base_url?.trim() || provider.api_base_url.trim(),
        apiKey: provider.api_key,
        modelCode: model.model_code,
        endpointType: model.endpoint_type,
        modelTypes: model.model_types ? model.model_types.split(',').map((item) => item.trim()).filter(Boolean) : [],
      });
      return { ok: result.ok, message: result.message, modelId: model.id.toString(), modelCode: model.model_code, supportsTest: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '模型检测失败';
      return { ok: false, message, modelId: model.id.toString(), modelCode: model.model_code, supportsTest: true };
    }
  }

  async listModelsGrouped(providerId: string): Promise<Array<{ groupName: string; items: TenantModelVo[] }>> {
    const provider = await this.requireProvider(providerId);
    const rows = await this.tenantModelRepository.listByProvider(provider.id.toString());
    const groups = new Map<string, TenantModelVo[]>();
    for (const row of rows) {
      const groupName = row.group_name || 'default';
      if (!groups.has(groupName)) groups.set(groupName, []);
      const modelTypes = this.parseModelTypes(row.model_types);
      groups.get(groupName)?.push(this.toModelVo(row, modelTypes));
    }
    return Array.from(groups.entries())
      .sort(([groupA], [groupB]) => groupA.localeCompare(groupB))
      .map(([groupName, items]) => ({
        groupName,
        items: items.sort((a, b) => (a.sortOrder !== b.sortOrder ? a.sortOrder - b.sortOrder : a.modelCode.localeCompare(b.modelCode))),
      }));
  }

  private toModelVo(row: TenantModelRow, modelTypes: string[]): TenantModelVo {
    return {
      id: row.id.toString(),
      providerId: row.tenant_provider_id.toString(),
      modelCode: row.model_code,
      displayName: row.display_name,
      groupName: row.group_name,
      sortOrder: Number(row.sort_order),
      remark: row.remark,
      iconUrl: row.icon_url,
      apiBaseUrl: row.api_base_url,
      systemModelId: row.system_model_id == null ? null : row.system_model_id.toString(),
      endpointType: row.endpoint_type,
      requestSchema: this.parseOptionalObjectJson<LlmRequestSchema>(row.request_schema_json),
      responseSchema: this.parseOptionalObjectJson<LlmResponseSchema>(row.response_schema_json),
      dslSchema: this.parseOptionalObjectJson<LlmDslSchema>(row.dsl_schema_json),
      modelTypes,
      supportsMultimodalInput: this.supportsMultimodalInput(modelTypes),
      isFree: Boolean(row.is_free),
      supportsTest: Boolean(row.supports_test),
    };
  }

  async createModel(
    providerId: string,
    body: {
      modelCode: string;
      displayName: string;
      groupName?: string | null;
      sortOrder?: number;
      remark?: string | null;
      iconUrl?: string | null;
      apiBaseUrl?: string | null;
      endpointType?: string | null;
      requestSchema?: LlmRequestSchema | null;
      responseSchema?: LlmResponseSchema | null;
      dslSchema?: LlmDslSchema | null;
      modelTypes?: string[];
      isFree?: boolean;
    },
  ): Promise<TenantModelVo> {
    const provider = await this.requireProvider(providerId);
    if (!body.modelCode.trim() || !body.displayName.trim()) throw new BadRequestException('modelCode/displayName 不能为空');
    this.validateModelSchemas(body.requestSchema, body.responseSchema, body.dslSchema);
    const modelTypes = (body.modelTypes ?? []).map((item) => item.trim()).filter(Boolean);
    const supportsTest = !modelTypes.includes('rerank');
    if (provider.is_custom && !body.endpointType?.trim()) {
      throw new BadRequestException('自定义提供商新增模型时 endpointType 不能为空');
    }

    let resolvedIconUrl = body.iconUrl?.trim() || null;
    let resolvedSystemModelId: string | null = null;
    const trimmedCode = body.modelCode.trim();
    if (!resolvedIconUrl && provider.api_base_url?.trim()) {
      try {
        const candidates = await this.fetchRemoteModelCandidates(provider.id.toString());
        const hit = candidates.find((c) => c.modelCode.trim() === trimmedCode);
        if (hit) {
          resolvedIconUrl = hit.iconUrl?.trim() || null;
          resolvedSystemModelId = hit.systemModelId;
        }
      } catch {
        /* 拉远程列表失败时不阻塞创建（如无密钥等） */
      }
    }

    const id = generateNumericId();
    await this.tenantModelRepository.insertRow({
      id,
      tenant_provider_id: provider.id,
      system_model_id: resolvedSystemModelId,
      model_code: trimmedCode,
      display_name: body.displayName.trim(),
      group_name: body.groupName?.trim() || 'default',
      sort_order: String(body.sortOrder ?? 0),
      remark: body.remark ?? null,
      icon_url: resolvedIconUrl,
      api_base_url: body.apiBaseUrl?.trim() || null,
      endpoint_type: body.endpointType?.trim() || null,
      request_schema_json: body.requestSchema == null ? null : JSON.stringify(body.requestSchema),
      response_schema_json: body.responseSchema == null ? null : JSON.stringify(body.responseSchema),
      dsl_schema_json: body.dslSchema == null ? null : JSON.stringify(body.dslSchema),
      model_types: modelTypes.join(','),
      is_free: body.isFree ?? false,
      supports_test: supportsTest,
    });
    const row = await this.tenantModelRepository.findByIdForTenant(id);
    if (!row) throw new HttpException(500, '创建模型失败');
    return this.toModelVo(row, this.parseModelTypes(row.model_types));
  }

  async updateModel(
    providerId: string,
    modelId: string,
    body: {
      displayName?: string | null;
      groupName?: string | null;
      sortOrder?: number;
      remark?: string | null;
      iconUrl?: string | null;
      apiBaseUrl?: string | null;
      endpointType?: string | null;
      requestSchema?: LlmRequestSchema | null;
      responseSchema?: LlmResponseSchema | null;
      dslSchema?: LlmDslSchema | null;
      modelTypes?: string[];
      isFree?: boolean;
    },
  ): Promise<TenantModelVo> {
    const provider = await this.requireProvider(providerId);
    const model = await this.tenantModelRepository.findByIdForTenant(modelId);
    if (!model || model.tenant_provider_id.toString() !== provider.id.toString()) {
      throw new NotFoundException('模型不存在');
    }
    this.validateModelSchemas(body.requestSchema, body.responseSchema, body.dslSchema);
    const modelTypes = body.modelTypes?.map((item) => item.trim()).filter(Boolean);
    const patch: Partial<TenantModelRow> = {
      display_name: body.displayName?.trim() || undefined,
      group_name: body.groupName?.trim() || undefined,
      sort_order: body.sortOrder !== undefined ? String(body.sortOrder) : undefined,
      remark: body.remark ?? undefined,
      is_free: body.isFree,
    };
    if (body.iconUrl !== undefined) patch.icon_url = body.iconUrl;
    if (body.apiBaseUrl !== undefined) patch.api_base_url = body.apiBaseUrl?.trim() || null;
    if (body.requestSchema !== undefined) {
      patch.request_schema_json = body.requestSchema == null ? null : JSON.stringify(body.requestSchema);
    }
    if (body.responseSchema !== undefined) {
      patch.response_schema_json = body.responseSchema == null ? null : JSON.stringify(body.responseSchema);
    }
    if (body.dslSchema !== undefined) {
      patch.dsl_schema_json = body.dslSchema == null ? null : JSON.stringify(body.dslSchema);
    }
    if (body.endpointType !== undefined) patch.endpoint_type = body.endpointType?.trim() || null;
    if (modelTypes !== undefined) {
      patch.model_types = modelTypes.join(',');
      patch.supports_test = !modelTypes.includes('rerank');
    }
    await this.tenantModelRepository.updateRow(modelId, patch);
    const row = (await this.tenantModelRepository.findByIdForTenant(modelId))!;
    return this.toModelVo(row, this.parseModelTypes(row.model_types));
  }

  async deleteModel(providerId: string, modelId: string): Promise<void> {
    const provider = await this.requireProvider(providerId);
    const model = await this.tenantModelRepository.findByIdForTenant(modelId);
    if (!model || model.tenant_provider_id.toString() !== provider.id.toString()) {
      throw new NotFoundException('模型不存在');
    }
    await this.tenantModelRepository.logicalDelete(modelId);
  }

  async getModelRuntimeConfig(providerId: string, modelCode: string): Promise<LlmModelRuntimeConfigVo> {
    const provider = await this.requireProvider(providerId);
    const model = await this.tenantModelRepository.findByProviderAndCode(providerId, modelCode);
    if (!model) throw new NotFoundException(`模型 ${modelCode} 在供应商 ${providerId} 下不存在`);
    const effectiveEndpointType = model.endpoint_type?.trim() || provider.type_code;
    const effectiveApiBaseUrl = model.api_base_url?.trim() || provider.api_base_url?.trim() || '';
    const modelTypes = this.parseModelTypes(model.model_types);
    return {
      modelCode: model.model_code,
      displayName: model.display_name,
      endpointType: effectiveEndpointType,
      apiBaseUrl: effectiveApiBaseUrl,
      apiKey: provider.api_key ?? '',
      requestSchema: this.parseOptionalObjectJson<LlmRequestSchema>(model.request_schema_json),
      responseSchema: this.parseOptionalObjectJson<LlmResponseSchema>(model.response_schema_json),
      dslSchema: this.parseOptionalObjectJson<LlmDslSchema>(model.dsl_schema_json),
      modelTypes,
      supportsMultimodalInput: this.supportsMultimodalInput(modelTypes),
      isFree: Boolean(model.is_free),
      providerCode: provider.provider_code,
    };
  }

  async fetchRemoteModels(providerId: string): Promise<{ synced: number }> {
    const provider = await this.requireProvider(providerId);
    if (!provider.api_base_url?.trim()) throw new BadRequestException('请先配置 API地址');
    const remoteModels = await this.fetchRemoteModelCandidates(provider.id.toString());
    let synced = 0;
    for (const remote of remoteModels) {
      await this.upsertRemoteModel(provider.id.toString(), remote);
      synced += 1;
    }
    return { synced };
  }

  async previewRemoteModels(providerId: string): Promise<RemoteModelCandidateVo[]> {
    const provider = await this.requireProvider(providerId);
    const candidates = await this.fetchRemoteModelCandidates(provider.id.toString());
    const existing = await this.tenantModelRepository.listByProvider(provider.id.toString());
    const existingCodes = new Set(existing.map((item) => item.model_code));
    return candidates.map((item) => ({ ...item, alreadyAdded: existingCodes.has(item.modelCode) }));
  }

  async importRemoteModels(providerId: string, modelCodes: string[], endpointType?: string | null): Promise<{ imported: number }> {
    const provider = await this.requireProvider(providerId);
    const normalizedCodes = modelCodes.map((item) => item.trim()).filter(Boolean);
    if (normalizedCodes.length === 0) throw new BadRequestException('请选择要导入的模型');
    const normalizedEndpointType = endpointType?.trim() || null;
    if (provider.is_custom && !normalizedEndpointType) {
      throw new BadRequestException('自定义提供商导入模型时 endpointType 不能为空');
    }
    const candidates = await this.fetchRemoteModelCandidates(provider.id.toString());
    const candidateMap = new Map(candidates.map((item) => [item.modelCode, item] as const));
    let imported = 0;
    for (const modelCode of normalizedCodes) {
      const candidate = candidateMap.get(modelCode);
      if (!candidate) continue;
      await this.upsertRemoteModel(provider.id.toString(), candidate, {
        endpointType: normalizedEndpointType,
        isCustomProvider: provider.is_custom,
      });
      imported += 1;
    }
    return { imported };
  }

  private async fetchRemoteModelCandidates(providerId: string): Promise<RemoteModelCandidate[]> {
    const provider = await this.requireProvider(providerId);
    if (!provider.api_base_url?.trim()) throw new BadRequestException('请先配置 API地址');
    const adapter = this.llmTypeAdapterService.getAdapter(provider.type_code);
    const remoteModels = await adapter.fetchModels({
      typeCode: provider.type_code,
      apiBaseUrl: provider.api_base_url.trim(),
      apiKey: provider.api_key,
    });
    return this.modelMetadataInferenceService.inferRemoteModels(
      {
        typeCode: provider.type_code,
        providerCode: provider.provider_code,
        iconUrl: provider.icon_url,
        systemProviderId: provider.system_provider_id == null ? null : provider.system_provider_id.toString(),
      },
      remoteModels,
    );
  }

  private async upsertRemoteModel(
    providerId: string,
    model: RemoteModelCandidate | LlmRemoteModelItem,
    options?: { endpointType?: string | null; isCustomProvider?: boolean },
  ): Promise<void> {
    const modelTypes = 'modelTypes' in model ? model.modelTypes : [];
    const iconUrl = 'iconUrl' in model ? model.iconUrl : null;
    const modelApiBaseUrl = 'apiBaseUrl' in model ? model.apiBaseUrl : null;
    const modelRequestSchema = 'requestSchema' in model ? model.requestSchema : null;
    const modelResponseSchema = 'responseSchema' in model ? model.responseSchema : null;
    const modelDslSchema = 'dslSchema' in model ? model.dslSchema : null;
    const isFree = 'isFree' in model ? model.isFree : false;
    const supportsTest = 'supportsTest' in model ? model.supportsTest : true;
    const systemModelId = 'systemModelId' in model && typeof model.systemModelId === 'string' ? model.systemModelId : null;
    const endpointType = options?.endpointType?.trim() || ('endpointType' in model ? model.endpointType : null);
    const existing = await this.tenantModelRepository.findByProviderAndCode(providerId, model.modelCode);
    if (!existing) {
      await this.tenantModelRepository.insertRow({
        id: generateNumericId(),
        tenant_provider_id: providerId,
        system_model_id: systemModelId,
        model_code: model.modelCode,
        display_name: model.displayName,
        group_name: model.groupName || 'General',
        sort_order: '0',
        remark: null,
        icon_url: iconUrl,
        api_base_url: modelApiBaseUrl,
        endpoint_type: endpointType,
        request_schema_json: modelRequestSchema == null ? null : JSON.stringify(modelRequestSchema),
        response_schema_json: modelResponseSchema == null ? null : JSON.stringify(modelResponseSchema),
        dsl_schema_json: modelDslSchema == null ? null : JSON.stringify(modelDslSchema),
        model_types: modelTypes.join(','),
        is_free: isFree,
        supports_test: supportsTest,
      });
      return;
    }
    const patch: Partial<TenantModelRow> = {
      display_name: model.displayName,
      group_name: model.groupName || 'General',
      icon_url: iconUrl,
      api_base_url: modelApiBaseUrl,
      request_schema_json: modelRequestSchema == null ? null : JSON.stringify(modelRequestSchema),
      response_schema_json: modelResponseSchema == null ? null : JSON.stringify(modelResponseSchema),
      dsl_schema_json: modelDslSchema == null ? null : JSON.stringify(modelDslSchema),
      model_types: modelTypes.join(','),
      is_free: isFree,
      supports_test: supportsTest,
    };
    if (endpointType) patch.endpoint_type = endpointType;
    await this.tenantModelRepository.updateRow(existing.id, patch);
  }
}
