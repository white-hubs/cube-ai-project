import { flowConsoleRequestJson, type FlowConsoleConfig } from './http';

export interface FlowListItem {
  id: string;
  name: string;
  description?: string;
}

export interface FlowListResponse {
  items?: FlowListItem[];
  flows?: FlowListItem[];
}

/** flow-studio editor-model 管理面 DTO（与 `@cube-ai/flow-studio` `FlowService` 出参对齐）。 */
export interface StudioFlowSummaryVo {
  id: string;
  tenant: string;
  name: string;
  description: string | null;
  compileStatus: string;
  compileError: string | null;
  compileRevision: string;
  publishedReleaseId: string | null;
  publishedRevision: string | null;
  enabled: boolean | null;
  remark: string | null;
  createTime: number | null;
  updateTime: number | null;
}

export interface StudioFlowListPageVo {
  total: number;
  pages: number;
  currentPage: number;
  pageSize: number;
  records: StudioFlowSummaryVo[];
}

export interface StudioFlowResourceReferenceVo {
  id: string;
  flowId: string;
  nodeId: string;
  componentKey: string;
  resourceType: string;
  resourceId: string;
  resourceSubId: string | null;
  resourceNameSnapshot: string | null;
  resourceStatusSnapshot: string | null;
  required: boolean;
  invalid: boolean;
  invalidReason: string | null;
}

export interface StudioPublishResult {
  releaseId: string;
  releaseVersion: string;
}

export interface FlowMonitorQuery {
  page?: number | string;
  size?: number | string;
}

export type FlowMonitorResponse = Record<string, unknown>;

function studioPath(suffix = ''): string {
  return `/studio${suffix}`;
}

function monitorQueryString(query?: FlowMonitorQuery): string {
  const params = new URLSearchParams();
  if (query?.page != null) params.set('page', String(query.page));
  if (query?.size != null) params.set('size', String(query.size));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export class FlowConsoleClient {
  constructor(private readonly config: FlowConsoleConfig) {}

  listFlows(): Promise<FlowListResponse> {
    return flowConsoleRequestJson<FlowListResponse>(this.config, 'GET', '/flows');
  }

  getFlow(flowId: string): Promise<FlowListItem> {
    return flowConsoleRequestJson<FlowListItem>(
      this.config,
      'GET',
      `/flows/${encodeURIComponent(flowId)}`,
    );
  }

  // --- flow-studio editor-model management surface (/flow/studio/*) ---

  listStudioFlows(query?: { pageNumber: number; pageSize: number; keyword?: string }): Promise<
    StudioFlowSummaryVo[] | StudioFlowListPageVo
  > {
    if (query) {
      const params = new URLSearchParams({
        pageNumber: String(query.pageNumber),
        pageSize: String(query.pageSize),
      });
      if (query.keyword != null && query.keyword !== '') params.set('keyword', query.keyword);
      return flowConsoleRequestJson<StudioFlowListPageVo>(this.config, 'GET', studioPath(`/?${params.toString()}`));
    }
    return flowConsoleRequestJson<StudioFlowSummaryVo[]>(this.config, 'GET', studioPath('/'));
  }

  getStudioFlow(flowId: string): Promise<Record<string, unknown>> {
    return flowConsoleRequestJson<Record<string, unknown>>(
      this.config,
      'GET',
      studioPath(`/${encodeURIComponent(flowId)}`),
    );
  }

  publishFlow(flowId: string, body: { releaseNote?: string | null } = {}): Promise<StudioPublishResult> {
    return flowConsoleRequestJson<StudioPublishResult>(
      this.config,
      'POST',
      studioPath(`/${encodeURIComponent(flowId)}/publish`),
      body,
    );
  }

  getFlowMonitorTraces(flowId: string, query?: FlowMonitorQuery): Promise<FlowMonitorResponse> {
    return flowConsoleRequestJson<FlowMonitorResponse>(
      this.config,
      'GET',
      studioPath(`/${encodeURIComponent(flowId)}/monitor/traces${monitorQueryString(query)}`),
    );
  }

  getFlowMonitorBuilds(flowId: string, query?: FlowMonitorQuery): Promise<FlowMonitorResponse> {
    return flowConsoleRequestJson<FlowMonitorResponse>(
      this.config,
      'GET',
      studioPath(`/${encodeURIComponent(flowId)}/monitor/builds${monitorQueryString(query)}`),
    );
  }

  listFlowReferences(flowId: string): Promise<StudioFlowResourceReferenceVo[]> {
    return flowConsoleRequestJson<StudioFlowResourceReferenceVo[]>(
      this.config,
      'GET',
      studioPath(`/${encodeURIComponent(flowId)}/references`),
    );
  }

  listFlowsByResource(resourceType: string, resourceId: string): Promise<StudioFlowSummaryVo[]> {
    const params = new URLSearchParams({ resourceType, resourceId });
    return flowConsoleRequestJson<StudioFlowSummaryVo[]>(
      this.config,
      'GET',
      studioPath(`/references/by-resource?${params.toString()}`),
    );
  }
}

export function createFlowConsoleClient(config: FlowConsoleConfig): FlowConsoleClient {
  return new FlowConsoleClient(config);
}
