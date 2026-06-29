/**
 * Lazy gRPC client factory for cube2 content service (KnowledgeBaseService).
 *
 * Transport is created on first call; boot never connects to any remote service.
 * Resolution order for base URL:
 *   1. env CUBE2_CONTENT_SERVICE_BASE_URL (direct)
 *   2. Nacos naming lookup via NACOS_ADDRESS / NACOS_SERVER_ADDR
 *      + CUBE2_CONTENT_SERVICE_NAME / CUBE2_CONTENT_SERVICE_GROUP
 *
 * If CUBE2_INTERNAL_INVOKE_SECRET_KEY is set, the feign_inner_invoke header is injected.
 */

import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

import { createCube2GrpcAuthInterceptor } from "./cube2-grpc-auth";
import { resolveCube2GrpcBaseUrl } from "./cube2-grpc-endpoint";
import { KnowledgeBaseService } from "./grpc-gen/guhecloud/cube/apps/content/management/grpc/v1/knowledge_base_pb";

async function resolveContentServiceBaseUrl(): Promise<string> {
  return resolveCube2GrpcBaseUrl({
    clientLabel: "cube2-content-client",
    defaultServiceNames: ["contentManagement", "content"],
    directEnvKey: "CUBE2_CONTENT_SERVICE_BASE_URL",
    serviceGroupEnvKey: "CUBE2_CONTENT_SERVICE_GROUP",
    serviceNameEnvKey: "CUBE2_CONTENT_SERVICE_NAME",
  });
}

function buildTransport(baseUrl: string) {
  return createGrpcTransport({
    baseUrl,
    interceptors: [createCube2GrpcAuthInterceptor()],
  });
}

let knowledgeBaseClientPromise: Promise<ReturnType<typeof createClient<typeof KnowledgeBaseService>>> | null = null;

export function getKnowledgeBaseClient(): Promise<ReturnType<typeof createClient<typeof KnowledgeBaseService>>> {
  if (!knowledgeBaseClientPromise) {
    knowledgeBaseClientPromise = resolveContentServiceBaseUrl()
      .then((baseUrl) => buildTransport(baseUrl))
      .then((transport) => createClient(KnowledgeBaseService, transport))
      .catch((err: unknown) => {
        knowledgeBaseClientPromise = null;
        throw err;
      });
  }
  return knowledgeBaseClientPromise;
}

export interface Cube2ContentClients {
  getKnowledgeBaseClient: typeof getKnowledgeBaseClient;
}
