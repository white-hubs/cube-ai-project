import { describe, expect, test } from 'bun:test'
import { NacosServiceRegistrationService } from '@cube-ai/bun-server-ext-nacos'
import { AiCenterAssembler } from './ai-center-assembler'

describe('AiCenterAssembler nacos registration wiring', () => {
  test('registration service resolves from container', () => {
    const app = new AiCenterAssembler({ port: 0 }).assemble()
    const svc = app.getContainer().resolve(NacosServiceRegistrationService)
    expect(svc).toBeInstanceOf(NacosServiceRegistrationService)
  })
})
