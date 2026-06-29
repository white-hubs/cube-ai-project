import { type AppConfig } from "@cube-ai/ai-center/platform/server-base";

import { FlowStudioComponentRepository } from "./component.repository";
import { FlowStudioFlowRepository } from "./flow.repository";
import { getStudioQueryService } from "./mysql-query.service";
import { FlowStudioReleaseRepository } from "./release.repository";
import { FlowStudioResourceRefRepository } from "./resource-ref.repository";

export interface StudioRepositories {
  flowRepo: FlowStudioFlowRepository;
  resourceRefRepo: FlowStudioResourceRefRepository;
  componentRepo: FlowStudioComponentRepository;
  releaseRepo: FlowStudioReleaseRepository;
}

let repos: StudioRepositories | null = null;

export async function initStudioRepositories(config?: AppConfig): Promise<StudioRepositories> {
  if (repos) {
    return repos;
  }
  const db = await getStudioQueryService(config);
  repos = {
    componentRepo: new FlowStudioComponentRepository(db),
    flowRepo: new FlowStudioFlowRepository(db),
    releaseRepo: new FlowStudioReleaseRepository(db),
    resourceRefRepo: new FlowStudioResourceRefRepository(db),
  };
  return repos;
}

export function peekStudioRepositories(): StudioRepositories | null {
  return repos;
}
