import { type Middleware } from '@dangao/bun-server'
import { createProjectContextMiddleware as createBaseProjectContextMiddleware, type ProjectLookup } from '@cube-ai/server-base'
import { getSharedRepositories } from '../db/shared-repositories'
import { cachedProjectExists } from './project-lookup-cache'

export function createProjectContextMiddleware(): Middleware {
  const lookup: ProjectLookup = {
    async listProjectIds() {
      const { projectRepo } = await getSharedRepositories()
      return (await projectRepo.listProjects()).map((p) => p.project_id)
    },
    async hasProject(projectId: string) {
      const { projectRepo } = await getSharedRepositories()
      return cachedProjectExists(projectId, async () => (await projectRepo.getProject(projectId)) != null)
    },
  }
  return createBaseProjectContextMiddleware({ projectLookup: lookup })
}
