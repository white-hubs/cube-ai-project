export interface FlowUploadResultLike {
  flowId?: string;
  id?: string;
  name?: string;
  file_path?: string;
  filePath?: string;
  path?: string;
  url?: string;
  mime?: string;
  ext?: Record<string, unknown>;
  raw?: unknown;
}

export interface FlowRunBody {
  input?: string | { query: string; files: Record<string, unknown>[] };
  variables?: Record<string, string>;
}

/** gRPC 面消费 flow-core 的最小后端契约（避免直接耦合具体 Service 类型）。 */
export interface FlowGrpcBackend {
  uploadFlowFile(flowId: string, file: File): Promise<FlowUploadResultLike>;
  runFlow(flowId: string, body: FlowRunBody): Promise<{ raw?: Record<string, unknown> }>;
  runFlowStream(flowId: string, body: FlowRunBody): Promise<Response>;
}
