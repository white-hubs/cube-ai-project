import type {
  AvailableToolView,
  InstallToolRequest,
  PluginCatalogItemView,
  ToolDescriptor,
} from '@cube-ai/contracts';

export interface UserAvailableToolRepository {
  listByUser(tenant: number, userId: string): Promise<AvailableToolView[]>;
  findByName(
    tenant: number,
    userId: string,
    toolName: string,
  ): Promise<AvailableToolView | null>;
  insert(tenant: number, userId: string, toolName: string): Promise<AvailableToolView>;
  patch(
    tenant: number,
    userId: string,
    toolName: string,
    enabled: boolean,
  ): Promise<AvailableToolView>;
  softDelete(tenant: number, userId: string, toolName: string): Promise<void>;
}

export interface ToolCatalogSource {
  listAll(): ToolDescriptor[];
}

export class PluginCatalogService {
  constructor(
    private readonly availableTools: UserAvailableToolRepository,
    private readonly toolCatalog: ToolCatalogSource,
  ) {}

  async catalog(tenant: number, userId: string): Promise<PluginCatalogItemView[]> {
    const installed = new Set((await this.availableTools.listByUser(tenant, userId)).map((t) => t.toolName));
    return this.toolCatalog.listAll().map((tool) => ({
      toolName: tool.name,
      displayName: tool.displayName,
      ...(tool.description ? { description: tool.description } : {}),
      ...(tool.tags ? { tags: tool.tags } : {}),
      installed: installed.has(tool.name),
    }));
  }

  myTools(tenant: number, userId: string): Promise<AvailableToolView[]> {
    return this.availableTools.listByUser(tenant, userId);
  }

  async install(
    tenant: number,
    userId: string,
    req: InstallToolRequest,
  ): Promise<AvailableToolView> {
    const existing = await this.availableTools.findByName(tenant, userId, req.toolName);
    if (existing) return existing;
    return this.availableTools.insert(tenant, userId, req.toolName);
  }

  patch(
    tenant: number,
    userId: string,
    toolName: string,
    patch: { enabled: boolean },
  ): Promise<AvailableToolView> {
    return this.availableTools.patch(tenant, userId, toolName, patch.enabled);
  }

  remove(tenant: number, userId: string, toolName: string): Promise<void> {
    return this.availableTools.softDelete(tenant, userId, toolName);
  }
}
