import { ApiBody, ApiOperation, ApiParam, ApiResponse, Body, Controller, DELETE, GET, Injectable, Param, POST } from '@dangao/bun-server'
import { MockableEndpoint } from '@cube-ai/server-mock'
import { ApiKeysService } from './api-keys.service'

@Injectable()
@Controller('/api-keys')
export class ApiKeysController {
  constructor(private readonly keys: ApiKeysService) {}

  /**
   * 查询当前项目的 API Key 列表。
   *
   * @returns items API Key 数组（由服务层返回）；每项含 key 元信息与权限配置
   */
  @GET('/')
  @ApiOperation({
    summary: 'API Key 列表',
    description:
      '返回当前项目下项目级 API Key 列表（含作用域、过期时间与可用工具配置）；不包含系统级密钥，也不包含已撤销（删除）的密钥。',
    operationId: 'listApiKeys',
  })
  @ApiResponse({
    status: 200,
    description: 'API Key 列表',
    schema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            description: 'API Key 详情（字段由服务层定义）',
          },
        },
      },
      additionalProperties: true,
    } as Record<string, unknown>,
  })
  @MockableEndpoint('api-keys.list')
  list() {
    return this.keys.list()
  }

  /**
   * 创建 API Key。
   *
   * @param body.name Key 名称
   * @param body.flow_id 可选，绑定流程 id
   * @param body.scopes 可选，权限范围列表
   * @param body.project_id 可选，项目 id
   * @param body.expires_at 可选，过期时间（ISO）
   * @param body.allowed_tools 可选，允许调用的工具列表
   * @returns 新建后的 API Key 信息
   */
  @POST('/')
  @ApiOperation({
    summary: '创建 API Key',
    description: '创建新的 API Key，可选配置流程绑定、权限范围、到期时间与工具白名单。',
    operationId: 'createApiKey',
  })
  @ApiBody({
    description: '创建参数',
    required: true,
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Key 名称' },
        flow_id: { type: 'string', nullable: true, description: '可选，绑定流程 id' },
        scopes: { type: 'array', items: { type: 'string' }, description: '可选，权限范围列表' },
        project_id: { type: 'string', nullable: true, description: '可选，项目 id' },
        expires_at: { type: 'string', nullable: true, description: '可选，过期时间（ISO 8601）' },
        allowed_tools: { type: 'array', nullable: true, items: { type: 'string' }, description: '可选，允许工具列表' },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: '创建结果',
    schema: {
      type: 'object',
      additionalProperties: true,
      description: '新建 API Key 信息（具体字段由服务层定义）',
    } as Record<string, unknown>,
  })
  @MockableEndpoint('api-keys.create')
  create(
    @Body()
    body: {
      name?: string
      flow_id?: string | null
      scopes?: string[]
      project_id?: string | null
      expires_at?: string | null
      allowed_tools?: string[] | null
    },
  ) {
    return this.keys.create(body ?? {})
  }

  /**
   * 撤销 API Key。
   *
   * @param id API Key 主键
   * @returns 撤销结果
   */
  @DELETE('/:id')
  @ApiOperation({
    summary: '撤销 API Key',
    description: '按 id 撤销指定 API Key，使其立即失效。',
    operationId: 'revokeApiKey',
  })
  @ApiResponse({
    status: 200,
    description: '撤销结果',
    schema: {
      type: 'object',
      additionalProperties: true,
      description: '撤销后状态（字段由服务层定义）',
    } as Record<string, unknown>,
  })
  @MockableEndpoint('api-keys.revoke')
  revoke(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: 'API Key 主键',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    return this.keys.revoke(id)
  }
}
