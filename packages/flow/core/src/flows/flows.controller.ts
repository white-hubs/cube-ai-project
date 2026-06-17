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
  Query,
  type ApiBodyMetadata,
  type ApiResponseMetadata,
} from '@dangao/bun-server'
import { CUBE_FLOW_SCHEMA_VERSION } from '../contracts/cube-flow'
import { MockableEndpoint } from '@cube-ai/ai-center/platform/server-mock'
import { FlowsService } from './flows.service'

/** @dangao/bun-server 的 ApiResponse.schema 类型较窄，按 OpenAPI JSON Schema 子集断言 */
function openapiRespSchema(s: Record<string, unknown>): NonNullable<ApiResponseMetadata['schema']> {
  return s as NonNullable<ApiResponseMetadata['schema']>
}

/** @dangao/bun-server 的 ApiBody.schema 类型较窄 */
function openapiBodySchema(s: Record<string, unknown>): NonNullable<ApiBodyMetadata['schema']> {
  return s as NonNullable<ApiBodyMetadata['schema']>
}

const openApiBindingStatus = {
  type: 'string',
  enum: ['pending', 'linked', 'broken'],
  description: '与 Langflow 的绑定状态：pending 未绑定或创建中；linked 已同步；broken 远端失败或配置异常',
} as const

const openApiFlowListItemProperties = {
  id: { type: 'string', description: '流程主键（UUID）' },
  name: { type: 'string', description: '流程名称' },
  description: { type: 'string', description: '说明' },
  create_time: { type: 'string', format: 'date-time', description: '创建时间（ISO 8601）' },
  update_time: { type: 'string', format: 'date-time', description: '最近更新时间（ISO 8601）' },
  nodeCount: { type: 'number', description: '画布节点数量（解析 graph 失败时为 0）' },
  bindingStatus: { ...openApiBindingStatus },
  langflowFlowId: { type: 'string', nullable: true, description: '绑定的 Langflow flow id，未绑定时为 null' },
} as const

const openApiCubeFlowViewport = {
  type: 'object',
  description: '画布视口',
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    zoom: { type: 'number' },
  },
} as const

const openApiCubeFlowNode = {
  type: 'object',
  description: 'Cube 画布节点（与 Langflow 通过 lfNodeId / cubeType 对应）',
  properties: {
    id: { type: 'string', description: 'Cube 节点 id' },
    lfNodeId: { type: 'string', description: '同步到 Langflow 的节点 id' },
    cubeType: { type: 'string', description: '组件类型，如 cube.lf.OpenAIModel' },
    x: { type: 'number', description: '画布 X' },
    y: { type: 'number', description: '画布 Y' },
    width: { type: 'number', description: '节点宽' },
    height: { type: 'number', description: '节点高' },
    config: {
      type: 'object',
      additionalProperties: true,
      description: '模板字段值（与组件 schema 的 inputs 对齐；不含敏感字段过滤由业务层处理）',
    },
    customFields: {
      type: 'object',
      additionalProperties: true,
      description: '可选，与 Langflow data.node.custom_fields 对齐',
    },
    fieldUi: {
      type: 'object',
      additionalProperties: true,
      description: '可选，侧栏字段启用/高级收合、节点级 Tool 模式等',
    },
    selectedOutputIdx: { type: 'number', description: '可选，多输出组件当前选中输出索引' },
    fieldOrder: { type: 'array', items: { type: 'string' }, description: '可选，输入字段展示顺序' },
  },
  required: ['id', 'lfNodeId', 'cubeType', 'x', 'y', 'width', 'height', 'config'],
} as const

const openApiCubeFlowEdge = {
  type: 'object',
  description: '有向边',
  properties: {
    id: { type: 'string', description: '边 id' },
    source: { type: 'string', description: '源节点 id' },
    target: { type: 'string', description: '目标节点 id' },
    sourcePort: { type: 'string', description: '源端口名（与组件 outputs 的 name 对应）' },
    targetPort: { type: 'string', description: '目标端口名（与组件 inputs 的 Handle 名对应）' },
  },
  required: ['id', 'source', 'target', 'sourcePort', 'targetPort'],
} as const

const openApiCubeFlowGraph = {
  type: 'object',
  description: `Cube 规范画布；schemaVersion 必须为 ${CUBE_FLOW_SCHEMA_VERSION}`,
  properties: {
    schemaVersion: { type: 'number', description: `固定为 ${CUBE_FLOW_SCHEMA_VERSION}` },
    nodes: { type: 'array', items: openApiCubeFlowNode },
    edges: { type: 'array', items: openApiCubeFlowEdge },
    viewport: { ...openApiCubeFlowViewport, nullable: true },
  },
  required: ['schemaVersion', 'nodes', 'edges'],
} as const

const openApiFlowDetailProperties = {
  ...openApiFlowListItemProperties,
  graph: openApiCubeFlowGraph,
} as const

const openApiTweaks = {
  type: 'object',
  description: 'Langflow tweaks：Langflow 节点 id → 字段名 → 运行时覆盖值',
  additionalProperties: { type: 'object', additionalProperties: true },
} as const

const openApiFlowExecutionBodyProperties = {
  input: {
    oneOf: [
      { type: 'string' },
      {
        type: 'object',
        properties: {
          query: { type: 'string', description: '用户输入文本；映射为 Langflow input_request.input_value' },
          files: {
            type: 'array',
            description: '已上传到流程文件接口的文件引用；运行时自动注入 ChatInput.files',
            items: {
              type: 'object',
              properties: {
                file_path: { type: 'string' },
                path: { type: 'string' },
                filePath: { type: 'string' },
                url: { type: 'string' },
                name: { type: 'string' },
                mime: { type: 'string' },
              },
            },
          },
        },
      },
    ],
    description: '用户输入；字符串为纯文本，结构化对象可携带 files 多模态附件引用。',
  },
  sessionId: {
    type: 'string',
    description:
      'Langflow 会话 id。Playground 接口必填且须为本 flow 下已存在会话；run 可选，用于延续上下文',
  },
  stream: {
    type: 'boolean',
    description: '是否流式：POST …/run 为 true 时返回 SSE；Playground 默认 true（仅当显式 false 时同步 JSON）',
  },
  inputType: { type: 'string', description: 'Langflow input_type，默认 chat' },
  outputType: { type: 'string', description: 'Langflow output_type，默认 chat' },
  tweaks: openApiTweaks,
} as const

const openApiPlaygroundMessageItem = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '消息主键' },
    role: { type: 'string', enum: ['user', 'bot'], description: '角色' },
    content: { type: 'string', description: '正文' },
    create_time: { type: 'string', format: 'date-time', description: '创建时间' },
  },
  required: ['id', 'role', 'content', 'create_time'],
} as const

const openApiPlaygroundSessionItem = {
  type: 'object',
  properties: {
    id: { type: 'string', description: '会话 id（与 Langflow session_id 一致；创建消息、执行时传入 sessionId）' },
    title: { type: 'string', nullable: true, description: '标题' },
    isDefault: { type: 'boolean', description: '是否为默认会话' },
    update_time: { type: 'string', format: 'date-time', description: '最近更新时间' },
  },
  required: ['id', 'title', 'isDefault', 'update_time'],
} as const

const openApiPlaygroundSessionPage = {
  type: 'object',
  properties: {
    items: { type: 'array', items: openApiPlaygroundSessionItem },
    total: { type: 'number' },
    pageNumber: { type: 'number' },
    pageSize: { type: 'number' },
    pages: { type: 'number' },
  },
  required: ['items', 'total', 'pageNumber', 'pageSize', 'pages'],
} as const

@Injectable()
@Controller('/flows')
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  @GET('/')
  @ApiOperation({
    summary: '流程列表',
    description: '返回全部 Cube 流程摘要（含节点数、Langflow 绑定状态），不含完整 graph。',
    operationId: 'listFlows',
  })
  @ApiResponse({
    status: 200,
    description: '流程摘要数组',
    schema: openapiRespSchema({
      type: 'array',
      items: { type: 'object', properties: openApiFlowListItemProperties as Record<string, unknown> },
    }),
  })
  @MockableEndpoint('flows.list')
  list() {
    return this.flows.list()
  }

  @POST('/')
  @ApiOperation({
    summary: '创建流程',
    description: '新建空画布并落库；若配置了 LANGFLOW_BASE_URL，会尝试在 Langflow 侧创建 flow 并写入绑定。',
    operationId: 'createFlow',
  })
  @ApiBody({
    description: '名称必填；可选说明',
    required: true,
    schema: openapiBodySchema({
      type: 'object',
      properties: {
        name: { type: 'string', description: '流程名称（trim 后非空）' },
        description: { type: 'string', description: '可选说明' },
      },
      required: ['name'],
    }),
  })
  @ApiResponse({
    status: 200,
    description: '创建后的流程详情（含 graph）',
    schema: openapiRespSchema({
      type: 'object',
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
  })
  @ApiResponse({ status: 400, description: 'name 缺失或为空' })
  @MockableEndpoint('flows.create')
  create(@Body() body: { name?: string; description?: string }) {
    const name = body?.name?.trim()
    if (!name) throw new BadRequestException('name is required')
    return this.flows.create({ name, description: body?.description })
  }

  @POST('/import')
  @ApiOperation({
    summary: '导入流程（新建）',
    description:
      '从 export 接口生成的 JSON（cubeFlowExport）或等价的 name、description、graph **新建一条流程**（新 id）；名称与说明来自导出（可被顶层 name/description 覆盖）。若要把画布导入到**已有**流程且保留该流程的名称等元数据，请使用「POST …/:id/import」。',
    operationId: 'importFlow',
  })
  @ApiBody({
    description:
      '支持 `cubeFlowExport` 包装对象，或与导出结构等价的扁平字段；可额外传顶层 `name` 覆盖导出中的名称。',
    required: true,
    schema: openapiBodySchema({
      type: 'object',
      properties: {
        cubeFlowExport: {
          type: 'object',
          description: '与 GET …/export 响应中的 cubeFlowExport 同形（import 时可省略 exportedAt）',
          properties: {
            version: { type: 'number', description: '当前为 1' },
            exportedAt: { type: 'string', format: 'date-time' },
            name: { type: 'string' },
            description: { type: 'string' },
            graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
          },
          required: ['version', 'graph'],
        },
        name: { type: 'string', description: '可选；非空时覆盖导出中的流程名称' },
        description: { type: 'string', description: '可选；覆盖说明' },
      },
    }),
  })
  @ApiResponse({
    status: 200,
    description: '新建流程详情',
    schema: openapiRespSchema({
      type: 'object',
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
  })
  @ApiResponse({ status: 400, description: 'body 非法、缺少 name 或 graph' })
  @ApiResponse({ status: 422, description: 'graph schemaVersion 非 1 或自定义组件校验失败' })
  @ApiResponse({ status: 502, description: 'Langflow 同步失败' })
  @MockableEndpoint('flows.import')
  importFlow(@Body() body: unknown) {
    return this.flows.importFlow(body)
  }

  @POST('/:id/import')
  @ApiOperation({
    summary: '导入画布到已有流程',
    description:
      '将导出 JSON 中的 **graph**（节点、边、视口）写入路径中的流程；**不修改**该流程的名称、说明及 Langflow 绑定等元数据。适用于先新建空流程再仅导入画布。',
    operationId: 'importFlowGraphIntoExisting',
  })
  @ApiBody({
    description:
      '与 POST /flows/import 相同：可为完整 `cubeFlowExport` 或仅含 `graph`；其中的 name/description 会被忽略。',
    required: true,
    schema: openapiBodySchema({
      type: 'object',
      properties: {
        cubeFlowExport: {
          type: 'object',
          description: '与 GET …/export 响应中的 cubeFlowExport 同形（name/description 仅作携带，不会写入）',
          properties: {
            version: { type: 'number', description: '当前为 1' },
            exportedAt: { type: 'string', format: 'date-time' },
            name: { type: 'string' },
            description: { type: 'string' },
            graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
          },
          required: ['version', 'graph'],
        },
        graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
      },
    }),
  })
  @ApiResponse({
    status: 200,
    description: '更新后的流程详情',
    schema: openapiRespSchema({
      type: 'object',
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
  })
  @ApiResponse({ status: 400, description: 'body 非法或缺少 graph' })
  @ApiResponse({ status: 404, description: '流程不存在' })
  @ApiResponse({ status: 422, description: 'graph schemaVersion 非 1 或自定义组件校验失败' })
  @ApiResponse({ status: 502, description: 'Langflow 同步失败' })
  @MockableEndpoint('flows.importGraph')
  importFlowGraphIntoExisting(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '目标流程 UUID 或可唯一解析的名称',
      schema: { type: 'string' },
    })
    id: string,
    @Body() body: unknown,
  ) {
    return this.flows.importGraphIntoExistingFlow(id, body)
  }

  @GET('/:id/export')
  @ApiOperation({
    summary: '导出流程',
    description: '返回可移植 JSON 快照（不含流程主键与 Langflow 绑定），用于备份或 POST /flows/import 导入。',
    operationId: 'exportFlow',
  })
  @ApiResponse({
    status: 200,
    description: '导出包',
    schema: openapiRespSchema({
      type: 'object',
      properties: {
        cubeFlowExport: {
          type: 'object',
          properties: {
            version: { type: 'number', const: 1 },
            exportedAt: { type: 'string', format: 'date-time' },
            name: { type: 'string' },
            description: { type: 'string' },
            graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
          },
          required: ['version', 'exportedAt', 'name', 'description', 'graph'],
        },
      },
      required: ['cubeFlowExport'],
    }),
  })
  @ApiResponse({ status: 404, description: '流程不存在' })
  @MockableEndpoint('flows.export')
  exportFlow(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '流程 UUID 或可唯一解析的名称',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    return this.flows.exportSnapshot(id)
  }

  @GET('/:id')
  @ApiOperation({
    summary: '流程详情',
    description: '按 UUID 或唯一名称（不区分大小写）解析流程，返回元数据与完整 graph。',
    operationId: 'getFlow',
  })
  @ApiResponse({
    status: 200,
    description: '流程详情',
    schema: openapiRespSchema({
      type: 'object',
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
  })
  @ApiResponse({ status: 400, description: 'id 为空或名称歧义（多条同名）' })
  @ApiResponse({ status: 404, description: '流程不存在' })
  @MockableEndpoint('flows.get')
  get(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '流程 UUID，或与列表中唯一 name 匹配（大小写不敏感）',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    return this.flows.get(id)
  }

  @PUT('/:id')
  @ApiOperation({
    summary: '更新流程',
    description: '可更新名称、说明或整体 graph。传入 graph 时会推送到 Langflow 并可能归档默认 Playground 会话。',
    operationId: 'updateFlow',
  })
  @ApiBody({
    description: '至少提供一项；graph 须满足 CubeFlowGraph 约定（schemaVersion=1）',
    required: true,
    schema: openapiBodySchema({
      type: 'object',
      properties: {
        name: { type: 'string', description: '新名称' },
        description: { type: 'string', description: '新说明' },
        graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
      },
    }),
  })
  @ApiResponse({
    status: 200,
    description: '更新后的流程详情',
    schema: openapiRespSchema({
      type: 'object',
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
  })
  @ApiResponse({ status: 400, description: 'id 解析失败或名称歧义' })
  @ApiResponse({ status: 404, description: '流程不存在' })
  @ApiResponse({ status: 422, description: 'graph schemaVersion 非 1 或结构非法' })
  @ApiResponse({ status: 502, description: 'Langflow 同步失败' })
  @MockableEndpoint('flows.update')
  update(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '流程 UUID 或可唯一解析的名称',
      schema: { type: 'string' },
    })
    id: string,
    @Body() body: { name?: string; description?: string; graph?: unknown },
  ) {
    return this.flows.update(id, {
      name: body.name,
      description: body.description,
      graph: body.graph as import('../contracts/cube-flow').CubeFlowGraph | undefined,
    })
  }

  @DELETE('/:id')
  @ApiOperation({
    summary: '删除流程',
    description: '从本地库删除流程及其 Playground 数据（不保证删除远端 Langflow flow）。',
    operationId: 'deleteFlow',
  })
  @ApiResponse({
    status: 200,
    description: '删除成功',
    schema: openapiRespSchema({
      type: 'object',
      properties: { deleted: { type: 'boolean', description: '恒为 true' } },
      required: ['deleted'],
    }),
  })
  @ApiResponse({ status: 404, description: '流程不存在' })
  @MockableEndpoint('flows.remove')
  remove(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '流程 UUID 或可唯一解析的名称',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    return this.flows.delete(id)
  }

  @POST('/:id/import-from-langflow')
  @ApiOperation({
    summary: '从 Langflow 导入画布',
    description: '用指定 Langflow flow id 拉取定义，转换为 Cube graph 并写回本地、更新绑定。',
    operationId: 'importFlowFromLangflow',
  })
  @ApiBody({
    description: '远端 Langflow flow 标识',
    required: true,
    schema: openapiBodySchema({
      type: 'object',
      properties: {
        langflowFlowId: { type: 'string', description: 'Langflow 侧 flow 的 id（UUID）' },
      },
      required: ['langflowFlowId'],
    }),
  })
  @ApiResponse({
    status: 200,
    description: '导入后的流程详情',
    schema: openapiRespSchema({
      type: 'object',
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
  })
  @ApiResponse({ status: 400, description: 'langflowFlowId 缺失' })
  @ApiResponse({ status: 404, description: 'Cube 流程不存在' })
  @ApiResponse({ status: 503, description: '未配置 Langflow（LANGFLOW_BASE_URL 等）' })
  @ApiResponse({ status: 502, description: '拉取 Langflow flow 失败' })
  @MockableEndpoint('flows.importLf')
  importLf(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '目标 Cube 流程 UUID 或名称',
      schema: { type: 'string' },
    })
    id: string,
    @Body() body: { langflowFlowId?: string },
  ) {
    const lf = body?.langflowFlowId?.trim()
    if (!lf) throw new BadRequestException('langflowFlowId is required')
    return this.flows.importFromLangflow(id, lf)
  }

  @GET('/:id/playground/sessions')
  @ApiOperation({
    summary: 'Playground 会话列表',
    description: '列出某 flow 下全部会话；会确保存在默认会话。',
    operationId: 'listFlowPlaygroundSessions',
  })
  @ApiResponse({
    status: 200,
    description: '会话列表',
    schema: openapiRespSchema({ type: 'array', items: openApiPlaygroundSessionItem as Record<string, unknown> }),
  })
  @ApiResponse({ status: 404, description: '流程不存在' })
  @MockableEndpoint('flows.listPlaygroundSessions')
  listPlaygroundSessions(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '流程 UUID 或名称',
      schema: { type: 'string' },
    })
    id: string,
  ) {
    return this.flows.listPlaygroundSessions(id)
  }

  @GET('/:id/playground/sessions/paged')
  @ApiOperation({
    summary: 'Playground 会话分页列表',
    description: '分页列出某 flow 下全部会话；会确保存在默认会话。',
    operationId: 'listFlowPlaygroundSessionsPaged',
  })
  @ApiResponse({
    status: 200,
    description: '分页会话列表',
    schema: openapiRespSchema(openApiPlaygroundSessionPage as Record<string, unknown>),
  })
  @MockableEndpoint('flows.listPlaygroundSessionsPaged')
  listPlaygroundSessionsPaged(
    @Param('id') id: string,
    @Query('pageNumber') pageNumber?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.flows.listPlaygroundSessionsPaged(
      id,
      pageNumber ? Number(pageNumber) : undefined,
      pageSize ? Number(pageSize) : undefined,
    )
  }

  @POST('/:id/playground/sessions')
  @ApiOperation({
    summary: '创建 Playground 会话',
    description: '新建会话；asDefault 为 true 时将切换默认会话并归档旧默认标题。',
    operationId: 'createFlowPlaygroundSession',
  })
  @ApiBody({
    description: '可选标题与是否设为默认',
    required: true,
    schema: openapiBodySchema({
      type: 'object',
      properties: {
        title: { type: 'string', nullable: true, description: '会话标题' },
        asDefault: { type: 'boolean', description: '为 true 时设为默认会话' },
      },
    }),
  })
  @ApiResponse({
    status: 200,
    description: '新会话 id',
    schema: openapiRespSchema({
      type: 'object',
      properties: { id: { type: 'string', description: '新建会话主键，供后续 sessionId 使用' } },
      required: ['id'],
    }),
  })
  @ApiResponse({ status: 404, description: '流程不存在' })
  @MockableEndpoint('flows.createPlaygroundSession')
  createPlaygroundSession(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '流程 UUID 或名称',
      schema: { type: 'string' },
    })
    id: string,
    @Body() body: { title?: string | null; asDefault?: boolean },
  ) {
    return this.flows.createPlaygroundSessionRow(id, body ?? {})
  }

  @DELETE('/:id/playground/sessions/:sessionId')
  @ApiOperation({
    summary: '删除 Playground 会话',
    description: '删除指定会话；若远端存在 Langflow chat/session，则先同步删除远端。',
    operationId: 'deleteFlowPlaygroundSession',
  })
  @ApiResponse({
    status: 200,
    description: '删除结果',
    schema: openapiRespSchema({
      type: 'object',
      properties: { deleted: { type: 'boolean' } },
      required: ['deleted'],
    }),
  })
  @MockableEndpoint('flows.deletePlaygroundSession')
  deletePlaygroundSession(
    @Param('id') id: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.flows.deletePlaygroundSession(id, sessionId)
  }

  @GET('/:id/playground/sessions/:sessionId/messages')
  @ApiOperation({
    summary: 'Playground 会话消息历史',
    description: '按会话拉取已持久化的 user/bot 消息（时间正序）。',
    operationId: 'getFlowPlaygroundSessionMessages',
  })
  @ApiResponse({
    status: 200,
    description: '消息数组',
    schema: openapiRespSchema({ type: 'array', items: openApiPlaygroundMessageItem as Record<string, unknown> }),
  })
  @ApiResponse({ status: 404, description: '流程或会话不存在' })
  @MockableEndpoint('flows.getPlaygroundSessionMessages')
  getPlaygroundSessionMessages(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '流程 UUID 或名称',
      schema: { type: 'string' },
    })
    id: string,
    @Param('sessionId')
    @ApiParam({
      name: 'sessionId',
      in: 'path',
      required: true,
      description: '会话 id（来自创建会话或列表接口）',
      schema: { type: 'string' },
    })
    sessionId: string,
  ) {
    return this.flows.getPlaygroundSessionMessages(id, sessionId)
  }

  @POST('/:id/playground/messages')
  @ApiOperation({
    summary: 'Playground 发送消息',
    description:
      'sessionId 必填。默认流式返回 text/event-stream（Cube SSE）；stream=false 时同步返回 Langflow JSON 并写入 bot 消息。',
    operationId: 'postFlowPlaygroundMessages',
  })
  @ApiBody({
    description: 'sessionId 必填；其余字段透传执行后端（Langflow）',
    required: true,
    schema: openapiBodySchema({
      type: 'object',
      properties: {
        ...openApiFlowExecutionBodyProperties,
        sessionId: {
          ...openApiFlowExecutionBodyProperties.sessionId,
          description: '必填。须为本 flow 下已通过 POST …/playground/sessions 创建的会话 id',
        },
      },
      required: ['sessionId'],
    }),
  })
  @ApiResponse({
    status: 200,
    description:
      'stream 非 false：200，Content-Type: text/event-stream，正文为 SSE 事件流。stream 为 false：200，application/json，结构同 Langflow /api/v1/run 同步结果（随 Langflow 版本变化）。',
    schema: openapiRespSchema({
      type: 'object',
      description: '仅非流式时有稳定 JSON；流式时请忽略本 schema，按 SSE 解析',
      additionalProperties: true,
    }),
  })
  @ApiResponse({ status: 400, description: 'sessionId 缺失' })
  @ApiResponse({ status: 404, description: '流程或会话不存在' })
  @ApiResponse({ status: 503, description: '执行后端不可用（未绑定 Langflow 等）' })
  @ApiResponse({ status: 502, description: 'Langflow 执行或流打开失败' })
  @MockableEndpoint('flows.playgroundMessages')
  playgroundMessages(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '流程 UUID 或名称',
      schema: { type: 'string' },
    })
    id: string,
    @Body()
    body: {
      input?: string | Record<string, unknown>
      sessionId?: string
      stream?: boolean
      inputType?: string
      outputType?: string
      tweaks?: Record<string, Record<string, unknown>>
    },
  ) {
    return this.flows.playgroundMessages(id, {
      input: body.input,
      sessionId: body.sessionId,
      stream: body.stream,
      inputType: body.inputType,
      outputType: body.outputType,
      tweaks: body.tweaks,
    })
  }

  @POST('/:id/run')
  @ApiOperation({
    summary: '执行流程（Run）',
    description:
      '先同步当前 graph 到 Langflow 再执行。stream=true 时返回 SSE；否则返回 Langflow 同步 JSON。',
    operationId: 'runFlow',
  })
  @ApiBody({
    description: '执行参数；sessionId / tweaks 等与 Langflow input_request 一致',
    required: true,
    schema: openapiBodySchema({
      type: 'object',
      properties: openApiFlowExecutionBodyProperties as Record<string, unknown>,
    }),
  })
  @ApiResponse({
    status: 200,
    description:
      'stream 为 true：text/event-stream，Cube SSE。stream 为 false 或未传：application/json，Langflow run 同步响应（结构随版本变化）。',
    schema: openapiRespSchema({
      type: 'object',
      description: '非流式响应；流式时请按 SSE 处理',
      additionalProperties: true,
    }),
  })
  @ApiResponse({ status: 404, description: '流程不存在' })
  @ApiResponse({ status: 503, description: '执行后端不可用' })
  @ApiResponse({ status: 502, description: 'Langflow 执行失败' })
  @MockableEndpoint('flows.run')
  run(
    @Param('id')
    @ApiParam({
      name: 'id',
      in: 'path',
      required: true,
      description: '流程 UUID 或名称',
      schema: { type: 'string' },
    })
    id: string,
    @Body()
    body: {
      input?: string | Record<string, unknown>
      sessionId?: string
      stream?: boolean
      inputType?: string
      outputType?: string
      tweaks?: Record<string, Record<string, unknown>>
    },
  ) {
    const stream = body.stream === true
    if (stream) {
      return this.flows.runStream(id, body)
    }
    return this.flows.run(id, body)
  }
}
