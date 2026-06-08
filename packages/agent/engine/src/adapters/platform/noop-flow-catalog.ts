import type {
  FlowCatalogPort,
  FlowCatalogListRequest,
  FlowCatalogListResponse,
} from '@cube-ai/contracts';

export class NoopFlowCatalogPort implements FlowCatalogPort {
  async list(_req: FlowCatalogListRequest, _signal: AbortSignal): Promise<FlowCatalogListResponse> {
    const err = Object.assign(new Error('Flow catalog is not wired in M2 (pending M4)'), {
      name: 'AgenticPlatformNotConnectedError',
      code: 'PLATFORM_FLOW_NOT_CONNECTED',
    });
    throw err;
  }
}
