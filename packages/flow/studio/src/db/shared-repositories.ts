import { type AppConfig } from '@cube-ai/server-base'
import { getStudioQueryService } from './mysql-query.service'
import { FlowStudioFlowRepository } from './flow.repository'
import { FlowStudioResourceRefRepository } from './resource-ref.repository'
import { FlowStudioComponentRepository } from './component.repository'
import { FlowStudioReleaseRepository } from './release.repository'

export interface StudioRepositories {
  flowRepo: FlowStudioFlowRepository
  resourceRefRepo: FlowStudioResourceRefRepository
  componentRepo: FlowStudioComponentRepository
  releaseRepo: FlowStudioReleaseRepository
}

let _repos: StudioRepositories | null = null

export async function initStudioRepositories(config?: AppConfig): Promise<StudioRepositories> {
  if (_repos) return _repos
  const db = await getStudioQueryService(config)
  _repos = {
    flowRepo: new FlowStudioFlowRepository(db),
    resourceRefRepo: new FlowStudioResourceRefRepository(db),
    componentRepo: new FlowStudioComponentRepository(db),
    releaseRepo: new FlowStudioReleaseRepository(db),
  }
  return _repos
}

export function peekStudioRepositories(): StudioRepositories | null {
  return _repos
}
