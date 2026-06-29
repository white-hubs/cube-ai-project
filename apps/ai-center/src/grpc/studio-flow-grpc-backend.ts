import { type FlowService, type FlowRunBody as StudioFlowRunBody } from "@cube-ai/flow-studio";

import { type FlowGrpcBackend, type FlowRunBody, type FlowUploadResultLike } from "./flow-grpc-backend";

function toStudioRunBody(body: FlowRunBody): StudioFlowRunBody {
  return {
    ...(body.input !== undefined ? { input: body.input as StudioFlowRunBody["input"] } : {}),
    ...(body.variables !== undefined ? { variables: body.variables } : {}),
  };
}

/**
 * gRPC uses the Flow Studio/UI flow id as the stable external identity.
 * FlowService owns the translation to flow-core's executable flow id.
 */
export function createStudioFlowGrpcBackend(studio: FlowService): FlowGrpcBackend {
  return {
    runFlow: (flowId, body) => studio.runFlow(flowId, toStudioRunBody(body)) as Promise<{ raw?: Record<string, unknown> }>,
    runFlowStream: (flowId, body) => studio.runFlowStream(flowId, toStudioRunBody(body)),
    uploadFlowFile: (flowId, file) => studio.uploadFlowFile(flowId, file) as Promise<FlowUploadResultLike>,
  };
}
