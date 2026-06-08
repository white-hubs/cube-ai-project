import { MockRegistry } from '@cube-ai/server-mock'

MockRegistry.getInstance().define(
  'auth.token',
  false,
  () => ({
    token_type: 'Bearer',
    access_token: 'mock_access_token',
    refresh_token: 'mock_refresh_token',
    expires_in: 7200,
    refresh_expires_in: 1209600,
    scope: 'super_admin',
    role: 'super_admin',
  }),
)

MockRegistry.getInstance().define(
  'auth.me',
  false,
  () => ({
    id: 'mock-super-admin',
    username: 'admin',
    role: 'super_admin',
    isSuperAdmin: true,
  }),
)
