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
}

export function createFlowConsoleClient(config: FlowConsoleConfig): FlowConsoleClient {
  return new FlowConsoleClient(config);
}
