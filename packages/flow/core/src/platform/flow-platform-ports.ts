import { Inject, Injectable } from '@dangao/bun-server';
import type {
  FlowCatalogListRequest,
  FlowCatalogListResponse,
  FlowCatalogPort,
  FlowInvokeRequest,
  FlowInvokeSyncResponse,
  FlowInvokerPort,
} from '@cube-ai/contracts';
import { AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN, AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN } from '@cube-ai/contracts/platform';
import { tenantContextAls } from '@cube-ai/server-shared';
import { FlowCrudService } from '../flows/flow-crud.service';
import { FlowExecutionService } from '../flows/flow-execution.service';

@Injectable()
export class FlowInvokerPortImpl implements FlowInvokerPort {
  constructor(private readonly execution: FlowExecutionService) {}

  async invoke(req: FlowInvokeRequest, signal: AbortSignal): Promise<FlowInvokeSyncResponse> {
    void signal;
    const tenantId = String(req.tenant);
    const input =
      typeof req.variables?.['input'] === 'string'
        ? req.variables['input']
        : typeof req.variables?.['message'] === 'string'
          ? req.variables['message']
          : '';
    const body = { ...(req.variables ?? {}), input, stream: false };

    return tenantContextAls.run({ tenantId, bypassTenantIsolation: false }, async () => {
      const raw = await this.execution.run(req.flowId, body);
      const result: Record<string, unknown> =
        raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : { value: raw };
      return { result };
    });
  }
}

@Injectable()
export class FlowCatalogPortImpl implements FlowCatalogPort {
  constructor(private readonly crud: FlowCrudService) {}

  async list(req: FlowCatalogListRequest, signal: AbortSignal): Promise<FlowCatalogListResponse> {
    void signal;
    const tenantId = String(req.tenant);
    return tenantContextAls.run({ tenantId, bypassTenantIsolation: false }, async () => {
      const rows = await this.crud.repo.listFlows(tenantId);
      const keyword = req.keyword?.trim().toLowerCase();
      let flows = rows.map((r) => ({
        flowId: r.id,
        name: r.name,
        description: r.description,
        enabled: true,
        compileStatus: r.binding_status,
      }));
      if (keyword) {
        flows = flows.filter(
          (f) => f.name.toLowerCase().includes(keyword) || f.flowId.toLowerCase().includes(keyword),
        );
      }
      const pageNumber = req.pageNumber ?? 1;
      const pageSize = req.pageSize ?? (flows.length || 20);
      const total = flows.length;
      const start = (pageNumber - 1) * pageSize;
      const page = flows.slice(start, start + pageSize);
      return {
        flows: page,
        pagination: {
          total,
          pages: Math.ceil(total / pageSize) || 1,
          currentPage: pageNumber,
          pageSize,
        },
      };
    });
  }
}

export { AGENTIC_PLATFORM_FLOW_INVOKER_TOKEN, AGENTIC_PLATFORM_FLOW_CATALOG_TOKEN };
