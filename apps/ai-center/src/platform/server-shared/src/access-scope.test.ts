import { describe, expect, test } from 'bun:test'
import { currentTenantId, isGlobalAccessEnabled } from './access-scope'
import { tenantContextAls } from './tenant-context'

describe('currentTenantId', () => {
  test('returns null when no tenant context is active', () => {
    expect(currentTenantId()).toBeNull()
  })

  test('returns the tenant id inside tenantContextAls.run', () => {
    tenantContextAls.run({ tenantId: '42' }, () => {
      expect(currentTenantId()).toBe('42')
    })
  })

  test('trims surrounding whitespace', () => {
    tenantContextAls.run({ tenantId: '  58197260  ' }, () => {
      expect(currentTenantId()).toBe('58197260')
    })
  })

  test('treats blank tenant id as null', () => {
    tenantContextAls.run({ tenantId: '   ' }, () => {
      expect(currentTenantId()).toBeNull()
    })
  })

  test('context does not leak outside run', () => {
    tenantContextAls.run({ tenantId: '42' }, () => {})
    expect(currentTenantId()).toBeNull()
  })

  test('nested run shadows then restores the outer tenant', () => {
    tenantContextAls.run({ tenantId: 'outer' }, () => {
      tenantContextAls.run({ tenantId: 'inner' }, () => {
        expect(currentTenantId()).toBe('inner')
      })
      expect(currentTenantId()).toBe('outer')
    })
  })
})

describe('isGlobalAccessEnabled', () => {
  test('is false without tenant context', () => {
    expect(isGlobalAccessEnabled()).toBe(false)
  })

  test('is false when bypassTenantIsolation is unset or false', () => {
    tenantContextAls.run({ tenantId: '1' }, () => {
      expect(isGlobalAccessEnabled()).toBe(false)
    })
    tenantContextAls.run({ tenantId: '1', bypassTenantIsolation: false }, () => {
      expect(isGlobalAccessEnabled()).toBe(false)
    })
  })

  test('is true only when bypassTenantIsolation === true', () => {
    tenantContextAls.run({ tenantId: '1', bypassTenantIsolation: true }, () => {
      expect(isGlobalAccessEnabled()).toBe(true)
    })
  })
})
