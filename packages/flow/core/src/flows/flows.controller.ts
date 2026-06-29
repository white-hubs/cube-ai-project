import {
  ApiBody,
  type ApiBodyMetadata,
  ApiOperation,
  ApiParam,
  ApiResponse,
  type ApiResponseMetadata,
  BadRequestException,
  Body,
  Controller,
  DELETE,
  GET,
  Injectable,
  POST,
  PUT,
  Param,
  Query,
} from "@dangao/bun-server";

import { MockableEndpoint } from "@cube-ai/ai-center/platform/server-mock";

import { CUBE_FLOW_SCHEMA_VERSION, type CubeFlowGraph } from "../contracts/cube-flow";
import { FlowsService } from "./flows.service";

/** @dangao/bun-server 的 ApiResponse.schema 类型较窄，按 OpenAPI JSON Schema 子集断言 */
function openapiRespSchema(s: Record<string, unknown>): NonNullable<ApiResponseMetadata["schema"]> {
  return s as NonNullable<ApiResponseMetadata["schema"]>;
}

/** @dangao/bun-server 的 ApiBody.schema 类型较窄 */
function openapiBodySchema(s: Record<string, unknown>): NonNullable<ApiBodyMetadata["schema"]> {
  return s as NonNullable<ApiBodyMetadata["schema"]>;
}

const openApiBindingStatus = {
  description: "与 Langflow 的绑定状态：pending 未绑定或创建中；linked 已同步；broken 远端失败或配置异常",
  enum: ["pending", "linked", "broken"],
  type: "string",
} as const;

const openApiFlowListItemProperties = {
  bindingStatus: { ...openApiBindingStatus },
  create_time: { description: "创建时间（ISO 8601）", format: "date-time", type: "string" },
  description: { description: "说明", type: "string" },
  id: { description: "流程主键（UUID）", type: "string" },
  langflowFlowId: { description: "绑定的 Langflow flow id，未绑定时为 null", nullable: true, type: "string" },
  name: { description: "流程名称", type: "string" },
  nodeCount: { description: "画布节点数量（解析 graph 失败时为 0）", type: "number" },
  update_time: { description: "最近更新时间（ISO 8601）", format: "date-time", type: "string" },
} as const;

const openApiCubeFlowViewport = {
  description: "画布视口",
  properties: {
    x: { type: "number" },
    y: { type: "number" },
    zoom: { type: "number" },
  },
  type: "object",
} as const;

const openApiCubeFlowNode = {
  description: "Cube 画布节点（与 Langflow 通过 lfNodeId / cubeType 对应）",
  properties: {
    config: {
      additionalProperties: true,
      description: "模板字段值（与组件 schema 的 inputs 对齐；不含敏感字段过滤由业务层处理）",
      type: "object",
    },
    cubeType: { description: "组件类型，如 cube.lf.OpenAIModel", type: "string" },
    customFields: {
      additionalProperties: true,
      description: "可选，与 Langflow data.node.custom_fields 对齐",
      type: "object",
    },
    fieldOrder: { description: "可选，输入字段展示顺序", items: { type: "string" }, type: "array" },
    fieldUi: {
      additionalProperties: true,
      description: "可选，侧栏字段启用/高级收合、节点级 Tool 模式等",
      type: "object",
    },
    height: { description: "节点高", type: "number" },
    id: { description: "Cube 节点 id", type: "string" },
    lfNodeId: { description: "同步到 Langflow 的节点 id", type: "string" },
    selectedOutputIdx: { description: "可选，多输出组件当前选中输出索引", type: "number" },
    width: { description: "节点宽", type: "number" },
    x: { description: "画布 X", type: "number" },
    y: { description: "画布 Y", type: "number" },
  },
  required: ["id", "lfNodeId", "cubeType", "x", "y", "width", "height", "config"],
  type: "object",
} as const;

const openApiCubeFlowEdge = {
  description: "有向边",
  properties: {
    id: { description: "边 id", type: "string" },
    source: { description: "源节点 id", type: "string" },
    sourcePort: { description: "源端口名（与组件 outputs 的 name 对应）", type: "string" },
    target: { description: "目标节点 id", type: "string" },
    targetPort: { description: "目标端口名（与组件 inputs 的 Handle 名对应）", type: "string" },
  },
  required: ["id", "source", "target", "sourcePort", "targetPort"],
  type: "object",
} as const;

const openApiCubeFlowGraph = {
  description: `Cube 规范画布；schemaVersion 必须为 ${CUBE_FLOW_SCHEMA_VERSION}`,
  properties: {
    edges: { items: openApiCubeFlowEdge, type: "array" },
    nodes: { items: openApiCubeFlowNode, type: "array" },
    schemaVersion: { description: `固定为 ${CUBE_FLOW_SCHEMA_VERSION}`, type: "number" },
    viewport: { ...openApiCubeFlowViewport, nullable: true },
  },
  required: ["schemaVersion", "nodes", "edges"],
  type: "object",
} as const;

const openApiFlowDetailProperties = {
  ...openApiFlowListItemProperties,
  graph: openApiCubeFlowGraph,
} as const;

const openApiTweaks = {
  additionalProperties: { additionalProperties: true, type: "object" },
  description: "Langflow tweaks：Langflow 节点 id → 字段名 → 运行时覆盖值",
  type: "object",
} as const;

const openApiFlowExecutionBodyProperties = {
  input: {
    description: "用户输入；字符串为纯文本，结构化对象可携带 files 多模态附件引用。",
    oneOf: [
      { type: "string" },
      {
        type: "object",
        properties: {
          query: { type: "string", description: "用户输入文本；映射为 Langflow input_request.input_value" },
          files: {
            type: "array",
            description: "已上传到流程文件接口的文件引用；运行时自动注入 ChatInput.files",
            items: {
              type: "object",
              properties: {
                file_path: { type: "string" },
                path: { type: "string" },
                filePath: { type: "string" },
                url: { type: "string" },
                name: { type: "string" },
                mime: { type: "string" },
              },
            },
          },
        },
      },
    ],
  },
  inputType: { description: "Langflow input_type，默认 chat", type: "string" },
  outputType: { description: "Langflow output_type，默认 chat", type: "string" },
  sessionId: {
    description: "Langflow 会话 id。Playground 接口必填且须为本 flow 下已存在会话；run 可选，用于延续上下文",
    type: "string",
  },
  stream: {
    description: "是否流式：POST …/run 为 true 时返回 SSE；Playground 默认 true（仅当显式 false 时同步 JSON）",
    type: "boolean",
  },
  tweaks: openApiTweaks,
} as const;

const openApiPlaygroundMessageItem = {
  properties: {
    content: { description: "正文", type: "string" },
    create_time: { description: "创建时间", format: "date-time", type: "string" },
    id: { description: "消息主键", type: "string" },
    role: { description: "角色", enum: ["user", "bot"], type: "string" },
  },
  required: ["id", "role", "content", "create_time"],
  type: "object",
} as const;

const openApiPlaygroundSessionItem = {
  properties: {
    id: { description: "会话 id（与 Langflow session_id 一致；创建消息、执行时传入 sessionId）", type: "string" },
    isDefault: { description: "是否为默认会话", type: "boolean" },
    title: { description: "标题", nullable: true, type: "string" },
    update_time: { description: "最近更新时间", format: "date-time", type: "string" },
  },
  required: ["id", "title", "isDefault", "update_time"],
  type: "object",
} as const;

const openApiPlaygroundSessionPage = {
  properties: {
    items: { items: openApiPlaygroundSessionItem, type: "array" },
    pageNumber: { type: "number" },
    pageSize: { type: "number" },
    pages: { type: "number" },
    total: { type: "number" },
  },
  required: ["items", "total", "pageNumber", "pageSize", "pages"],
  type: "object",
} as const;

@Injectable()
@Controller("/flows")
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  @GET("/")
  @ApiOperation({
    description: "返回全部 Cube 流程摘要（含节点数、Langflow 绑定状态），不含完整 graph。",
    operationId: "listFlows",
    summary: "流程列表",
  })
  @ApiResponse({
    description: "流程摘要数组",
    schema: openapiRespSchema({
      type: "array",
      items: { type: "object", properties: openApiFlowListItemProperties as Record<string, unknown> },
    }),
    status: 200,
  })
  @MockableEndpoint("flows.list")
  list() {
    return this.flows.list();
  }

  @POST("/")
  @ApiOperation({
    description: "新建空画布并落库；若配置了 LANGFLOW_BASE_URL，会尝试在 Langflow 侧创建 flow 并写入绑定。",
    operationId: "createFlow",
    summary: "创建流程",
  })
  @ApiBody({
    description: "名称必填；可选说明",
    required: true,
    schema: openapiBodySchema({
      properties: {
        description: { description: "可选说明", type: "string" },
        name: { description: "流程名称（trim 后非空）", type: "string" },
      },
      required: ["name"],
      type: "object",
    }),
  })
  @ApiResponse({
    description: "创建后的流程详情（含 graph）",
    schema: openapiRespSchema({
      type: "object",
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
    status: 200,
  })
  @ApiResponse({ description: "name 缺失或为空", status: 400 })
  @MockableEndpoint("flows.create")
  create(@Body() body: { name?: string; description?: string }) {
    const name = body?.name?.trim();
    if (!name) {
      throw new BadRequestException("name is required");
    }
    return this.flows.create({ description: body?.description, name });
  }

  @POST("/import")
  @ApiOperation({
    description:
      "从 export 接口生成的 JSON（cubeFlowExport）或等价的 name、description、graph **新建一条流程**（新 id）；名称与说明来自导出（可被顶层 name/description 覆盖）。若要把画布导入到**已有**流程且保留该流程的名称等元数据，请使用「POST …/:id/import」。",
    operationId: "importFlow",
    summary: "导入流程（新建）",
  })
  @ApiBody({
    description: "支持 `cubeFlowExport` 包装对象，或与导出结构等价的扁平字段；可额外传顶层 `name` 覆盖导出中的名称。",
    required: true,
    schema: openapiBodySchema({
      properties: {
        cubeFlowExport: {
          description: "与 GET …/export 响应中的 cubeFlowExport 同形（import 时可省略 exportedAt）",
          properties: {
            description: { type: "string" },
            exportedAt: { format: "date-time", type: "string" },
            graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
            name: { type: "string" },
            version: { description: "当前为 1", type: "number" },
          },
          required: ["version", "graph"],
          type: "object",
        },
        description: { description: "可选；覆盖说明", type: "string" },
        name: { description: "可选；非空时覆盖导出中的流程名称", type: "string" },
      },
      type: "object",
    }),
  })
  @ApiResponse({
    description: "新建流程详情",
    schema: openapiRespSchema({
      type: "object",
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
    status: 200,
  })
  @ApiResponse({ description: "body 非法、缺少 name 或 graph", status: 400 })
  @ApiResponse({ description: "graph schemaVersion 非 1 或自定义组件校验失败", status: 422 })
  @ApiResponse({ description: "Langflow 同步失败", status: 502 })
  @MockableEndpoint("flows.import")
  importFlow(@Body() body: unknown) {
    return this.flows.importFlow(body);
  }

  @POST("/:id/import")
  @ApiOperation({
    description:
      "将导出 JSON 中的 **graph**（节点、边、视口）写入路径中的流程；**不修改**该流程的名称、说明及 Langflow 绑定等元数据。适用于先新建空流程再仅导入画布。",
    operationId: "importFlowGraphIntoExisting",
    summary: "导入画布到已有流程",
  })
  @ApiBody({
    description: "与 POST /flows/import 相同：可为完整 `cubeFlowExport` 或仅含 `graph`；其中的 name/description 会被忽略。",
    required: true,
    schema: openapiBodySchema({
      properties: {
        cubeFlowExport: {
          description: "与 GET …/export 响应中的 cubeFlowExport 同形（name/description 仅作携带，不会写入）",
          properties: {
            description: { type: "string" },
            exportedAt: { format: "date-time", type: "string" },
            graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
            name: { type: "string" },
            version: { description: "当前为 1", type: "number" },
          },
          required: ["version", "graph"],
          type: "object",
        },
        graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
      },
      type: "object",
    }),
  })
  @ApiResponse({
    description: "更新后的流程详情",
    schema: openapiRespSchema({
      type: "object",
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
    status: 200,
  })
  @ApiResponse({ description: "body 非法或缺少 graph", status: 400 })
  @ApiResponse({ description: "流程不存在", status: 404 })
  @ApiResponse({ description: "graph schemaVersion 非 1 或自定义组件校验失败", status: 422 })
  @ApiResponse({ description: "Langflow 同步失败", status: 502 })
  @MockableEndpoint("flows.importGraph")
  importFlowGraphIntoExisting(
    @Param("id")
    @ApiParam({
      description: "目标流程 UUID 或可唯一解析的名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body() body: unknown,
  ) {
    return this.flows.importGraphIntoExistingFlow(id, body);
  }

  @GET("/:id/export")
  @ApiOperation({
    description: "返回可移植 JSON 快照（不含流程主键与 Langflow 绑定），用于备份或 POST /flows/import 导入。",
    operationId: "exportFlow",
    summary: "导出流程",
  })
  @ApiResponse({
    description: "导出包",
    schema: openapiRespSchema({
      type: "object",
      properties: {
        cubeFlowExport: {
          type: "object",
          properties: {
            version: { type: "number", const: 1 },
            exportedAt: { type: "string", format: "date-time" },
            name: { type: "string" },
            description: { type: "string" },
            graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
          },
          required: ["version", "exportedAt", "name", "description", "graph"],
        },
      },
      required: ["cubeFlowExport"],
    }),
    status: 200,
  })
  @ApiResponse({ description: "流程不存在", status: 404 })
  @MockableEndpoint("flows.export")
  exportFlow(
    @Param("id")
    @ApiParam({
      description: "流程 UUID 或可唯一解析的名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
  ) {
    return this.flows.exportSnapshot(id);
  }

  @GET("/:id")
  @ApiOperation({
    description: "按 UUID 或唯一名称（不区分大小写）解析流程，返回元数据与完整 graph。",
    operationId: "getFlow",
    summary: "流程详情",
  })
  @ApiResponse({
    description: "流程详情",
    schema: openapiRespSchema({
      type: "object",
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
    status: 200,
  })
  @ApiResponse({ description: "id 为空或名称歧义（多条同名）", status: 400 })
  @ApiResponse({ description: "流程不存在", status: 404 })
  @MockableEndpoint("flows.get")
  get(
    @Param("id")
    @ApiParam({
      description: "流程 UUID，或与列表中唯一 name 匹配（大小写不敏感）",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
  ) {
    return this.flows.get(id);
  }

  @PUT("/:id")
  @ApiOperation({
    description: "可更新名称、说明或整体 graph。传入 graph 时会推送到 Langflow 并可能归档默认 Playground 会话。",
    operationId: "updateFlow",
    summary: "更新流程",
  })
  @ApiBody({
    description: "至少提供一项；graph 须满足 CubeFlowGraph 约定（schemaVersion=1）",
    required: true,
    schema: openapiBodySchema({
      properties: {
        description: { description: "新说明", type: "string" },
        graph: openApiCubeFlowGraph as unknown as Record<string, unknown>,
        name: { description: "新名称", type: "string" },
      },
      type: "object",
    }),
  })
  @ApiResponse({
    description: "更新后的流程详情",
    schema: openapiRespSchema({
      type: "object",
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
    status: 200,
  })
  @ApiResponse({ description: "id 解析失败或名称歧义", status: 400 })
  @ApiResponse({ description: "流程不存在", status: 404 })
  @ApiResponse({ description: "graph schemaVersion 非 1 或结构非法", status: 422 })
  @ApiResponse({ description: "Langflow 同步失败", status: 502 })
  @MockableEndpoint("flows.update")
  update(
    @Param("id")
    @ApiParam({
      description: "流程 UUID 或可唯一解析的名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body() body: { name?: string; description?: string; graph?: unknown },
  ) {
    return this.flows.update(id, {
      description: body.description,
      graph: body.graph as CubeFlowGraph | undefined,
      name: body.name,
    });
  }

  @DELETE("/:id")
  @ApiOperation({
    description: "从本地库删除流程及其 Playground 数据（不保证删除远端 Langflow flow）。",
    operationId: "deleteFlow",
    summary: "删除流程",
  })
  @ApiResponse({
    description: "删除成功",
    schema: openapiRespSchema({
      type: "object",
      properties: { deleted: { type: "boolean", description: "恒为 true" } },
      required: ["deleted"],
    }),
    status: 200,
  })
  @ApiResponse({ description: "流程不存在", status: 404 })
  @MockableEndpoint("flows.remove")
  remove(
    @Param("id")
    @ApiParam({
      description: "流程 UUID 或可唯一解析的名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
  ) {
    return this.flows.delete(id);
  }

  @POST("/:id/import-from-langflow")
  @ApiOperation({
    description: "用指定 Langflow flow id 拉取定义，转换为 Cube graph 并写回本地、更新绑定。",
    operationId: "importFlowFromLangflow",
    summary: "从 Langflow 导入画布",
  })
  @ApiBody({
    description: "远端 Langflow flow 标识",
    required: true,
    schema: openapiBodySchema({
      properties: {
        langflowFlowId: { description: "Langflow 侧 flow 的 id（UUID）", type: "string" },
      },
      required: ["langflowFlowId"],
      type: "object",
    }),
  })
  @ApiResponse({
    description: "导入后的流程详情",
    schema: openapiRespSchema({
      type: "object",
      properties: openApiFlowDetailProperties as Record<string, unknown>,
    }),
    status: 200,
  })
  @ApiResponse({ description: "langflowFlowId 缺失", status: 400 })
  @ApiResponse({ description: "Cube 流程不存在", status: 404 })
  @ApiResponse({ description: "未配置 Langflow（LANGFLOW_BASE_URL 等）", status: 503 })
  @ApiResponse({ description: "拉取 Langflow flow 失败", status: 502 })
  @MockableEndpoint("flows.importLf")
  importLf(
    @Param("id")
    @ApiParam({
      description: "目标 Cube 流程 UUID 或名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body() body: { langflowFlowId?: string },
  ) {
    const lf = body?.langflowFlowId?.trim();
    if (!lf) {
      throw new BadRequestException("langflowFlowId is required");
    }
    return this.flows.importFromLangflow(id, lf);
  }

  @GET("/:id/playground/sessions")
  @ApiOperation({
    description: "列出某 flow 下全部会话；会确保存在默认会话。",
    operationId: "listFlowPlaygroundSessions",
    summary: "Playground 会话列表",
  })
  @ApiResponse({
    description: "会话列表",
    schema: openapiRespSchema({ type: "array", items: openApiPlaygroundSessionItem as Record<string, unknown> }),
    status: 200,
  })
  @ApiResponse({ description: "流程不存在", status: 404 })
  @MockableEndpoint("flows.listPlaygroundSessions")
  listPlaygroundSessions(
    @Param("id")
    @ApiParam({
      description: "流程 UUID 或名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
  ) {
    return this.flows.listPlaygroundSessions(id);
  }

  @GET("/:id/playground/sessions/paged")
  @ApiOperation({
    description: "分页列出某 flow 下全部会话；会确保存在默认会话。",
    operationId: "listFlowPlaygroundSessionsPaged",
    summary: "Playground 会话分页列表",
  })
  @ApiResponse({
    description: "分页会话列表",
    schema: openapiRespSchema(openApiPlaygroundSessionPage as Record<string, unknown>),
    status: 200,
  })
  @MockableEndpoint("flows.listPlaygroundSessionsPaged")
  listPlaygroundSessionsPaged(@Param("id") id: string, @Query("pageNumber") pageNumber?: string, @Query("pageSize") pageSize?: string) {
    return this.flows.listPlaygroundSessionsPaged(id, pageNumber ? Number(pageNumber) : undefined, pageSize ? Number(pageSize) : undefined);
  }

  @POST("/:id/playground/sessions")
  @ApiOperation({
    description: "新建会话；asDefault 为 true 时将切换默认会话并归档旧默认标题。",
    operationId: "createFlowPlaygroundSession",
    summary: "创建 Playground 会话",
  })
  @ApiBody({
    description: "可选标题与是否设为默认",
    required: true,
    schema: openapiBodySchema({
      properties: {
        asDefault: { description: "为 true 时设为默认会话", type: "boolean" },
        title: { description: "会话标题", nullable: true, type: "string" },
      },
      type: "object",
    }),
  })
  @ApiResponse({
    description: "新会话 id",
    schema: openapiRespSchema({
      type: "object",
      properties: { id: { type: "string", description: "新建会话主键，供后续 sessionId 使用" } },
      required: ["id"],
    }),
    status: 200,
  })
  @ApiResponse({ description: "流程不存在", status: 404 })
  @MockableEndpoint("flows.createPlaygroundSession")
  createPlaygroundSession(
    @Param("id")
    @ApiParam({
      description: "流程 UUID 或名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body() body: { title?: string | null; asDefault?: boolean },
  ) {
    return this.flows.createPlaygroundSessionRow(id, body ?? {});
  }

  @DELETE("/:id/playground/sessions/:sessionId")
  @ApiOperation({
    description: "删除指定会话；若远端存在 Langflow chat/session，则先同步删除远端。",
    operationId: "deleteFlowPlaygroundSession",
    summary: "删除 Playground 会话",
  })
  @ApiResponse({
    description: "删除结果",
    schema: openapiRespSchema({
      type: "object",
      properties: { deleted: { type: "boolean" } },
      required: ["deleted"],
    }),
    status: 200,
  })
  @MockableEndpoint("flows.deletePlaygroundSession")
  deletePlaygroundSession(@Param("id") id: string, @Param("sessionId") sessionId: string) {
    return this.flows.deletePlaygroundSession(id, sessionId);
  }

  @GET("/:id/playground/sessions/:sessionId/messages")
  @ApiOperation({
    description: "按会话拉取已持久化的 user/bot 消息（时间正序）。",
    operationId: "getFlowPlaygroundSessionMessages",
    summary: "Playground 会话消息历史",
  })
  @ApiResponse({
    description: "消息数组",
    schema: openapiRespSchema({ type: "array", items: openApiPlaygroundMessageItem as Record<string, unknown> }),
    status: 200,
  })
  @ApiResponse({ description: "流程或会话不存在", status: 404 })
  @MockableEndpoint("flows.getPlaygroundSessionMessages")
  getPlaygroundSessionMessages(
    @Param("id")
    @ApiParam({
      description: "流程 UUID 或名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Param("sessionId")
    @ApiParam({
      description: "会话 id（来自创建会话或列表接口）",
      in: "path",
      name: "sessionId",
      required: true,
      schema: { type: "string" },
    })
    sessionId: string,
  ) {
    return this.flows.getPlaygroundSessionMessages(id, sessionId);
  }

  @POST("/:id/playground/messages")
  @ApiOperation({
    description: "sessionId 必填。默认流式返回 text/event-stream（Cube SSE）；stream=false 时同步返回 Langflow JSON 并写入 bot 消息。",
    operationId: "postFlowPlaygroundMessages",
    summary: "Playground 发送消息",
  })
  @ApiBody({
    description: "sessionId 必填；其余字段透传执行后端（Langflow）",
    required: true,
    schema: openapiBodySchema({
      properties: {
        ...openApiFlowExecutionBodyProperties,
        sessionId: {
          ...openApiFlowExecutionBodyProperties.sessionId,
          description: "必填。须为本 flow 下已通过 POST …/playground/sessions 创建的会话 id",
        },
      },
      required: ["sessionId"],
      type: "object",
    }),
  })
  @ApiResponse({
    description:
      "stream 非 false：200，Content-Type: text/event-stream，正文为 SSE 事件流。stream 为 false：200，application/json，结构同 Langflow /api/v1/run 同步结果（随 Langflow 版本变化）。",
    schema: openapiRespSchema({
      type: "object",
      description: "仅非流式时有稳定 JSON；流式时请忽略本 schema，按 SSE 解析",
      additionalProperties: true,
    }),
    status: 200,
  })
  @ApiResponse({ description: "sessionId 缺失", status: 400 })
  @ApiResponse({ description: "流程或会话不存在", status: 404 })
  @ApiResponse({ description: "执行后端不可用（未绑定 Langflow 等）", status: 503 })
  @ApiResponse({ description: "Langflow 执行或流打开失败", status: 502 })
  @MockableEndpoint("flows.playgroundMessages")
  playgroundMessages(
    @Param("id")
    @ApiParam({
      description: "流程 UUID 或名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body()
    body: {
      input?: string | Record<string, unknown>;
      sessionId?: string;
      stream?: boolean;
      inputType?: string;
      outputType?: string;
      tweaks?: Record<string, Record<string, unknown>>;
    },
  ) {
    return this.flows.playgroundMessages(id, {
      input: body.input,
      inputType: body.inputType,
      outputType: body.outputType,
      sessionId: body.sessionId,
      stream: body.stream,
      tweaks: body.tweaks,
    });
  }

  @POST("/:id/run")
  @ApiOperation({
    description: "先同步当前 graph 到 Langflow 再执行。stream=true 时返回 SSE；否则返回 Langflow 同步 JSON。",
    operationId: "runFlow",
    summary: "执行流程（Run）",
  })
  @ApiBody({
    description: "执行参数；sessionId / tweaks 等与 Langflow input_request 一致",
    required: true,
    schema: openapiBodySchema({
      properties: openApiFlowExecutionBodyProperties as Record<string, unknown>,
      type: "object",
    }),
  })
  @ApiResponse({
    description:
      "stream 为 true：text/event-stream，Cube SSE。stream 为 false 或未传：application/json，Langflow run 同步响应（结构随版本变化）。",
    schema: openapiRespSchema({
      type: "object",
      description: "非流式响应；流式时请按 SSE 处理",
      additionalProperties: true,
    }),
    status: 200,
  })
  @ApiResponse({ description: "流程不存在", status: 404 })
  @ApiResponse({ description: "执行后端不可用", status: 503 })
  @ApiResponse({ description: "Langflow 执行失败", status: 502 })
  @MockableEndpoint("flows.run")
  run(
    @Param("id")
    @ApiParam({
      description: "流程 UUID 或名称",
      in: "path",
      name: "id",
      required: true,
      schema: { type: "string" },
    })
    id: string,
    @Body()
    body: {
      input?: string | Record<string, unknown>;
      sessionId?: string;
      stream?: boolean;
      inputType?: string;
      outputType?: string;
      tweaks?: Record<string, Record<string, unknown>>;
    },
  ) {
    const stream = body.stream === true;
    if (stream) {
      return this.flows.runStream(id, body);
    }
    return this.flows.run(id, body);
  }
}
