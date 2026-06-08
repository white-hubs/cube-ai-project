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
import { CustomComponentTemplatesService } from './custom-component-templates.service'

@Injectable()
@Controller('/custom-component-templates')
export class CustomComponentTemplatesController {
  constructor(private readonly templates: CustomComponentTemplatesService) {}

  /**
   * 查询自定义组件模板列表。
   *
   * @returns templates 模板数组
   */
  @GET('/')
  @ApiOperation({
    summary: '模板列表',
    description: '返回当前项目下已保存的自定义组件模板。',
    operationId: 'listCustomComponentTemplates',
  })
  @ApiResponse({
    status: 200,
    description: '模板列表',
    schema: {
      type: 'object',
      properties: {
        templates: {
          type: 'array',
          items: { type: 'object', additionalProperties: true },
          description: '模板数据列表',
        },
      },
    } as Record<string, unknown>,
  })
  @MockableEndpoint('custom-component-templates.list')
  list() {
    return { templates: this.templates.list() }
  }

  /**
   * 校验模板 DSL 合法性。
   *
   * @param body.dsl 自定义组件 DSL（必填）
   * @returns 校验结果（是否通过与错误信息）
   */
  @POST('/validate')
  @ApiOperation({
    summary: '校验模板 DSL',
    description: '对自定义组件 DSL 做语法与结构校验，不落库。',
    operationId: 'validateCustomComponentTemplateDsl',
  })
  @ApiBody({
    description: '校验参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        dsl: { description: '自定义组件 DSL（任意 JSON）' },
      },
      required: ['dsl'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '校验结果',
    schema: {
      type: 'object',
    } as Record<string, unknown>,
  })
  @MockableEndpoint('custom-component-templates.validate')
  validate(@Body() body: { dsl?: unknown }) {
    if (body.dsl === undefined) throw new BadRequestException('dsl is required')
    return this.templates.validateDsl(body.dsl)
  }

  /**
   * 创建模板。
   *
   * @param body.dsl 自定义组件 DSL（必填）
   * @param body.displayName 模板展示名（可选）
   * @returns 新建模板详情
   */
  @POST('/')
  @ApiOperation({
    summary: '创建模板',
    description: '创建并保存自定义组件模板。',
    operationId: 'createCustomComponentTemplate',
  })
  @ApiBody({
    description: '创建参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        dsl: { description: '自定义组件 DSL（任意 JSON）' },
        displayName: { type: 'string', description: '模板展示名' },
      },
      required: ['dsl'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '创建结果',
    schema: { type: 'object' } as Record<string, unknown>,
  })
  @MockableEndpoint('custom-component-templates.create')
  create(@Body() body: { dsl?: unknown; displayName?: string }) {
    if (body.dsl === undefined) throw new BadRequestException('dsl is required')
    return this.templates.create({ dsl: body.dsl, displayName: body.displayName })
  }

  /**
   * 查询单个模板详情。
   *
   * @param id 模板主键
   * @returns 模板详情
   */
  @GET('/:id')
  @ApiOperation({
    summary: '模板详情',
    description: '按模板 id 查询模板详情。',
    operationId: 'getCustomComponentTemplate',
  })
  @ApiResponse({
    status: 200,
    description: '模板详情',
    schema: { type: 'object' } as Record<string, unknown>,
  })
  @MockableEndpoint('custom-component-templates.get')
  get(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '模板主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    return this.templates.get(id)
  }

  /**
   * 更新模板。
   *
   * @param id 模板主键
   * @param body.dsl 可选，更新后的 DSL
   * @param body.displayName 可选，更新后的展示名
   * @returns 更新后的模板详情
   */
  @PUT('/:id')
  @ApiOperation({
    summary: '更新模板',
    description: '按 id 更新模板 DSL 或展示名。',
    operationId: 'updateCustomComponentTemplate',
  })
  @ApiBody({
    description: '更新参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        dsl: { description: '可选，更新后的 DSL（任意 JSON）' },
        displayName: { type: 'string', description: '可选，更新后的展示名' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '更新结果',
    schema: { type: 'object' } as Record<string, unknown>,
  })
  @MockableEndpoint('custom-component-templates.update')
  update(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '模板主键',
      schema: { type: 'string' },
    })
    id: string,
    @Body() body: { dsl?: unknown; displayName?: string },
  ) {
    return this.templates.update(id, body)
  }

  /**
   * 删除模板。
   *
   * @param id 模板主键
   * @returns 删除结果
   */
  @DELETE('/:id')
  @ApiOperation({
    summary: '删除模板',
    description: '按 id 删除指定模板。',
    operationId: 'removeCustomComponentTemplate',
  })
  @ApiResponse({
    status: 200,
    description: '删除结果',
    schema: { type: 'object' } as Record<string, unknown>,
  })
  @MockableEndpoint('custom-component-templates.remove')
  remove(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '模板主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    return this.templates.remove(id)
  }
}
