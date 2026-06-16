import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { resolveRegistrationOptions } from './nacos-registration.wiring'

const ENV_KEYS = [
  'AI_CENTER_REGISTER_IP',
  'AI_CENTER_REGISTER_HOSTNAME',
  'AI_CENTER_REGISTER_PORT',
  'AI_CENTER_REGISTER_GRPC_PORT',
  'AI_CENTER_PORT',
  'AI_CENTER_GRPC_PORT',
  'APP_NAME',
] as const

describe('resolveRegistrationOptions', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
  })

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
  })

  it('registers the explicit advertise IP, never the container 0.0.0.0/127.0.0.1', () => {
    process.env.AI_CENTER_REGISTER_IP = '10.0.0.42'
    const opts = resolveRegistrationOptions()
    expect(opts.ip).toBe('10.0.0.42')
  })

  it('never advertises 0.0.0.0 even when register-hostname is 0.0.0.0', () => {
    process.env.AI_CENTER_REGISTER_HOSTNAME = '0.0.0.0'
    const opts = resolveRegistrationOptions()
    expect(opts.ip).not.toBe('0.0.0.0')
  })

  it('register grpc port prefers AI_CENTER_REGISTER_GRPC_PORT (host-published) over container port', () => {
    process.env.AI_CENTER_GRPC_PORT = '3110'
    process.env.AI_CENTER_REGISTER_GRPC_PORT = '31100'
    const opts = resolveRegistrationOptions()
    expect(opts.grpcPort).toBe(31100)
  })

  it('register grpc port falls back to AI_CENTER_GRPC_PORT when no override', () => {
    process.env.AI_CENTER_GRPC_PORT = '3120'
    const opts = resolveRegistrationOptions()
    expect(opts.grpcPort).toBe(3120)
  })

  it('register http port prefers AI_CENTER_REGISTER_PORT over AI_CENTER_PORT', () => {
    process.env.AI_CENTER_PORT = '3000'
    process.env.AI_CENTER_REGISTER_PORT = '30000'
    const opts = resolveRegistrationOptions()
    expect(opts.port).toBe(30000)
  })
})
