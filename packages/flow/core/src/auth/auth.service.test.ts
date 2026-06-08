import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { FlowRepository } from '../db/sqlite'
import { AuthService } from './auth.service'

describe('auth service', () => {
  test('password grant issues token pair and refresh rotates tokens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cube-ai-auth-'))
    const prevUsername = process.env.CUBE_SUPER_ADMIN_USERNAME
    const prevPassword = process.env.CUBE_SUPER_ADMIN_PASSWORD
    try {
      mkdirSync(dir, { recursive: true })
      process.env.CUBE_SUPER_ADMIN_USERNAME = 'admin'
      process.env.CUBE_SUPER_ADMIN_PASSWORD = 'Secret123!'
      const repo = FlowRepository.open(join(dir, 'auth.sqlite'))
      const auth = new AuthService(repo)

      const token = await auth.issueToken({
        grant_type: 'password',
        username: 'admin',
        password: 'Secret123!',
      })
      expect(token.token_type).toBe('Bearer')
      expect(token.access_token.length).toBeGreaterThan(10)
      expect(token.refresh_token.length).toBeGreaterThan(10)

      const me = await auth.verifyAccessToken(token.access_token)
      expect(me?.username).toBe('admin')
      expect(me?.isSuperAdmin).toBe(true)

      const refreshed = await auth.issueToken({
        grant_type: 'refresh_token',
        refresh_token: token.refresh_token,
      })
      expect(refreshed.access_token).not.toBe(token.access_token)
      expect(refreshed.refresh_token).not.toBe(token.refresh_token)
      expect((await auth.verifyAccessToken(refreshed.access_token))?.username).toBe('admin')
    } finally {
      if (prevUsername === undefined) delete process.env.CUBE_SUPER_ADMIN_USERNAME
      else process.env.CUBE_SUPER_ADMIN_USERNAME = prevUsername
      if (prevPassword === undefined) delete process.env.CUBE_SUPER_ADMIN_PASSWORD
      else process.env.CUBE_SUPER_ADMIN_PASSWORD = prevPassword
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
