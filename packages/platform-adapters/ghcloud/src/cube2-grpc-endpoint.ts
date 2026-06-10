/**
 * Shared endpoint resolution for cube2 gRPC clients (file / content).
 *
 * Direct URL env keys are service-specific; Nacos discovery shares:
 *   NACOS_ADDRESS or NACOS_SERVER_ADDR (ghcloud alias)
 *   NACOS_NAMESPACE_ID or NACOS_NAMESPACE
 *   NACOS_USERNAME / NACOS_PASSWORD
 *
 * Nacos lookup uses v1 Open API (same as ghcloud ai-server-base), including
 * grpc_server_port metadata and comma-separated service name fallbacks.
 */

import {
  nacosFetchInstancesV1,
  nacosListAllServiceRefsInNamespace,
  pickGrpcInstance,
  resolveGrpcPort,
} from './nacos-v1-discovery'

export interface ResolveCube2GrpcBaseUrlOptions {
  directEnvKey: string
  serviceNameEnvKey: string
  serviceGroupEnvKey: string
  defaultServiceNames: string[]
  clientLabel: string
  fetchImpl?: typeof fetch
}

function readEnv(key: string): string | undefined {
  const raw = Bun.env[key] ?? process.env[key]
  const trimmed = raw?.trim()
  return trimmed ? trimmed : undefined
}

function readNacosAddress(): string | undefined {
  const raw = readEnv('NACOS_ADDRESS') ?? readEnv('NACOS_SERVER_ADDR')
  return raw ? normalizeNacosServerAddr(raw) : undefined
}

export function normalizeNacosServerAddr(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') {
    return 'http://127.0.0.1:8848'
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/$/, '')
  }
  return (trimmed.includes(':') ? `http://${trimmed}` : `http://${trimmed}:8848`).replace(/\/$/, '')
}

function readNacosNamespaceId(): string | undefined {
  return readEnv('NACOS_NAMESPACE_ID') ?? readEnv('NACOS_NAMESPACE')
}

function readServiceNameCandidates(envKey: string, defaults: string[]): string[] {
  const raw = readEnv(envKey)
  if (!raw) {
    return defaults
  }
  const names = raw.split(',').map((item) => item.trim()).filter((item) => item !== '')
  return names.length > 0 ? names : defaults
}

function formatServiceHints(
  refs: Array<{ serviceName: string; groupName: string }>,
  keyword: string,
): string {
  const normalizedKeyword = keyword.toLowerCase()
  const matches = refs
    .filter((ref) => ref.serviceName.toLowerCase().includes(normalizedKeyword))
    .slice(0, 12)
    .map((ref) => `${ref.groupName}@@${ref.serviceName}`)
  if (matches.length === 0) {
    return refs.slice(0, 12).map((ref) => `${ref.groupName}@@${ref.serviceName}`).join(', ')
  }
  return matches.join(', ')
}

export async function resolveCube2GrpcBaseUrl(
  options: ResolveCube2GrpcBaseUrlOptions,
): Promise<string> {
  const direct = readEnv(options.directEnvKey)
  if (direct) {
    return direct
  }

  const nacosBase = readNacosAddress()
  if (!nacosBase) {
    throw new Error(
      `${options.clientLabel}: set ${options.directEnvKey} or NACOS_ADDRESS (or NACOS_SERVER_ADDR) to resolve the service endpoint`,
    )
  }

  const namespaceId = readNacosNamespaceId()
  const username = readEnv('NACOS_USERNAME')
  const password = readEnv('NACOS_PASSWORD')
  const groupName = readEnv(options.serviceGroupEnvKey) ?? 'DEFAULT_GROUP'
  const serviceNames = readServiceNameCandidates(options.serviceNameEnvKey, options.defaultServiceNames)

  for (const serviceName of serviceNames) {
    const instances = await nacosFetchInstancesV1({
      nacosBase,
      namespaceId,
      groupName,
      serviceName,
      username,
      password,
      fetchImpl: options.fetchImpl,
    })
    const picked = pickGrpcInstance(instances)
    if (picked) {
      return `http://${picked.ip}:${resolveGrpcPort(picked)}`
    }
  }

  let hint = ''
  try {
    const refs = await nacosListAllServiceRefsInNamespace({
      nacosBase,
      namespaceId,
      username,
      password,
      fetchImpl: options.fetchImpl,
    })
    if (refs.length > 0) {
      const keyword = options.defaultServiceNames[0]?.includes('file') ? 'file' : 'content'
      hint = ` Nacos services in namespace '${namespaceId ?? 'public'}' (sample): ${formatServiceHints(refs, keyword)}.`
    }
  } catch {
    /* ignore hint failures */
  }

  throw new Error(
    `${options.clientLabel}: no healthy nacos instance for service name candidates [${serviceNames.join(', ')}] group='${groupName}'.` +
      ` Check NACOS_NAMESPACE / service env ${options.serviceNameEnvKey}.${hint}`,
  )
}
