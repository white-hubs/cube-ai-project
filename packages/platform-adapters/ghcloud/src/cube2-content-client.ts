/**
 * Lazy gRPC client factory for cube2 content service (KnowledgeBaseService).
 *
 * Transport is created on first call; boot never connects to any remote service.
 * Resolution order for base URL:
 *   1. env CUBE2_CONTENT_SERVICE_BASE_URL (direct)
 *   2. Nacos naming lookup via NACOS_ADDRESS + CUBE2_CONTENT_SERVICE_NAME / CUBE2_CONTENT_SERVICE_GROUP
 *
 * If CUBE2_INTERNAL_INVOKE_SECRET_KEY is set, the feign_inner_invoke header is injected.
 */

import { createClient, type Interceptor } from '@connectrpc/connect'
import { createGrpcTransport } from '@connectrpc/connect-node'
import { NacosClient, NacosServiceClient } from '@dangao/nacos-client'

import { KnowledgeBaseService } from './grpc-gen/guhecloud/cube/apps/content/management/grpc/v1/knowledge_base_pb'
import { createGrpcInnerInvokeSignature } from './grpc-inner-invoke'

async function resolveContentServiceBaseUrl(): Promise<string> {
  const direct = process.env['CUBE2_CONTENT_SERVICE_BASE_URL']?.trim()
  if (direct) return direct

  const nacosAddress = process.env['NACOS_ADDRESS']?.trim()
  if (!nacosAddress) {
    throw new Error(
      'cube2-content-client: set CUBE2_CONTENT_SERVICE_BASE_URL or NACOS_ADDRESS to resolve the content service endpoint',
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
    process.env['CUBE2_CONTENT_SERVICE_NAME']?.trim() || 'content'
  const groupName =
    process.env['CUBE2_CONTENT_SERVICE_GROUP']?.trim() || 'DEFAULT_GROUP'

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
      `cube2-content-client: no healthy nacos instance for service='${serviceName}' group='${groupName}'`,
    )
  }

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

let knowledgeBaseClientPromise: Promise<ReturnType<typeof createClient<typeof KnowledgeBaseService>>> | null = null

export function getKnowledgeBaseClient(): Promise<
  ReturnType<typeof createClient<typeof KnowledgeBaseService>>
> {
  if (!knowledgeBaseClientPromise) {
    knowledgeBaseClientPromise = resolveContentServiceBaseUrl()
      .then((baseUrl) =>
        createGrpcTransport({
          baseUrl,
          interceptors: [createInnerInvokeInterceptor()],
        }),
      )
      .then((transport) => createClient(KnowledgeBaseService, transport))
      .catch((err: unknown) => {
        knowledgeBaseClientPromise = null
        throw err
      })
  }
  return knowledgeBaseClientPromise
}

export type Cube2ContentClients = {
  getKnowledgeBaseClient: typeof getKnowledgeBaseClient
}
