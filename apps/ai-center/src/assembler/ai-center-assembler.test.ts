import { describe, expect, test } from 'bun:test'
import { NacosServiceRegistrationService } from '@cube-ai/bun-server-ext-nacos'
import { FlowService } from '@cube-ai/flow-studio'
import { AiCenterAssembler } from './ai-center-assembler'

describe('AiCenterAssembler nacos registration wiring', () => {
  test('registration service resolves from container', () => {
    const app = new AiCenterAssembler({ port: 0 }).assemble()
    const svc = app.getContainer().resolve(NacosServiceRegistrationService)
    expect(svc).toBeInstanceOf(NacosServiceRegistrationService)
  })

  test('flow studio service resolves from the application root container', () => {
    const app = new AiCenterAssembler({ port: 0 }).assemble()
    const svc = app.getContainer().resolve(FlowService)
    expect(svc).toBeInstanceOf(FlowService)
  })
})
