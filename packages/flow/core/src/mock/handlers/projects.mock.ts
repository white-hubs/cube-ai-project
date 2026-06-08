import { MockRegistry } from '@cube-ai/server-mock'

const mockProject = (id: string, name: string, description: string) => ({
  id,
  name,
  description,
  create_time: '2025-01-01T00:00:00.000Z',
  update_time: '2025-01-01T00:00:00.000Z',
})

MockRegistry.getInstance().define(
  'projects.list',
  false,
  () => [mockProject('mock-project-1', 'Mock Project', 'Mock description')],
)

MockRegistry.getInstance().define(
  'projects.create',
  false,
  (_ctx, args) => {
    const body = (args[0] as { name?: string; description?: string }) ?? {}
    const id = crypto.randomUUID()
    return mockProject(id, body.name?.trim() || 'mock', body.description?.trim() ?? '')
  },
)

MockRegistry.getInstance().define(
  'projects.get',
  false,
  (_ctx, args) => {
    const id = String(args[0] ?? 'mock-id')
    return mockProject(id, `Project ${id}`, '')
  },
)

MockRegistry.getInstance().define(
  'projects.update',
  false,
  (_ctx, args) => {
    const id = String(args[0] ?? 'mock-id')
    const body = (args[1] as { name?: string; description?: string }) ?? {}
    return mockProject(id, body.name?.trim() ?? 'updated', body.description?.trim() ?? '')
  },
)

MockRegistry.getInstance().define(
  'projects.remove',
  false,
  () => ({ deleted: true }),
)
