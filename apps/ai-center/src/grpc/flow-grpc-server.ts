import * as http2 from 'node:http2'
import { connectNodeAdapter } from '@connectrpc/connect-node'
import { FlowServiceGrpc } from '@cube-ai/platform-adapter-ghcloud'
import { createFlowGrpcServiceImpl } from './flow-grpc.service'
import type { FlowGrpcBackend } from './flow-grpc-backend'

export interface StartFlowGrpcServerOptions {
  port: number
  hostname?: string
  flowService: FlowGrpcBackend
  internalInvokeSecretKey?: string | null
}

export interface StartedFlowGrpcServer {
  port: number
  hostname: string
  close: () => Promise<void>
}

export async function startFlowGrpcServer(
  options: StartFlowGrpcServerOptions,
): Promise<StartedFlowGrpcServer> {
  const hostname = options.hostname ?? '0.0.0.0'
  const handler = connectNodeAdapter({
    routes(router) {
      router.service(FlowServiceGrpc, createFlowGrpcServiceImpl(options.flowService, {
        internalInvokeSecretKey: options.internalInvokeSecretKey,
      }))
    },
  })
  const server = http2.createServer(handler)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, hostname, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  const boundPort =
    address && typeof address === 'object' && typeof address.port === 'number'
      ? address.port
      : options.port

  return {
    port: boundPort,
    hostname,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolve()
        })
      })
    },
  }
}
