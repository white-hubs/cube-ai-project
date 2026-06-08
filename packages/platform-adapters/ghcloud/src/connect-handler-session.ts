import { Context, contextStore } from '@dangao/bun-server'
import type { HandlerContext } from '@connectrpc/connect'
import { decodeGrpcInnerInvokeSignature } from './grpc-inner-invoke'
import { sessionContextHolder, type SessionContext } from './session-context'

export interface ConnectInnerInvokeValidationOptions {
  internalInvokeSecretKey?: string | null
}

export function validateConnectInnerInvoke(headers: Headers, options: ConnectInnerInvokeValidationOptions = {}): void {
  const secretKey = options.internalInvokeSecretKey?.trim()
  if (!secretKey) {
    return
  }
  const signature = headers.get('feign_inner_invoke')?.trim()
  if (!signature) {
    throw new Error('missing feign_inner_invoke')
  }
  const decoded = decodeGrpcInnerInvokeSignature(secretKey, signature)
  if (decoded.marker !== 'FEIGN_INNER_ORIGINAL') {
    throw new Error('invalid feign_inner_invoke marker')
  }
  if (decoded.expiresAtMs <= Date.now()) {
    throw new Error('feign_inner_invoke expired')
  }
}

/**
 * 与 {@link createSessionContextMiddleware} 一致：从请求头解析会话字段并写入 {@link sessionContextHolder}。
 * Connect/gRPC 独立端口未经过 HTTP 中间件时，需在 handler 内配合 {@link contextStore} 调用。
 */
export function buildSessionContextFromConnectHeaders(handlerContext: HandlerContext): SessionContext {
  const headers = handlerContext.requestHeader
  const tenantHeader = headers.get('tenant')
  const tenantRaw = tenantHeader?.trim() ?? ''
  const tenant = /^\d+$/.test(tenantRaw) ? tenantRaw : null
  let pathname = '/'
  let domain: string | null = null
  try {
    const u = new URL(handlerContext.url)
    pathname = u.pathname
    domain = u.host
  } catch {
    /* invalid url — keep defaults */
  }
  return {
    uri: pathname,
    host: 'grpc',
    domain,
    authorization: headers.get('authorization'),
    tenant,
    terminal: headers.get('terminal'),
    version: headers.get('version'),
    signature: headers.get('signature'),
    permission: headers.get('permission'),
  }
}

export async function runWithConnectHandlerSession<T>(
  handlerContext: HandlerContext,
  fn: () => Promise<T>,
  options: ConnectInnerInvokeValidationOptions = {},
): Promise<T> {
  validateConnectInnerInvoke(handlerContext.requestHeader, options)
  const req = new Request(handlerContext.url, {
    method: handlerContext.requestMethod,
    headers: handlerContext.requestHeader,
    signal: handlerContext.signal,
  })
  const ctx = new Context(req)
  const session = buildSessionContextFromConnectHeaders(handlerContext)
  return contextStore.run(ctx, async () => {
    sessionContextHolder.setContext(session)
    try {
      return await fn()
    } finally {
      sessionContextHolder.clearContext()
    }
  })
}

export function streamWithConnectHandlerSession<T>(
  handlerContext: HandlerContext,
  produce: () => AsyncIterable<T>,
  options: ConnectInnerInvokeValidationOptions = {},
): AsyncIterable<T> {
  validateConnectInnerInvoke(handlerContext.requestHeader, options)
  const req = new Request(handlerContext.url, {
    method: handlerContext.requestMethod,
    headers: handlerContext.requestHeader,
    signal: handlerContext.signal,
  })
  const ctx = new Context(req)
  const session = buildSessionContextFromConnectHeaders(handlerContext)
  return contextStore.run(ctx, async function* () {
    sessionContextHolder.setContext(session)
    try {
      yield* produce()
    } finally {
      sessionContextHolder.clearContext()
    }
  }) as AsyncIterable<T>
}
