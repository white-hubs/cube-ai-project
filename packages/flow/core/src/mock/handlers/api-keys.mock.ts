import { MockRegistry } from '@cube-ai/server-mock'

const now = () => new Date().toISOString()

MockRegistry.getInstance().define(
  'api-keys.list',
  false,
  () => [
    {
      id: 'mock-key-id',
      name: 'mock-list-key',
      key_prefix: 'mock_pref_',
      flow_id: null,
      scopes: ['run'],
      allowed_tools: [],
      project_id: 'mock-project',
      access_level: 'project',
      expires_at: null,
      create_time: now(),
      last_used_at: null,
    },
  ],
)

MockRegistry.getInstance().define(
  'api-keys.create',
  false,
  (_ctx, args) => {
    const body = (args[0] as Record<string, unknown>) ?? {}
    const name = typeof body['name'] === 'string' ? body['name'] : 'mock-key'
    const id = `mock-key-${crypto.randomUUID()}`
    const secret = 'mock_full_secret_replace_me'
    const summary = {
      id,
      name,
      key_prefix: secret.slice(0, 10),
      flow_id: typeof body['flow_id'] === 'string' ? body['flow_id'] : null,
      scopes: Array.isArray(body['scopes']) ? (body['scopes'] as string[]) : ['run'],
      allowed_tools: [],
      project_id: 'mock-project',
      access_level: 'project',
      expires_at: null,
      create_time: now(),
      last_used_at: null,
    }
    return { summary, secret }
  },
)

MockRegistry.getInstance().define(
  'api-keys.revoke',
  false,
  () => ({ revoked: true as const }),
)
