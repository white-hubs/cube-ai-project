import type { AccessTokenReader, DeveloperApiKeyReader, ProjectLookup } from '@cube-ai/server-base'
import { getSharedRepositories } from '../db/shared-repositories'
import { cachedProjectExists } from '../middleware/project-lookup-cache'

export function createFlowDeveloperApiKeyReader(): DeveloperApiKeyReader {
  return {
    async verifyApiKeyRaw(rawSecret: string) {
      const { flowRepo } = await getSharedRepositories()
      return flowRepo.verifyApiKeyRaw(rawSecret)
    },
  }
}

export function createFlowProjectLookup(): ProjectLookup {
  return {
    async listProjectIds() {
      const { projectRepo } = await getSharedRepositories()
      return (await projectRepo.listProjects()).map((project) => project.project_id)
    },
    async hasProject(projectId: string) {
      const { projectRepo } = await getSharedRepositories()
      return cachedProjectExists(projectId, async () => (await projectRepo.getProject(projectId)) != null)
    },
  }
}

export function createFlowAccessTokenReader(): AccessTokenReader {
  return {
    async verifyAccessToken(rawToken: string) {
      const { flowRepo } = await getSharedRepositories()
      const user = await flowRepo.verifyAccessToken(rawToken)
      if (!user) return null
      return {
        userId: user.id,
        username: user.username,
        role: user.role,
        isSuperAdmin: user.role === 'super_admin',
      }
    },
  }
}
