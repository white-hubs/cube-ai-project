import { ApiBody, ApiOperation, ApiParam, ApiResponse, BadRequestException, Body, Controller, GET, POST, Query } from "@dangao/bun-server";

import { MockableEndpoint } from "@cube-ai/ai-center/platform/server-mock";

import { buildCubeComponentSchemaFromDslPayload } from "../custom-component/dsl-to-cube-schema";
import { ComponentCatalogService } from "./component-catalog.service";
import { ComponentSchemaService } from "./component-schema.service";

const openApiCatalogEntry = {
  properties: {
    category: { description: "分类（侧栏分组）", type: "string" },
    cubeType: { description: "Cube 组件类型，如 cube.lf.OpenAIModel", type: "string" },
    displayName: { description: "展示名", type: "string" },
    lfComponentKey: { description: "Langflow 组件键（无 cube.lf. 前缀）", type: "string" },
    outputNames: { description: "输出句柄名称列表", items: { type: "string" }, type: "array" },
  },
  required: ["cubeType", "lfComponentKey", "category", "displayName", "outputNames"],
  type: "object",
} as const;

const openApiCubeSchemaOutputField = {
  properties: {
    allowsLoop: { description: "是否允许环回连接", type: "boolean" },
    displayName: { description: "展示名", type: "string" },
    method: { description: "可选，api-all outputs[].method", type: "string" },
    name: { description: "输出端口名（连线用）", type: "string" },
    toolMode: { description: "是否为 Tool 相关输出", type: "boolean" },
    types: { description: "可接受的数据类型标签", items: { type: "string" }, type: "array" },
  },
  required: ["name", "displayName", "types", "toolMode", "allowsLoop"],
  type: "object",
} as const;

const openApiCubeSchemaInputField = {
  description: "输入槽位（由 Langflow template 推导，已剔除 code 字段）",
  properties: {
    advanced: { description: "是否高级字段", type: "boolean" },
    displayName: { description: "展示名", type: "string" },
    externalConnectAction: {
      description: "如「连接其他模型」等外链动作",
      properties: {
        displayName: { type: "string" },
        name: { type: "string" },
      },
      type: "object",
    },
    fieldToolMode: { description: "槽位级 tool_mode", type: "boolean" },
    fieldType: { description: "api-all type（控件类型）", type: "string" },
    info: { description: "说明文案", type: "string" },
    inputType: { description: "api-all _input_type；HandleInput 表示仅连线桩", type: "string" },
    inputTypes: { description: "如 Message、Data、HandleInput 等", items: { type: "string" }, type: "array" },
    list: { description: "是否为列表型输入", type: "boolean" },
    name: { description: "字段名", type: "string" },
    options: { description: "下拉等选项，结构随控件变化" },
    password: { description: "是否密码类输入", type: "boolean" },
    placeholder: { description: "占位符", type: "string" },
    rangeSpec: { additionalProperties: true, description: "数值范围等", type: "object" },
    required: { description: "是否必填", type: "boolean" },
    show: { description: "是否在侧栏显示", type: "boolean" },
    tableSchema: {
      description: "TableInput 列定义",
      items: {
        properties: {
          default: { description: "列默认值" },
          description: { type: "string" },
          displayName: { type: "string" },
          editMode: { type: "string" },
          name: { type: "string" },
          type: { type: "string" },
        },
        type: "object",
      },
      type: "array",
    },
    triggerText: { description: "表格编辑触发文案", type: "string" },
    value: { description: "模板默认值，任意 JSON" },
  },
  required: [
    "name",
    "displayName",
    "inputTypes",
    "advanced",
    "show",
    "password",
    "inputType",
    "fieldType",
    "info",
    "required",
    "fieldToolMode",
  ],
  type: "object",
} as const;

const openApiCubeComponentSchemaV1 = {
  description: "单组件结构定义（供设计器端口、属性面板、校验使用；不含 template.code）",
  properties: {
    componentToolModeDefault: { description: "组件级默认 Tool 模式", type: "boolean" },
    cubeType: { description: "与查询参数一致", type: "string" },
    description: { description: "组件说明", type: "string" },
    displayName: { description: "组件展示名", type: "string" },
    fieldOrder: { description: "可选，输入字段展示顺序", items: { type: "string" }, type: "array" },
    inputs: { items: openApiCubeSchemaInputField, type: "array" },
    lfComponentKey: { description: "Langflow 组件键", type: "string" },
    outputs: { items: openApiCubeSchemaOutputField, type: "array" },
    version: { description: "schema 版本，当前为 1", type: "number" },
  },
  required: ["version", "cubeType", "lfComponentKey", "displayName", "description", "componentToolModeDefault", "outputs", "inputs"],
  type: "object",
} as const;

@Controller("/components")
export class ComponentsController {
  constructor(
    private readonly catalog: ComponentCatalogService,
    private readonly schemaService: ComponentSchemaService,
  ) {}

  @GET("/catalog")
  @ApiOperation({
    description: "返回同步生成的全量组件列表（含分类、展示名、输出名），用于侧栏与拖拽。不含各组件详细 template/schema。",
    operationId: "listComponentCatalog",
    summary: "组件目录",
  })
  @ApiResponse({
    description: "目录 JSON（version + components）",
    schema: {
      type: "object",
      properties: {
        version: { type: "number", description: "catalog 文件版本号" },
        components: { type: "array", items: openApiCatalogEntry, description: "全部已注册组件" },
      },
      required: ["version", "components"],
    } as Record<string, unknown>,
    status: 200,
  })
  @ApiResponse({
    description: "未生成 catalog（需执行 bun run sync-components）",
    status: 503,
  })
  @ApiResponse({ description: "catalog 文件损坏或无法解析", status: 500 })
  @MockableEndpoint("components.catalog")
  list() {
    return this.catalog.getCatalog();
  }

  /** 目录内全部组件 schema 一次返回（与 GET / 条目一致）；供设计器首屏填充缓存 */
  @GET("/schema/all")
  @ApiOperation({
    description: "一次性返回目录内全部组件的 schema，用于前端首屏预热缓存。",
    operationId: "getAllComponentSchemas",
    summary: "全部组件 Schema",
  })
  @ApiResponse({
    description: "全部组件 schema",
    schema: {
      type: "object",
      properties: {
        schemas: {
          type: "array",
          items: openApiCubeComponentSchemaV1,
          description: "组件 schema 列表",
        },
      },
    } as Record<string, unknown>,
    status: 200,
  })
  @MockableEndpoint("components.schemaAll")
  schemaAll() {
    const { components } = this.catalog.getCatalog();
    const types = [...new Set(components.map((c) => c.cubeType))];
    return { schemas: this.schemaService.getSchemasForCubeTypes(types) };
  }

  /** 按需拉取单组件结构（供多端口、属性面板、连线校验）；不含 template.code */
  @GET("/schema")
  @ApiOperation({
    description: "按 cubeType（须以 cube.lf. 为前缀）返回输入/输出端口与字段元数据。用于画布连线规则与属性编辑；不含可执行 code。",
    operationId: "getComponentSchema",
    summary: "单组件 Schema",
  })
  @ApiResponse({
    description: "组件 Schema V1",
    schema: openApiCubeComponentSchemaV1,
    status: 200,
  })
  @ApiResponse({ description: "缺少 cubeType 查询参数", status: 400 })
  @ApiResponse({ description: "cubeType 前缀非法（须为 cube.lf.*）", status: 422 })
  @ApiResponse({ description: "未知组件或未在 api-all 中注册", status: 404 })
  @ApiResponse({ description: "组件定义缺少 template 等服务端异常", status: 502 })
  @MockableEndpoint("components.schema")
  schema(
    @Query("cubeType")
    @ApiParam({
      description: "Cube 组件类型，须含前缀 cube.lf.，例如 cube.lf.ChatOpenAI",
      in: "query",
      name: "cubeType",
      required: true,
      schema: { type: "string" },
    })
    cubeType: string | null,
  ) {
    const raw = cubeType?.trim();
    if (!raw) {
      throw new BadRequestException("cubeType query parameter is required");
    }
    return this.schemaService.getSchemaForCubeType(raw);
  }

  /**
   * 由 `cube_dsl` 生成与 Langflow Check & Save 后一致的输入/输出定义（设计器用）。
   * 仅 `cube.lf.CustomComponent` 节点在 `cubeConfig.cube_dsl` 非空时应调用此接口。
   */
  @POST("/schema/custom-dsl")
  @ApiOperation({
    description: "输入 cube_dsl 后，返回与 Langflow Check & Save 一致的组件输入输出定义。",
    operationId: "getComponentSchemaFromCustomDsl",
    summary: "基于自定义 DSL 生成 Schema",
  })
  @ApiBody({
    description: "自定义组件 DSL",
    required: true,
    schema: {
      properties: {
        cube_dsl: { description: "自定义组件 DSL（任意 JSON）" },
      },
      required: ["cube_dsl"],
      type: "object",
    },
  })
  @ApiResponse({
    description: "由 DSL 生成的组件 schema",
    schema: {
      type: "object",
    } as Record<string, unknown>,
    status: 200,
  })
  @ApiResponse({ description: "cube_dsl 缺失", status: 400 })
  @MockableEndpoint("components.schemaCustomDsl")
  schemaFromCustomDsl(@Body() body: { cube_dsl?: unknown }) {
    const dsl = body.cube_dsl;
    if (dsl === undefined || dsl === null) {
      throw new BadRequestException("cube_dsl is required");
    }
    return buildCubeComponentSchemaFromDslPayload(dsl);
  }
}
