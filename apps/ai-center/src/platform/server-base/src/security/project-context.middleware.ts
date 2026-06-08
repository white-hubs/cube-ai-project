import {
  BadRequestException,
  NotFoundException,
  type Context,
  type Middleware,
  type NextFunction,
} from '@dangao/bun-server'
import {
  authenticatedUserAls,
  projectContextAls,
} from '@cube-ai/server-shared'
import type { ProjectLookup } from './middleware-types'

function matchesAnyPrefix(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path.startsWith(prefix))
}

function isReadonlyMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD'
}

/**
 * 从 `X-Project-Id` 注入 projectContextAls。
 * 超管可在管理面缺省 project 时启用全局可见模式。
 */
export function createProjectContextMiddleware(deps: {
  projectLookup: ProjectLookup
  skipPrefixes?: string[]
}): Middleware {
  const skipPrefixes = deps.skipPrefixes ?? [
    '/health',
    '/run/',
    '/webhook/',
    '/search',
    '/documents',
    '/projects',
    '/components',
    '/swagger',
    '/oauth2/',
    '/auth/',
  ]
  return async (ctx: Context, next: NextFunction) => {
    const path = ctx.path
    if (path === '/health' || matchesAnyPrefix(path, skipPrefixes.filter((p) => p !== '/health'))) {
      return next()
    }

    const raw = ctx.request.headers.get('x-project-id')?.trim()
    if (raw) {
      if (!(await deps.projectLookup.hasProject(raw))) {
        throw new NotFoundException(`project not found: ${raw}`)
      }
      return projectContextAls.run({ projectId: raw, bypassProjectIsolation: false }, () => next())
    }

    const auth = authenticatedUserAls.getStore()
    if (auth?.isSuperAdmin && isReadonlyMethod(ctx.request.method.toUpperCase())) {
      return projectContextAls.run({ projectId: '', bypassProjectIsolation: true }, () => next())
    }

    const allProjectIds = await deps.projectLookup.listProjectIds()
    if (allProjectIds.length === 1) {
      const only = allProjectIds[0]
      if (!only) throw new BadRequestException('invalid projects state')
      return projectContextAls.run({ projectId: only, bypassProjectIsolation: false }, () => next())
    }
    if (allProjectIds.length === 0) {
      throw new BadRequestException('no projects exist; create one via POST /projects')
    }
    throw new BadRequestException('X-Project-Id header is required when multiple projects exist')
  }
}
