import { describe, expect, it } from 'bun:test'
import { pickGrpcInstance, resolveGrpcPort } from './nacos-v1-discovery'

describe('nacos-v1-discovery', () => {
  it('prefers grpc_server_port metadata over registered port', () => {
    const picked = pickGrpcInstance([
      {
        ip: '10.0.0.8',
        port: 8080,
        healthy: true,
        enabled: true,
        metadata: { grpc_server_port: '9090' },
      },
    ])
    expect(picked).not.toBeNull()
    expect(resolveGrpcPort(picked!)).toBe(9090)
  })
})
