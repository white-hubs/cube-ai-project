import type { FlowInvokerPort, FlowInvokeRequest, FlowInvokeSyncResponse } from '@cube-ai/contracts';

export class NoopFlowInvokerPort implements FlowInvokerPort {
  async invoke(_req: FlowInvokeRequest, _signal: AbortSignal): Promise<FlowInvokeSyncResponse> {
    const err = Object.assign(new Error('Flow invoke is not wired in M2 (pending M4)'), {
      name: 'AgenticPlatformNotConnectedError',
      code: 'PLATFORM_FLOW_NOT_CONNECTED',
    });
    throw err;
  }
}
