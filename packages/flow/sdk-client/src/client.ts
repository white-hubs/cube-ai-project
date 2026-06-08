import { flowRequestJson, type FlowSdkConfig } from './http';

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

export class FlowClient {
  constructor(private readonly config: FlowSdkConfig) {}

  run(flowId: string, body: RunFlowBody): Promise<RunFlowResult> {
    return flowRequestJson<RunFlowResult>(this.config, 'POST', `/run/${encodeURIComponent(flowId)}`, {
      stream: false,
      ...body,
    });
  }
}

export function createFlowClient(config: FlowSdkConfig): FlowClient {
  return new FlowClient(config);
}
