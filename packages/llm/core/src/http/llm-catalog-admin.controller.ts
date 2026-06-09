import { BadRequestException, Body, Controller, DELETE, GET, POST, PUT, Param } from '@dangao/bun-server';
import { LlmCatalogService } from '../catalog/admin/llm-catalog.service';
import type { LlmDslSchema, LlmRequestSchema, LlmResponseSchema } from '../catalog/schema/llm-schema';

function parseId(raw: string): string {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) throw new BadRequestException('Invalid id');
  return normalized;
}

function parseOptionalBoolean(value: unknown): boolean | undefined {
  if (value == null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return Boolean(value);
}

function parseOptionalObject<T extends Record<string, unknown>>(value: unknown): T | null | undefined {
  if (value === undefined) return undefined;
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as T;
  return null;
}

function hasOwn(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/** 移植自 ghcloud LlmCatalogController：/llm 管理面 20 端点。 */
@Controller('/llm')
export class LlmCatalogAdminController {
  constructor(private readonly llmCatalogService: LlmCatalogService) {}

  @GET('/provider-types')
  async listProviderTypes() {
    return this.llmCatalogService.listProviderTypes();
  }

  @GET('/endpoint-types')
  listEndpointTypes() {
    return this.llmCatalogService.listEndpointTypes();
  }

  @GET('/provider-types/:code')
  async getProviderType(@Param('code') code: string) {
    return this.llmCatalogService.getProviderType(code);
  }

  @GET('/providers')
  async listProviders() {
    return this.llmCatalogService.listProviders();
  }

  @GET('/providers/:id')
  async getProvider(@Param('id') id: string) {
    return this.llmCatalogService.getProvider(parseId(id));
  }

  @POST('/providers')
  async createProvider(@Body() body: Record<string, unknown>) {
    return this.llmCatalogService.createProvider({
      providerCode: String(body.providerCode ?? ''),
      typeCode: String(body.typeCode ?? ''),
      name: String(body.name ?? ''),
      iconUrl: body.iconUrl == null ? null : String(body.iconUrl),
      iconFileId: body.iconFileId == null ? null : String(body.iconFileId),
      apiKey: body.apiKey == null ? null : String(body.apiKey),
      apiBaseUrl: body.apiBaseUrl == null ? null : String(body.apiBaseUrl),
      enabled: parseOptionalBoolean(body.enabled),
      remark: body.remark == null ? null : String(body.remark),
    });
  }

  @PUT('/providers/:id')
  async updateProvider(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.llmCatalogService.updateProvider(parseId(id), {
      typeCode: body.typeCode == null ? undefined : String(body.typeCode),
      name: body.name == null ? undefined : String(body.name),
      iconUrl: body.iconUrl == null ? null : String(body.iconUrl),
      iconFileId: body.iconFileId == null ? undefined : String(body.iconFileId),
      enabled: parseOptionalBoolean(body.enabled),
      remark: body.remark == null ? null : String(body.remark),
    });
  }

  @DELETE('/providers/:id')
  async deleteProvider(@Param('id') id: string): Promise<void> {
    await this.llmCatalogService.deleteProvider(parseId(id));
  }

  @PUT('/providers/:id/settings')
  async updateSettings(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const payload: { apiKey?: string | null; apiBaseUrl?: string | null; enabled?: boolean } = {};
    if (hasOwn(body, 'apiKey')) payload.apiKey = body.apiKey == null ? null : String(body.apiKey);
    if (hasOwn(body, 'apiBaseUrl')) payload.apiBaseUrl = body.apiBaseUrl == null ? null : String(body.apiBaseUrl);
    const enabled = parseOptionalBoolean(body.enabled);
    if (enabled !== undefined) payload.enabled = enabled;
    return this.llmCatalogService.updateProviderSettings(parseId(id), payload);
  }

  @POST('/providers/:id/test-connection')
  async testConnection(@Param('id') id: string) {
    return this.llmCatalogService.testConnection(parseId(id));
  }

  @GET('/providers/:providerId/models')
  async listModels(@Param('providerId') providerId: string) {
    return this.llmCatalogService.listModelsGrouped(parseId(providerId));
  }

  @POST('/providers/:providerId/models')
  async createModel(@Param('providerId') providerId: string, @Body() body: Record<string, unknown>) {
    return this.llmCatalogService.createModel(parseId(providerId), {
      modelCode: String(body.modelCode ?? ''),
      displayName: String(body.displayName ?? ''),
      groupName: body.groupName == null ? null : String(body.groupName),
      sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
      remark: body.remark == null ? null : String(body.remark),
      iconUrl: body.iconUrl == null ? null : String(body.iconUrl),
      apiBaseUrl: body.apiBaseUrl == null ? null : String(body.apiBaseUrl),
      endpointType: body.endpointType == null ? null : String(body.endpointType),
      requestSchema: parseOptionalObject<LlmRequestSchema>(body.requestSchema),
      responseSchema: parseOptionalObject<LlmResponseSchema>(body.responseSchema),
      dslSchema: parseOptionalObject<LlmDslSchema>(body.dslSchema),
      modelTypes: Array.isArray(body.modelTypes) ? body.modelTypes.map((item) => String(item)) : undefined,
      isFree: parseOptionalBoolean(body.isFree),
    });
  }

  @PUT('/providers/:providerId/models/:modelId')
  async updateModel(@Param('providerId') providerId: string, @Param('modelId') modelId: string, @Body() body: Record<string, unknown>) {
    return this.llmCatalogService.updateModel(parseId(providerId), parseId(modelId), {
      displayName: body.displayName == null ? undefined : String(body.displayName),
      groupName: body.groupName == null ? undefined : String(body.groupName),
      sortOrder: body.sortOrder == null ? undefined : Number(body.sortOrder),
      remark: body.remark == null ? null : String(body.remark),
      iconUrl: body.iconUrl == null ? undefined : String(body.iconUrl),
      apiBaseUrl: body.apiBaseUrl == null ? undefined : String(body.apiBaseUrl),
      endpointType: body.endpointType == null ? undefined : String(body.endpointType),
      requestSchema: parseOptionalObject<LlmRequestSchema>(body.requestSchema),
      responseSchema: parseOptionalObject<LlmResponseSchema>(body.responseSchema),
      dslSchema: parseOptionalObject<LlmDslSchema>(body.dslSchema),
      modelTypes: Array.isArray(body.modelTypes) ? body.modelTypes.map((item) => String(item)) : undefined,
      isFree: parseOptionalBoolean(body.isFree),
    });
  }

  @DELETE('/providers/:providerId/models/:modelId')
  async deleteModel(@Param('providerId') providerId: string, @Param('modelId') modelId: string): Promise<void> {
    await this.llmCatalogService.deleteModel(parseId(providerId), parseId(modelId));
  }

  @POST('/providers/:providerId/models/:modelId/test')
  async testModel(@Param('providerId') providerId: string, @Param('modelId') modelId: string) {
    return this.llmCatalogService.testModel(parseId(providerId), parseId(modelId));
  }

  @GET('/providers/:providerId/models/:modelCode/runtime-config')
  async getModelRuntimeConfig(@Param('providerId') providerId: string, @Param('modelCode') modelCode: string) {
    return this.llmCatalogService.getModelRuntimeConfig(parseId(providerId), modelCode.trim());
  }

  @POST('/providers/:providerId/models/fetch-remote')
  async fetchRemote(@Param('providerId') providerId: string) {
    return this.llmCatalogService.fetchRemoteModels(parseId(providerId));
  }

  @POST('/providers/:providerId/models/fetch-remote-preview')
  async fetchRemotePreview(@Param('providerId') providerId: string) {
    return this.llmCatalogService.previewRemoteModels(parseId(providerId));
  }

  @POST('/providers/:providerId/models/import-remote')
  async importRemote(@Param('providerId') providerId: string, @Body() body: Record<string, unknown>) {
    const modelCodes = Array.isArray(body.modelCodes) ? body.modelCodes.map((item) => String(item)) : [];
    const endpointType = body.endpointType == null ? null : String(body.endpointType);
    return this.llmCatalogService.importRemoteModels(parseId(providerId), modelCodes, endpointType);
  }
}
