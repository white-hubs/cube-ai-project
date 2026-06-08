import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  BadRequestException,
  Body,
  Controller,
  DELETE,
  GET,
  Injectable,
  Param,
  POST,
  PUT,
} from '@dangao/bun-server'
import { MockableEndpoint } from '@cube-ai/server-mock'
import { ProjectsService } from './projects.service'

@Injectable()
@Controller('/projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  /**
   * 查询项目列表。
   *
   * @returns 项目数组
   */
  @GET('/')
  @ApiOperation({
    summary: '项目列表',
    description: '返回当前可访问的项目列表。',
    operationId: 'listProjects',
  })
  @ApiResponse({
    status: 200,
    description: '项目列表',
    schema: { type: 'array', items: { type: 'object', additionalProperties: true } } as Record<string, unknown>,
  })
  @MockableEndpoint('projects.list')
  list() {
    return this.projects.list()
  }

  /**
   * 创建项目。
   *
   * @param body.name 项目名称
   * @param body.description 项目描述（可选）
   * @returns 创建后的项目
   */
  @POST('/')
  @ApiOperation({
    summary: '创建项目',
    description: '创建项目，名称由服务层做合法性校验。',
    operationId: 'createProject',
  })
  @ApiBody({
    description: '创建参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '项目名称' },
        description: { type: 'string', description: '项目描述（可选）' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '创建结果',
    schema: { type: 'object', additionalProperties: true } as Record<string, unknown>,
  })
  @MockableEndpoint('projects.create')
  create(@Body() body: { name?: string; description?: string }) {
    return this.projects.create({ name: body?.name ?? '', description: body?.description })
  }

  /**
   * 获取项目详情。
   *
   * @param id 项目主键
   * @returns 项目详情
   */
  @GET('/:id')
  @ApiOperation({
    summary: '项目详情',
    description: '按项目 id 查询项目详情。',
    operationId: 'getProject',
  })
  @ApiResponse({
    status: 200,
    description: '项目详情',
    schema: { type: 'object', additionalProperties: true } as Record<string, unknown>,
  })
  @ApiResponse({ status: 400, description: 'id 不能为空' })
  @MockableEndpoint('projects.get')
  get(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '项目主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    const sid = id?.trim()
    if (!sid) throw new BadRequestException('id is required')
    return this.projects.get(sid)
  }

  /**
   * 更新项目信息。
   *
   * @param id 项目主键
   * @param body.name 新项目名称（可选）
   * @param body.description 新项目描述（可选）
   * @returns 更新后的项目
   */
  @PUT('/:id')
  @ApiOperation({
    summary: '更新项目',
    description: '按项目 id 更新名称和描述。',
    operationId: 'updateProject',
  })
  @ApiBody({
    description: '更新参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '新项目名称（可选）' },
        description: { type: 'string', description: '新项目描述（可选）' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '更新结果',
    schema: { type: 'object', additionalProperties: true } as Record<string, unknown>,
  })
  @ApiResponse({ status: 400, description: 'id 不能为空' })
  @MockableEndpoint('projects.update')
  update(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '项目主键',
      schema: { type: 'string' },
    })
    id: string,
    @Body() body: { name?: string; description?: string },
  ) {
    const sid = id?.trim()
    if (!sid) throw new BadRequestException('id is required')
    return this.projects.update(sid, body)
  }

  /**
   * 删除项目。
   *
   * @param id 项目主键
   * @returns 删除结果
   */
  @DELETE('/:id')
  @ApiOperation({
    summary: '删除项目',
    description: '按项目 id 删除项目。',
    operationId: 'removeProject',
  })
  @ApiResponse({
    status: 200,
    description: '删除结果',
    schema: { type: 'object', additionalProperties: true } as Record<string, unknown>,
  })
  @ApiResponse({ status: 400, description: 'id 不能为空' })
  @MockableEndpoint('projects.remove')
  remove(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '项目主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    const sid = id?.trim()
    if (!sid) throw new BadRequestException('id is required')
    return this.projects.delete(sid)
  }
}
