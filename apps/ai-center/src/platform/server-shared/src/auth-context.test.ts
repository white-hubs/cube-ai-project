import { describe, expect, test } from 'bun:test'
import { authenticatedUserAls, type AuthenticatedUserContext } from './auth-context'

const superAdmin: AuthenticatedUserContext = {
  userId: 'u1',
  username: 'admin',
  role: 'super_admin',
  isSuperAdmin: true,
}

describe('authenticatedUserAls', () => {
  test('has no store outside run', () => {
    expect(authenticatedUserAls.getStore()).toBeUndefined()
  })

  test('exposes the authenticated user inside run', () => {
    authenticatedUserAls.run(superAdmin, () => {
      const store = authenticatedUserAls.getStore()
      expect(store?.userId).toBe('u1')
      expect(store?.username).toBe('admin')
      expect(store?.role).toBe('super_admin')
      expect(store?.isSuperAdmin).toBe(true)
    })
  })

  test('survives async boundaries within the same run', async () => {
    await authenticatedUserAls.run(superAdmin, async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(authenticatedUserAls.getStore()?.username).toBe('admin')
    })
  })

  test('isolates concurrent runs from each other', async () => {
    const seen: string[] = []
    await Promise.all([
      authenticatedUserAls.run({ ...superAdmin, userId: 'a' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        seen.push(authenticatedUserAls.getStore()?.userId ?? 'missing')
      }),
      authenticatedUserAls.run({ ...superAdmin, userId: 'b' }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        seen.push(authenticatedUserAls.getStore()?.userId ?? 'missing')
      }),
    ])
    expect(seen.sort()).toEqual(['a', 'b'])
  })

  test('does not leak after run completes', async () => {
    await authenticatedUserAls.run(superAdmin, async () => {})
    expect(authenticatedUserAls.getStore()).toBeUndefined()
  })
})
