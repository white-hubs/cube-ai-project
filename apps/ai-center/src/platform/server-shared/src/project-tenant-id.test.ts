import { describe, expect, test } from 'bun:test'
import {
  generateTenantProjectId,
  TENANT_PROJECT_ID_PREFIX,
  TENANT_PROJECT_ID_RANDOM_LENGTH,
} from './project-tenant-id'

describe('generateTenantProjectId', () => {
  test('format: prefix + fixed-length Base62 tail', () => {
    const id = generateTenantProjectId()
    expect(id.startsWith(TENANT_PROJECT_ID_PREFIX)).toBe(true)
    const tail = id.slice(TENANT_PROJECT_ID_PREFIX.length)
    expect(tail.length).toBe(TENANT_PROJECT_ID_RANDOM_LENGTH)
    expect(tail).toMatch(/^[0-9A-Za-z]{21}$/)
  })

  test('samples are unlikely to collide in a small batch', () => {
    const set = new Set<string>()
    for (let i = 0; i < 200; i++) set.add(generateTenantProjectId())
    expect(set.size).toBe(200)
  })
})
