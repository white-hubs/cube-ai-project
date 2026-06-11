import { describe, expect, test } from 'bun:test'
import { PrincipalType, SecurityContextHolder, type SecurityContext } from './security-context'

const sampleContext: SecurityContext = {
  principal: {
    id: 1001,
    type: PrincipalType.USER,
    admin: true,
    name: 'alice',
    account: 'alice@corp',
  },
  payload: { tenants: [900001] },
}

describe('SecurityContextHolder', () => {
  test('set/get/clear round-trip against the raw request context', () => {
    const raw: Record<string, unknown> = {}
    const holder = new SecurityContextHolder({ getContext: () => raw } as never)

    expect(holder.getContext()).toBeUndefined()
    holder.setContext(sampleContext)
    expect(holder.getContext()).toEqual(sampleContext)
    expect(holder.getPrincipal()?.id).toBe(1001)
    expect(holder.getRequiredPrincipal().account).toBe('alice@corp')

    holder.clearContext()
    expect(holder.getContext()).toBeUndefined()
    expect('securityContext' in raw).toBe(false)
  })

  test('getRequiredPrincipal throws when principal is absent', () => {
    const holder = new SecurityContextHolder({ getContext: () => ({}) } as never)
    expect(() => holder.getRequiredPrincipal()).toThrow('principal is missing')
  })

  test('operations are no-ops outside a request context', () => {
    const holder = new SecurityContextHolder({ getContext: () => undefined } as never)
    expect(holder.getContext()).toBeUndefined()
    expect(() => holder.setContext(sampleContext)).not.toThrow()
    expect(() => holder.clearContext()).not.toThrow()
    expect(holder.getPrincipal()).toBeUndefined()
  })
})
