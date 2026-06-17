import { describe, expect, test } from 'bun:test'
import { currentTenantId, isGlobalAccessEnabled } from './access-scope'
import { tenantContextAls } from './tenant-context'

describe('currentTenantId', () => {
  test('空上下文返回 null', () => {
    expect(currentTenantId()).toBeNull()
  })

  test('tenantContextAls.run 内返回正确 tenantId', () => {
    tenantContextAls.run({ tenantId: '42' }, () => {
      expect(currentTenantId()).toBe('42')
    })
  })

  test('去除首尾空白', () => {
    tenantContextAls.run({ tenantId: '  58197260  ' }, () => {
      expect(currentTenantId()).toBe('58197260')
    })
  })

  test('纯空白 tenantId 视为 null', () => {
    tenantContextAls.run({ tenantId: '   ' }, () => {
      expect(currentTenantId()).toBeNull()
    })
  })

  test('run 结束后上下文不泄漏', () => {
    tenantContextAls.run({ tenantId: '42' }, () => {})
    expect(currentTenantId()).toBeNull()
  })

  test('嵌套 run 内层遮蔽外层，退出后恢复', () => {
    tenantContextAls.run({ tenantId: 'outer' }, () => {
      tenantContextAls.run({ tenantId: 'inner' }, () => {
        expect(currentTenantId()).toBe('inner')
      })
      expect(currentTenantId()).toBe('outer')
    })
  })
})

describe('isGlobalAccessEnabled', () => {
  test('无租户上下文时为 false', () => {
    expect(isGlobalAccessEnabled()).toBe(false)
  })

  test('bypassTenantIsolation 未设置或为 false 时为 false', () => {
    tenantContextAls.run({ tenantId: '1' }, () => {
      expect(isGlobalAccessEnabled()).toBe(false)
    })
    tenantContextAls.run({ tenantId: '1', bypassTenantIsolation: false }, () => {
      expect(isGlobalAccessEnabled()).toBe(false)
    })
  })

  test('bypassTenantIsolation === true 时为 true', () => {
    tenantContextAls.run({ tenantId: '1', bypassTenantIsolation: true }, () => {
      expect(isGlobalAccessEnabled()).toBe(true)
    })
  })
})
