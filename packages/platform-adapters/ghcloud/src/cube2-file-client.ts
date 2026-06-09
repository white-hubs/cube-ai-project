/**
 * Lazy gRPC client factory for cube2 file service (FileOperate + FileCore).
 *
 * Transport is created on first call; boot never connects to any remote service.
 * Resolution order for base URL:
 *   1. env CUBE2_FILE_SERVICE_BASE_URL (direct)
 *   2. Nacos naming lookup via NACOS_ADDRESS + CUBE2_FILE_SERVICE_NAME / CUBE2_FILE_SERVICE_GROUP
 *
 * If CUBE2_INTERNAL_INVOKE_SECRET_KEY is set, the feign_inner_invoke header is injected.
 */

import { createClient, type Interceptor } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { NacosClient, NacosServiceClient } from '@dangao/nacos-client'

import { FileCoreService } from './grpc-gen/guhecloud/cube/base/file/grpc/v1/file_core_service_pb'
import { FileOperateService } from './grpc-gen/guhecloud/cube/base/file/grpc/v1/file_operate_service_pb'
import { createGrpcInnerInvokeSignature } from './grpc-inner-invoke'

async function resolveFileServiceBaseUrl(): Promise<string> {
  const direct = process.env['CUBE2_FILE_SERVICE_BASE_URL']?.trim()
  if (direct) return direct

  // TODO(主 agent 复核): NACOS_ADDRESS, NACOS_NAMESPACE_ID, NACOS_USERNAME, NACOS_PASSWORD
  // env vars must be set in the ghcloud deployment environment.
  const nacosAddress = process.env['NACOS_ADDRESS']?.trim()
  if (!nacosAddress) {
    throw new Error(
      'cube2-file-client: set CUBE2_FILE_SERVICE_BASE_URL or NACOS_ADDRESS to resolve the file service endpoint',
    )
  }

  const nacosClient = new NacosClient({
    serverList: [nacosAddress],
    namespaceId: process.env['NACOS_NAMESPACE_ID']?.trim() || undefined,
    username: process.env['NACOS_USERNAME']?.trim() || undefined,
    password: process.env['NACOS_PASSWORD']?.trim() || undefined,
  })

  const serviceClient = new NacosServiceClient(nacosClient)
  const serviceName =
    process.env['CUBE2_FILE_SERVICE_NAME']?.trim() || 'file'
  const groupName =
    process.env['CUBE2_FILE_SERVICE_GROUP']?.trim() || 'DEFAULT_GROUP'

  const instances = await serviceClient.getInstances({
    serviceName,
    groupName,
    healthyOnly: true,
  })

  const healthy = instances.filter(
    (i) => i.healthy !== false && i.enabled !== false,
  )
  if (healthy.length === 0) {
    throw new Error(
      `cube2-file-client: no healthy nacos instance for service='${serviceName}' group='${groupName}'`,
    )
  }

  // Pick first healthy instance (load-balancing left to caller / future improvement)
  const instance = healthy[0]!
  return `http://${instance.ip}:${instance.port}`
}

function createInnerInvokeInterceptor(): Interceptor {
  return (next) => (req) => {
    const secretKey = process.env['CUBE2_INTERNAL_INVOKE_SECRET_KEY']?.trim()
    if (secretKey) {
      const sig = createGrpcInnerInvokeSignature(secretKey, Date.now() + 60_000)
      req.header.set('feign_inner_invoke', sig)
    }
    return next(req)
  }
}

// Lazy-initialized transports (one per base URL resolution; cleared on failure).
let fileOperateClientPromise: Promise<ReturnType<typeof createClient<typeof FileOperateService>>> | null = null
let fileCoreClientPromise: Promise<ReturnType<typeof createClient<typeof FileCoreService>>> | null = null

function buildClients() {
  const transportPromise = resolveFileServiceBaseUrl().then((baseUrl) =>
    createGrpcTransport({
      baseUrl,
      interceptors: [createInnerInvokeInterceptor()],
    }),
  )

  const operateP = transportPromise.then((t) =>
    createClient(FileOperateService, t),
  )
  const coreP = transportPromise.then((t) =>
    createClient(FileCoreService, t),
  )

  // Clear cache on failure so the next call retries resolution
  const clearOnError = (p: Promise<unknown>) =>
    p.catch((err: unknown) => {
      fileOperateClientPromise = null
      fileCoreClientPromise = null
      throw err
    })

  return {
    operateP: clearOnError(operateP) as typeof operateP,
    coreP: clearOnError(coreP) as typeof coreP,
  }
}

export function getFileOperateClient(): Promise<
  ReturnType<typeof createClient<typeof FileOperateService>>
> {
  if (!fileOperateClientPromise) {
    const { operateP, coreP } = buildClients()
    fileOperateClientPromise = operateP
    fileCoreClientPromise = coreP
  }
  return fileOperateClientPromise
}

export function getFileCoreClient(): Promise<
  ReturnType<typeof createClient<typeof FileCoreService>>
> {
  if (!fileCoreClientPromise) {
    const { operateP, coreP } = buildClients()
    fileOperateClientPromise = operateP
    fileCoreClientPromise = coreP
  }
  return fileCoreClientPromise
}

export type Cube2FileClients = {
  getFileOperateClient: typeof getFileOperateClient
  getFileCoreClient: typeof getFileCoreClient
}
