import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { projectContextAls } from '@cube-ai/server-shared'
import { BUILTIN_SYSTEM_API_KEY_ID, FlowRepository } from '../db/sqlite'
import { ApiKeysService } from './api-keys.service'

describe('api keys service', () => {
  test('creates project-scoped api key by default', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cube-ai-api-keys-'))
    try {
      mkdirSync(dir, { recursive: true })
      const repo = FlowRepository.open(join(dir, 'api-keys.sqlite'))
      const service = new ApiKeysService(repo)

      const tenantId = 'default'
      const created = await projectContextAls.run(
        { projectId: tenantId, bypassProjectIsolation: false },
        () => service.create({ name: 'project-key' }),
      )

      expect(created.summary.access_level).toBe('project')
      expect(created.summary.project_id).toBe(tenantId)

      const ctx = { projectId: tenantId, bypassProjectIsolation: false }
      expect(
        (await projectContextAls.run(ctx, () => service.list())).map((k: { id: string }) => k.id),
      ).toContain(created.summary.id)
      await projectContextAls.run(ctx, () => service.revoke(created.summary.id))
      expect(
        (await projectContextAls.run(ctx, () => service.list())).map((k: { id: string }) => k.id),
      ).not.toContain(created.summary.id)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('built-in system api key exists and cannot be revoked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cube-ai-api-keys-'))
    try {
      mkdirSync(dir, { recursive: true })
      const dbPath = join(dir, 'api-keys-builtin.sqlite')
      const repo = FlowRepository.open(dbPath)
      const service = new ApiKeysService(repo)

      const listed = await projectContextAls.run({ projectId: '', bypassProjectIsolation: true }, () => service.list())
      expect(listed.find((k: { id: string }) => k.id === BUILTIN_SYSTEM_API_KEY_ID)).toBeUndefined()

      const row = FlowRepository.open(dbPath).getApiKeyById(BUILTIN_SYSTEM_API_KEY_ID, null)
      expect(row?.access_level).toBe('system')

      await expect(
        projectContextAls.run({ projectId: '', bypassProjectIsolation: true }, () =>
          service.revoke(BUILTIN_SYSTEM_API_KEY_ID),
        ),
      ).rejects.toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
