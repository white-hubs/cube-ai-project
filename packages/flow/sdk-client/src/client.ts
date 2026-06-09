import { flowRequestJson, flowRequestMultipart, flowRequestRaw, type FlowSdkConfig } from './http';
import type {
  FlowComponentCatalogItem,
  FlowDebugBody,
  FlowDebugResult,
  FlowDetailVo,
  FlowListPageVo,
  FlowRunBody,
  FlowSaveBody,
  FlowSummaryVo,
  FlowValidateResult,
  ListFlowsPageQuery,
} from './editor-model';

export interface RunFlowBody {
  input?: string;
  sessionId?: string;
  stream?: boolean;
  inputType?: string;
  outputType?: string;
  tweaks?: Record<string, Record<string, unknown>>;
}

export interface RunFlowResult {
  [key: string]: unknown;
}

function studioPath(suffix = ''): string {
  return `/studio${suffix}`;
}

export class FlowClient {
  constructor(private readonly config: FlowSdkConfig) {}

  run(flowId: string, body: RunFlowBody): Promise<RunFlowResult> {
    return flowRequestJson<RunFlowResult>(this.config, 'POST', `/run/${encodeURIComponent(flowId)}`, {
      stream: false,
      ...body,
    });
  }

  // --- editor-model surface (flow-studio /flow/studio/*) ---

  listFlowComponents(): Promise<FlowComponentCatalogItem[]> {
    return flowRequestJson<FlowComponentCatalogItem[]>(this.config, 'GET', studioPath('/components'));
  }

  listFlowsPage(query: ListFlowsPageQuery): Promise<FlowListPageVo> {
    const params = new URLSearchParams({
      pageNumber: String(query.pageNumber),
      pageSize: String(query.pageSize),
    });
    if (query.keyword != null && query.keyword !== '') {
      params.set('keyword', query.keyword);
    }
    return flowRequestJson<FlowListPageVo>(this.config, 'GET', studioPath(`/?${params.toString()}`));
  }

  listFlows(): Promise<FlowSummaryVo[]> {
    return flowRequestJson<FlowSummaryVo[]>(this.config, 'GET', studioPath('/'));
  }

  createFlow(body: FlowSaveBody): Promise<FlowDetailVo> {
    return flowRequestJson<FlowDetailVo>(this.config, 'POST', studioPath('/'), body);
  }

  getFlow(flowId: string): Promise<FlowDetailVo> {
    return flowRequestJson<FlowDetailVo>(this.config, 'GET', studioPath(`/${encodeURIComponent(flowId)}`));
  }

  saveFlow(flowId: string, body: FlowSaveBody): Promise<FlowDetailVo> {
    return flowRequestJson<FlowDetailVo>(this.config, 'PUT', studioPath(`/${encodeURIComponent(flowId)}`), body);
  }

  deleteFlow(flowId: string): Promise<void> {
    return flowRequestJson<void>(this.config, 'DELETE', studioPath(`/${encodeURIComponent(flowId)}`));
  }

  validateFlow(flowId: string): Promise<FlowValidateResult> {
    return flowRequestJson<FlowValidateResult>(this.config, 'POST', studioPath(`/${encodeURIComponent(flowId)}/validate`));
  }

  debugFlow(flowId: string, body: FlowDebugBody): Promise<FlowDebugResult> {
    return flowRequestJson<FlowDebugResult>(this.config, 'POST', studioPath(`/${encodeURIComponent(flowId)}/debug`), body);
  }

  runFlowStream(flowId: string, body: FlowRunBody): Promise<Response> {
    return flowRequestRaw(this.config, 'POST', studioPath(`/${encodeURIComponent(flowId)}/run-stream`), body);
  }

  uploadFlowFile(flowId: string, file: File): Promise<unknown> {
    const form = new FormData();
    form.append('file', file);
    return flowRequestMultipart<unknown>(this.config, studioPath(`/${encodeURIComponent(flowId)}/files`), form);
  }
}

export function createFlowClient(config: FlowSdkConfig): FlowClient {
  return new FlowClient(config);
}
