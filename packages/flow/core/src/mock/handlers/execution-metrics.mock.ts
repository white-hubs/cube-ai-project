import { MockRegistry } from '@cube-ai/server-mock'

MockRegistry.getInstance().define(
  'metrics.summary',
  false,
  () => ({
    recentCount: 0,
    byFlow: {},
    byApiKey: {},
    byProjectId: {},
  }),
)

MockRegistry.getInstance().define(
  'metrics.recent',
  false,
  () => [],
)
