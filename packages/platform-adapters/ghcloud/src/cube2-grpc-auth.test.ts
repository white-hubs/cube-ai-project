import { describe, expect, it, mock } from 'bun:test'
import { createCube2GrpcAuthInterceptor } from './cube2-grpc-auth'
import { cube2OutboundAuthAls } from './cube2-outbound-auth-context'

describe('createCube2GrpcAuthInterceptor', () => {
  it('forwards tenant and authorization from outbound auth ALS', async () => {
    const secret = '1234567890123456'
    process.env.CUBE2_INTERNAL_INVOKE_SECRET_KEY = secret

    const interceptor = createCube2GrpcAuthInterceptor()
    const next = mock(async (req: { header: Headers }) => {
      expect(req.header.get('tenant')).toBe('58197260')
      expect(req.header.get('authorization')).toBe('Bearer user-token')
      expect(req.header.get('feign_inner_invoke')).toBeTruthy()
      return {} as never
    })

    await cube2OutboundAuthAls.run(
      {
        tenant: '58197260',
        authorization: 'Bearer user-token',
      },
      async () =>
        interceptor(next)({
          header: new Headers(),
          message: {},
          method: {},
          service: {},
          url: 'http://example',
          signal: new AbortController().signal,
        } as never),
    )

    delete process.env.CUBE2_INTERNAL_INVOKE_SECRET_KEY
  })
})
