/**
 * Lazy gRPC client factory for cube2 file service (FileOperate + FileCore).
 *
 * Transport is created on first call; boot never connects to any remote service.
 * Resolution order for base URL:
 *   1. env CUBE2_FILE_SERVICE_BASE_URL (direct)
 *   2. Nacos naming lookup via NACOS_ADDRESS / NACOS_SERVER_ADDR
 *      + CUBE2_FILE_SERVICE_NAME / CUBE2_FILE_SERVICE_GROUP
 *
 * If CUBE2_INTERNAL_INVOKE_SECRET_KEY is set, the feign_inner_invoke header is injected.
 */

import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";

import { createCube2GrpcAuthInterceptor } from "./cube2-grpc-auth";
import { resolveCube2GrpcBaseUrl } from "./cube2-grpc-endpoint";
import { FileCoreService } from "./grpc-gen/guhecloud/cube/base/file/grpc/v1/file_core_service_pb";
import { FileOperateService } from "./grpc-gen/guhecloud/cube/base/file/grpc/v1/file_operate_service_pb";

async function resolveFileServiceBaseUrl(): Promise<string> {
  return resolveCube2GrpcBaseUrl({
    clientLabel: "cube2-file-client",
    defaultServiceNames: ["cube-base-file", "file"],
    directEnvKey: "CUBE2_FILE_SERVICE_BASE_URL",
    serviceGroupEnvKey: "CUBE2_FILE_SERVICE_GROUP",
    serviceNameEnvKey: "CUBE2_FILE_SERVICE_NAME",
  });
}

function buildTransport(baseUrl: string) {
  return createGrpcTransport({
    baseUrl,
    interceptors: [createCube2GrpcAuthInterceptor()],
  });
}

let fileOperateClientPromise: Promise<ReturnType<typeof createClient<typeof FileOperateService>>> | null = null;
let fileCoreClientPromise: Promise<ReturnType<typeof createClient<typeof FileCoreService>>> | null = null;

function buildClients() {
  const transportPromise = resolveFileServiceBaseUrl().then((baseUrl) => buildTransport(baseUrl));

  const operateP = transportPromise.then((t) => createClient(FileOperateService, t));
  const coreP = transportPromise.then((t) => createClient(FileCoreService, t));

  const clearOnError = (p: Promise<unknown>) =>
    p.catch((err: unknown) => {
      fileOperateClientPromise = null;
      fileCoreClientPromise = null;
      throw err;
    });

  return {
    coreP: clearOnError(coreP) as typeof coreP,
    operateP: clearOnError(operateP) as typeof operateP,
  };
}

export function getFileOperateClient(): Promise<ReturnType<typeof createClient<typeof FileOperateService>>> {
  if (!fileOperateClientPromise) {
    const { operateP, coreP } = buildClients();
    fileOperateClientPromise = operateP;
    fileCoreClientPromise = coreP;
  }
  return fileOperateClientPromise;
}

export function getFileCoreClient(): Promise<ReturnType<typeof createClient<typeof FileCoreService>>> {
  if (!fileCoreClientPromise) {
    const { operateP, coreP } = buildClients();
    fileOperateClientPromise = operateP;
    fileCoreClientPromise = coreP;
  }
  return fileCoreClientPromise;
}

export interface Cube2FileClients {
  getFileOperateClient: typeof getFileOperateClient;
  getFileCoreClient: typeof getFileCoreClient;
}
