import { MockRegistry } from '@cube-ai/server-mock'

const minimalSchema = (cubeType: string) => ({
  version: 1,
  cubeType,
  lfComponentKey: 'Mock',
  displayName: 'Mock Component',
  description: 'mock',
  componentToolModeDefault: false,
  outputs: [{ name: 'message', displayName: 'Message', types: ['Message'], toolMode: false, allowsLoop: false }],
  inputs: [],
})

const reg = MockRegistry.getInstance()

reg.define('components.catalog', false, () => ({ version: 1, components: [] }))

reg.define('components.schemaAll', false, () => ({ schemas: [] as ReturnType<typeof minimalSchema>[] }))

reg.define('components.schema', false, (_ctx, args) => {
  const raw = args[0] == null ? '' : String(args[0])
  const cubeType = raw.trim() || 'cube.lf.Mock'
  return minimalSchema(cubeType.startsWith('cube.lf.') ? cubeType : `cube.lf.${cubeType}`)
})

reg.define('components.schemaCustomDsl', false, (_ctx, args) => {
  const body = (args[0] as { cube_dsl?: unknown }) ?? {}
  void body.cube_dsl
  return minimalSchema('cube.lf.CustomComponent')
})
