import { describe, expect, mock, test } from 'bun:test'
import type { ServiceInstance, ServiceRegistry } from '@dangao/bun-server'
import {
  NacosServiceRegistrationService,
  type NacosRegistrationOptions,
} from './service-registration.service'

function fakeRegistry() {
  const calls = { register: [] as ServiceInstance[], deregister: 0, close: 0 }
  const registry: ServiceRegistry = {
    register: mock(async (i: ServiceInstance) => {
      calls.register.push(i)
    }),
    deregister: mock(async () => {
      calls.deregister += 1
    }),
    renew: mock(async () => {}),
    close: mock(async () => {
      calls.close += 1
    }),
    getInstances: mock(async () => []),
    watchInstances: mock(() => () => {}),
  } as unknown as ServiceRegistry
  return { registry, calls }
}

const opts: NacosRegistrationOptions = {
  serviceName: 'aiCenter',
  ip: '127.0.0.1',
  port: 3210,
  grpcPort: 3110,
  refreshTtlMs: 0, // disable periodic refresh timer in tests
}

describe('NacosServiceRegistrationService', () => {
  test('registers with grpc_server_port metadata on init', async () => {
    const { registry, calls } = fakeRegistry()
    const svc = new NacosServiceRegistrationService(registry, opts)
    await svc.onModuleInit()
    expect(calls.register.length).toBe(1)
    expect(calls.register[0]?.metadata?.grpc_server_port).toBe('3110')
    expect(svc.isConnected()).toBe(true)
    await svc.onModuleDestroy()
    expect(calls.deregister).toBe(1)
    expect(calls.close).toBe(1)
  })

  test('survives registry failure (connected=false, no throw)', async () => {
    const registry = {
      register: mock(async () => {
        throw new Error('nacos down')
      }),
      deregister: mock(async () => {}),
      renew: mock(async () => {}),
      close: mock(async () => {}),
      getInstances: mock(async () => []),
      watchInstances: mock(() => () => {}),
    } as unknown as ServiceRegistry
    const svc = new NacosServiceRegistrationService(registry, opts)
    await svc.onModuleInit()
    expect(svc.isConnected()).toBe(false)
    await svc.onModuleDestroy()
  })

  test('skips register when registerEnabled=false', async () => {
    const { registry, calls } = fakeRegistry()
    const svc = new NacosServiceRegistrationService(registry, {
      ...opts,
      registerEnabled: false,
    })
    await svc.onModuleInit()
    expect(calls.register.length).toBe(0)
    expect(svc.isConnected()).toBe(false)
    await svc.onModuleDestroy()
    expect(calls.deregister).toBe(0)
    expect(calls.close).toBe(0)
  })
})
