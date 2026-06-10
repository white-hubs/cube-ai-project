import { describe, expect, it } from 'bun:test'
import { normalizeNacosServerAddr, resolveCube2GrpcBaseUrl } from './cube2-grpc-endpoint'

describe('cube2-grpc-endpoint', () => {
  it('uses direct base URL when configured', async () => {
    const saved = process.env.CUBE2_FILE_SERVICE_BASE_URL
    process.env.CUBE2_FILE_SERVICE_BASE_URL = 'http://127.0.0.1:50051'

    const url = await resolveCube2GrpcBaseUrl({
      directEnvKey: 'CUBE2_FILE_SERVICE_BASE_URL',
      serviceNameEnvKey: 'CUBE2_FILE_SERVICE_NAME',
      serviceGroupEnvKey: 'CUBE2_FILE_SERVICE_GROUP',
      defaultServiceNames: ['cube-base-file', 'file'],
      clientLabel: 'cube2-file-client',
    })

    expect(url).toBe('http://127.0.0.1:50051')

    if (saved === undefined) delete process.env.CUBE2_FILE_SERVICE_BASE_URL
    else process.env.CUBE2_FILE_SERVICE_BASE_URL = saved
  })

  it('normalizes host:port nacos address to http URL', () => {
    expect(normalizeNacosServerAddr('192.168.0.243:8848')).toBe('http://192.168.0.243:8848')
  })

  it('falls back across default service names via nacos v1 API', async () => {
    const savedDirect = process.env.CUBE2_CONTENT_SERVICE_BASE_URL
    const savedAddress = process.env.NACOS_ADDRESS
    delete process.env.CUBE2_CONTENT_SERVICE_BASE_URL
    delete process.env.CUBE2_CONTENT_SERVICE_NAME
    process.env.NACOS_ADDRESS = '192.168.0.243:8848'

    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url.includes('serviceName=contentManagement')) {
        return Response.json({ hosts: [] })
      }
      if (url.includes('serviceName=content')) {
        return Response.json({
          hosts: [{
            ip: '10.0.0.8',
            port: 8080,
            healthy: true,
            enabled: true,
            metadata: { grpc_server_port: '9090' },
          }],
        })
      }
      return new Response('not found', { status: 404 })
    }

    const url = await resolveCube2GrpcBaseUrl({
      directEnvKey: 'CUBE2_CONTENT_SERVICE_BASE_URL',
      serviceNameEnvKey: 'CUBE2_CONTENT_SERVICE_NAME',
      serviceGroupEnvKey: 'CUBE2_CONTENT_SERVICE_GROUP',
      defaultServiceNames: ['contentManagement', 'content'],
      clientLabel: 'cube2-content-client',
      fetchImpl,
    })

    expect(url).toBe('http://10.0.0.8:9090')

    if (savedDirect === undefined) delete process.env.CUBE2_CONTENT_SERVICE_BASE_URL
    else process.env.CUBE2_CONTENT_SERVICE_BASE_URL = savedDirect
    if (savedAddress === undefined) delete process.env.NACOS_ADDRESS
    else process.env.NACOS_ADDRESS = savedAddress
  })
})
