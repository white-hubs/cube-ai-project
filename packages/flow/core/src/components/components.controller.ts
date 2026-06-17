import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  BadRequestException,
  Body,
  Controller,
  GET,
  POST,
  Query,
} from '@dangao/bun-server'
import { buildCubeComponentSchemaFromDslPayload } from '../custom-component/dsl-to-cube-schema'
import { MockableEndpoint } from '@cube-ai/ai-center/platform/server-mock'
import { ComponentCatalogService } from './component-catalog.service'
import { ComponentSchemaService } from './component-schema.service'

const openApiCatalogEntry = {
  type: 'object',
  properties: {
    cubeType: { type: 'string', description: 'Cube 组件类型，如 cube.lf.OpenAIModel' },
    lfComponentKey: { type: 'string', description: 'Langflow 组件键（无 cube.lf. 前缀）' },
    category: { type: 'string', description: '分类（侧栏分组）' },
    displayName: { type: 'string', description: '展示名' },
    outputNames: { type: 'array', items: { type: 'string' }, description: '输出句柄名称列表' },
  },
  required: ['cubeType', 'lfComponentKey', 'category', 'displayName', 'outputNames'],
} as const

const openApiCubeSchemaOutputField = {
  type: 'object',
  properties: {
    name: { type: 'string', description: '输出端口名（连线用）' },
    displayName: { type: 'string', description: '展示名' },
    types: { type: 'array', items: { type: 'string' }, description: '可接受的数据类型标签' },
    toolMode: { type: 'boolean', description: '是否为 Tool 相关输出' },
    allowsLoop: { type: 'boolean', description: '是否允许环回连接' },
    method: { type: 'string', description: '可选，api-all outputs[].method' },
  },
  required: ['name', 'displayName', 'types', 'toolMode', 'allowsLoop'],
} as const

const openApiCubeSchemaInputField = {
  type: 'object',
  description: '输入槽位（由 Langflow template 推导，已剔除 code 字段）',
  properties: {
    name: { type: 'string', description: '字段名' },
    displayName: { type: 'string', description: '展示名' },
    inputTypes: { type: 'array', items: { type: 'string' }, description: '如 Message、Data、HandleInput 等' },
    advanced: { type: 'boolean', description: '是否高级字段' },
    show: { type: 'boolean', description: '是否在侧栏显示' },
    password: { type: 'boolean', description: '是否密码类输入' },
    inputType: { type: 'string', description: 'api-all _input_type；HandleInput 表示仅连线桩' },
    fieldType: { type: 'string', description: 'api-all type（控件类型）' },
    info: { type: 'string', description: '说明文案' },
    required: { type: 'boolean', description: '是否必填' },
    fieldToolMode: { type: 'boolean', description: '槽位级 tool_mode' },
    value: { description: '模板默认值，任意 JSON' },
    options: { description: '下拉等选项，结构随控件变化' },
    placeholder: { type: 'string', description: '占位符' },
    externalConnectAction: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        displayName: { type: 'string' },
      },
      description: '如「连接其他模型」等外链动作',
    },
    rangeSpec: { type: 'object', additionalProperties: true, description: '数值范围等' },
    list: { type: 'boolean', description: '是否为列表型输入' },
    tableSchema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          displayName: { type: 'string' },
          description: { type: 'string' },
          type: { type: 'string' },
          editMode: { type: 'string' },
          default: { description: '列默认值' },
        },
      },
      description: 'TableInput 列定义',
    },
    triggerText: { type: 'string', description: '表格编辑触发文案' },
  },
  required: [
    'name',
    'displayName',
    'inputTypes',
    'advanced',
    'show',
    'password',
    'inputType',
    'fieldType',
    'info',
    'required',
    'fieldToolMode',
  ],
} as const

const openApiCubeComponentSchemaV1 = {
  type: 'object',
  description: '单组件结构定义（供设计器端口、属性面板、校验使用；不含 template.code）',
  properties: {
    version: { type: 'number', description: 'schema 版本，当前为 1' },
    cubeType: { type: 'string', description: '与查询参数一致' },
    lfComponentKey: { type: 'string', description: 'Langflow 组件键' },
    displayName: { type: 'string', description: '组件展示名' },
    description: { type: 'string', description: '组件说明' },
    componentToolModeDefault: { type: 'boolean', description: '组件级默认 Tool 模式' },
    fieldOrder: { type: 'array', items: { type: 'string' }, description: '可选，输入字段展示顺序' },
    outputs: { type: 'array', items: openApiCubeSchemaOutputField },
    inputs: { type: 'array', items: openApiCubeSchemaInputField },
  },
  required: [
    'version',
    'cubeType',
    'lfComponentKey',
    'displayName',
    'description',
    'componentToolModeDefault',
    'outputs',
    'inputs',
  ],
} as const

@Controller('/components')
export class ComponentsController {
  constructor(
    private readonly catalog: ComponentCatalogService,
    private readonly schemaService: ComponentSchemaService,
  ) {}

  @GET('/catalog')
  @ApiOperation({
    summary: '组件目录',
    description: '返回同步生成的全量组件列表（含分类、展示名、输出名），用于侧栏与拖拽。不含各组件详细 template/schema。',
    operationId: 'listComponentCatalog',
  })
  @ApiResponse({
    status: 200,
    description: '目录 JSON（version + components）',
    schema: {
      type: 'object',
      properties: {
        version: { type: 'number', description: 'catalog 文件版本号' },
        components: { type: 'array', items: openApiCatalogEntry, description: '全部已注册组件' },
      },
      required: ['version', 'components'],
    } as Record<string, unknown>,
  })
  @ApiResponse({
    status: 503,
    description: '未生成 catalog（需执行 bun run sync-components）',
  })
  @ApiResponse({ status: 500, description: 'catalog 文件损坏或无法解析' })
  @MockableEndpoint('components.catalog')
  list() {
    return this.catalog.getCatalog()
  }

  /** 目录内全部组件 schema 一次返回（与 GET / 条目一致）；供设计器首屏填充缓存 */
  @GET('/schema/all')
  @ApiOperation({
    summary: '全部组件 Schema',
    description: '一次性返回目录内全部组件的 schema，用于前端首屏预热缓存。',
    operationId: 'getAllComponentSchemas',
  })
  @ApiResponse({
    status: 200,
    description: '全部组件 schema',
    schema: {
      type: 'object',
      properties: {
        schemas: {
          type: 'array',
          items: openApiCubeComponentSchemaV1,
          description: '组件 schema 列表',
        },
      },
    } as Record<string, unknown>,
  })
  @MockableEndpoint('components.schemaAll')
  schemaAll() {
    const { components } = this.catalog.getCatalog()
    const types = [...new Set(components.map((c) => c.cubeType))]
    return { schemas: this.schemaService.getSchemasForCubeTypes(types) }
  }

  /** 按需拉取单组件结构（供多端口、属性面板、连线校验）；不含 template.code */
  @GET('/schema')
  @ApiOperation({
    summary: '单组件 Schema',
    description:
      '按 cubeType（须以 cube.lf. 为前缀）返回输入/输出端口与字段元数据。用于画布连线规则与属性编辑；不含可执行 code。',
    operationId: 'getComponentSchema',
  })
  @ApiResponse({
    status: 200,
    description: '组件 Schema V1',
    schema: openApiCubeComponentSchemaV1,
  })
  @ApiResponse({ status: 400, description: '缺少 cubeType 查询参数' })
  @ApiResponse({ status: 422, description: 'cubeType 前缀非法（须为 cube.lf.*）' })
  @ApiResponse({ status: 404, description: '未知组件或未在 api-all 中注册' })
  @ApiResponse({ status: 502, description: '组件定义缺少 template 等服务端异常' })
  @MockableEndpoint('components.schema')
  schema(
    @Query('cubeType')
    @ApiParam({
      name: 'cubeType',
      in: 'query',
      required: true,
      description: 'Cube 组件类型，须含前缀 cube.lf.，例如 cube.lf.ChatOpenAI',
      schema: { type: 'string' },
    })
    cubeType: string | null,
  ) {
    const raw = cubeType?.trim()
    if (!raw) throw new BadRequestException('cubeType query parameter is required')
    return this.schemaService.getSchemaForCubeType(raw)
  }

  /**
   * 由 `cube_dsl` 生成与 Langflow Check & Save 后一致的输入/输出定义（设计器用）。
   * 仅 `cube.lf.CustomComponent` 节点在 `cubeConfig.cube_dsl` 非空时应调用此接口。
   */
  @POST('/schema/custom-dsl')
  @ApiOperation({
    summary: '基于自定义 DSL 生成 Schema',
    description: '输入 cube_dsl 后，返回与 Langflow Check & Save 一致的组件输入输出定义。',
    operationId: 'getComponentSchemaFromCustomDsl',
  })
  @ApiBody({
    description: '自定义组件 DSL',
    required: true,
    schema: {
      type: 'object',
      properties: {
        cube_dsl: { description: '自定义组件 DSL（任意 JSON）' },
      },
      required: ['cube_dsl'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '由 DSL 生成的组件 schema',
    schema: {
      type: 'object',
    } as Record<string, unknown>,
  })
  @ApiResponse({ status: 400, description: 'cube_dsl 缺失' })
  @MockableEndpoint('components.schemaCustomDsl')
  schemaFromCustomDsl(@Body() body: { cube_dsl?: unknown }) {
    const dsl = body.cube_dsl
    if (dsl === undefined || dsl === null) {
      throw new BadRequestException('cube_dsl is required')
    }
    return buildCubeComponentSchemaFromDslPayload(dsl)
  }
}
