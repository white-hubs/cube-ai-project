import { BadRequestException, Inject, Injectable, NotFoundException } from '@dangao/bun-server'
import { SnowflakeUtil } from '@cube-ai/server-base'
import { clearProjectLookupCache } from '../middleware/project-lookup-cache'
import {
  FLOW_REPOSITORY_TOKEN,
  PROJECT_REPOSITORY_TOKEN,
  type FlowRepository,
  type ProjectRepository,
} from '../db/repository-contracts'

@Injectable()
export class ProjectsService {
  private readonly flowRepo: FlowRepository
  private readonly projectsRepo: ProjectRepository

  constructor(
    @Inject(FLOW_REPOSITORY_TOKEN) flowRepo: FlowRepository,
    @Inject(PROJECT_REPOSITORY_TOKEN) projectsRepo: ProjectRepository,
  ) {
    this.flowRepo = flowRepo
    this.projectsRepo = projectsRepo
  }

  async list() {
    return (await this.projectsRepo.listProjects()).map((p) => ({
      id: p.id,
      project_id: p.project_id,
      name: p.name,
      description: p.description,
      create_time: p.create_time,
      update_time: p.update_time,
    }))
  }

  async get(id: string) {
    const row = await this.projectsRepo.getProject(id)
    if (!row) throw new NotFoundException(`project ${id} not found`)
    return {
      id: row.id,
      project_id: row.project_id,
      name: row.name,
      description: row.description,
      create_time: row.create_time,
      update_time: row.update_time,
    }
  }

  async create(body: { name: string; description?: string }) {
    const name = body.name?.trim()
    if (!name) throw new BadRequestException('name is required')
    const project_id = await this.projectsRepo.allocateUniqueTenantProjectId(name)
    const id = SnowflakeUtil.nextId()
    await this.projectsRepo.insertProject({
      id,
      project_id,
      name,
      description: body.description?.trim() ?? '',
    })
    return this.get(project_id)
  }

  async update(id: string, body: { name?: string; description?: string }) {
    const row = await this.projectsRepo.getProject(id)
    if (!row) throw new NotFoundException(`project ${id} not found`)
    await this.projectsRepo.updateProject(row.id, {
      name: body.name?.trim(),
      description: body.description !== undefined ? body.description.trim() : undefined,
    })
    clearProjectLookupCache()
    return this.get(row.project_id)
  }

  async delete(id: string) {
    const row = await this.projectsRepo.getProject(id)
    if (!row) throw new NotFoundException(`project ${id} not found`)
    if ((await this.projectsRepo.countProjects()) <= 1) {
      throw new BadRequestException('cannot delete the last project')
    }
    if ((await this.flowRepo.countFlowsInProject(row.project_id)) > 0) {
      throw new BadRequestException('project has flows; delete or move flows first')
    }
    if ((await this.flowRepo.countApiKeysInProject(row.project_id)) > 0) {
      throw new BadRequestException('project has API keys; revoke them first')
    }
    if ((await this.flowRepo.countCustomTemplatesInProject(row.project_id)) > 0) {
      throw new BadRequestException('project has custom component templates; delete them first')
    }
    await this.projectsRepo.deleteProject(row.id)
    clearProjectLookupCache()
    return { deleted: true as const }
  }
}
