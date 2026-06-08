import { describe, expect, test } from 'bun:test'
import { authenticatedUserAls, developerApiAls, projectContextAls } from '@cube-ai/server-shared'
import { createExecutionAuthMiddleware } from './execution-auth.middleware'
import type { AccessTokenReader, DeveloperApiKeyReader, ProjectLookup } from './middleware-types'

function createCtx(path: string, headers: Record<string, string>, method = 'POST') {
  const normalized = new Headers(headers)
  return {
    path,
    request: new Request(`http://localhost${path}`, {
      method,
      headers: normalized,
    }),
  }
}

describe('execution auth middleware', () => {
  const projectLookup: ProjectLookup = {
    listProjectIds() {
      return ['project-a', 'project-b']
    },
    hasProject(projectId: string) {
      return projectId === 'project-a' || projectId === 'project-b'
    },
  }

  test('allows /health without bearer token or api key', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: { verifyAccessToken: () => null },
      apiKeyReader: { verifyApiKeyRaw: () => null },
      projectLookup,
    })
    let passed = false
    await middleware(createCtx('/health', {}, 'GET') as never, async () => {
      passed = true
    })
    expect(passed).toBe(true)
  })

  test('allows run request with bearer token and project header', async () => {
    const accessTokenReader: AccessTokenReader = {
      verifyAccessToken(rawToken: string) {
        if (rawToken !== 'good-token') return null
        return {
          userId: 'u1',
          username: 'admin',
          role: 'super_admin',
          isSuperAdmin: true,
        }
      },
    }
    const apiKeyReader: DeveloperApiKeyReader = {
      verifyApiKeyRaw() {
        return null
      },
    }
    const middleware = createExecutionAuthMiddleware({ accessTokenReader, apiKeyReader, projectLookup })
    let seenAuth = false
    let seenProject = false

    await middleware(
      createCtx('/run/flow-1', { authorization: 'Bearer good-token', 'x-project-id': 'project-a' }) as never,
      async () => {
        seenAuth = authenticatedUserAls.getStore()?.username === 'admin'
        seenProject = projectContextAls.getStore()?.projectId === 'project-a'
      },
    )

    expect(seenAuth).toBe(true)
    expect(seenProject).toBe(true)
  })

  test('keeps project context across async boundary in bearer flow', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: {
        verifyAccessToken(rawToken: string) {
          if (rawToken !== 'good-token') return null
          return {
            userId: 'u1',
            username: 'admin',
            role: 'super_admin',
            isSuperAdmin: true,
          }
        },
      },
      apiKeyReader: { verifyApiKeyRaw: () => null },
      projectLookup,
    })

    let seenProjectAfterAwait = false
    await middleware(
      createCtx('/documents/upload', {
        authorization: 'Bearer good-token',
        'x-project-id': 'project-a',
      }) as never,
      async () => {
        await Promise.resolve()
        seenProjectAfterAwait = projectContextAls.getStore()?.projectId === 'project-a'
      },
    )

    expect(seenProjectAfterAwait).toBe(true)
  })

  test('allows project-scoped api key when header project matches', async () => {
    const accessTokenReader: AccessTokenReader = {
      verifyAccessToken() {
        return null
      },
    }
    const apiKeyReader: DeveloperApiKeyReader = {
      verifyApiKeyRaw(rawSecret: string) {
        if (rawSecret !== 'key-1') return null
        return {
          id: 'key-id',
          flow_id: null,
          scopes_json: JSON.stringify(['run']),
          allowed_tools_json: null,
          project_id: 'project-a',
          access_level: 'project',
        }
      },
    }
    const middleware = createExecutionAuthMiddleware({ accessTokenReader, apiKeyReader, projectLookup })
    let seenApiKey = false
    let seenProject = false

    await middleware(
      createCtx('/run/flow-1', { 'x-api-key': 'key-1', 'x-project-id': 'project-a' }) as never,
      async () => {
        seenApiKey = developerApiAls.getStore()?.apiKeyId === 'key-id'
        seenProject = projectContextAls.getStore()?.projectId === 'project-a'
      },
    )

    expect(seenApiKey).toBe(true)
    expect(seenProject).toBe(true)
  })

  test('rejects project-scoped api key when header project mismatches', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: { verifyAccessToken: () => null },
      apiKeyReader: {
        verifyApiKeyRaw() {
          return {
            id: 'key-id',
            flow_id: null,
            scopes_json: JSON.stringify(['run']),
            allowed_tools_json: null,
            project_id: 'project-a',
            access_level: 'project',
          }
        },
      },
      projectLookup,
    })

    await expect(
      middleware(
        createCtx('/run/flow-1', { 'x-api-key': 'key-1', 'x-project-id': 'project-b' }) as never,
        async () => {},
      ),
    ).rejects.toThrow('x-api-key does not belong to requested project')
  })

  test('allows system api key without project header', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: { verifyAccessToken: () => null },
      apiKeyReader: {
        verifyApiKeyRaw() {
          return {
            id: 'sys-key',
            flow_id: null,
            scopes_json: JSON.stringify(['run']),
            allowed_tools_json: null,
            project_id: '',
            access_level: 'system',
          }
        },
      },
      projectLookup,
    })
    let bypass = false
    let accessLevel: string | null = null

    await middleware(createCtx('/run/flow-1', { 'x-api-key': 'sys' }) as never, async () => {
      bypass = projectContextAls.getStore()?.bypassProjectIsolation === true
      accessLevel = developerApiAls.getStore()?.accessLevel ?? null
    })

    expect(bypass).toBe(true)
    expect(accessLevel).toBe('system')
  })

  test('allows kb search with project api key', async () => {
    const middleware = createExecutionAuthMiddleware({
      accessTokenReader: { verifyAccessToken: () => null },
      apiKeyReader: {
        verifyApiKeyRaw() {
          return {
            id: 'kb-key',
            flow_id: null,
            scopes_json: JSON.stringify(['kb']),
            allowed_tools_json: null,
            project_id: 'project-a',
            access_level: 'project',
          }
        },
      },
      projectLookup,
    })
    let seenProject = false

    await middleware(
      createCtx('/search', { 'x-api-key': 'kb', 'x-project-id': 'project-a' }) as never,
      async () => {
        seenProject = projectContextAls.getStore()?.projectId === 'project-a'
      },
    )

    expect(seenProject).toBe(true)
  })
})
