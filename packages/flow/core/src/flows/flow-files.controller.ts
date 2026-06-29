import {
  ApiBody,
  type ApiBodyMetadata,
  ApiOperation,
  ApiParam,
  ApiResponse,
  type ApiResponseMetadata,
  BadRequestException,
  Body,
  type Context,
  ContextParam,
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

import { FlowFilesService } from "./flow-files.service";

function openapiRespSchema(s: Record<string, unknown>): NonNullable<ApiResponseMetadata["schema"]> {
  return s as NonNullable<ApiResponseMetadata["schema"]>;
}

function openapiBodySchema(s: Record<string, unknown>): NonNullable<ApiBodyMetadata["schema"]> {
  return s as NonNullable<ApiBodyMetadata["schema"]>;
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    throw new BadRequestException(`invalid ${fieldName}`);
  }
  const s = value.trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") {
    return true;
  }
  if (s === "false" || s === "0" || s === "no") {
    return false;
  }
  throw new BadRequestException(`invalid ${fieldName}`);
}

function parseFileIds(body: unknown): string[] {
  const raw = Array.isArray(body)
    ? body
    : body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)["fileIds"]
      : undefined;
  if (!Array.isArray(raw)) {
    throw new BadRequestException("fileIds is required");
  }
  const ids = raw
    .map((item) => {
      if (typeof item !== "string") {
        throw new BadRequestException("fileIds must be strings");
      }
      return item.trim();
    })
    .filter(Boolean);
  if (ids.length === 0) {
    throw new BadRequestException("fileIds is required");
  }
  return ids;
}

async function requireMultipartFile(ctx: Context): Promise<File> {
  const body = await ctx.getBody();
  if (!(body instanceof FormData)) {
    throw new BadRequestException("multipart/form-data is required");
  }
  const file = body.get("file");
  if (!(file instanceof File)) {
    throw new BadRequestException("file field is required");
  }
  return file;
}

const anyJsonSchema = {
  additionalProperties: true,
  description: "执行后端原始响应，结构随后端版本变化。",
  type: "object",
} as const;

const fileUploadSchema = {
  properties: {
    file: { description: "要上传的文件", format: "binary", type: "string" },
  },
  required: ["file"],
  type: "object",
} as const;

const fileIdsSchema = {
  properties: {
    fileIds: { description: "文件 id 列表", items: { type: "string" }, type: "array" },
  },
  required: ["fileIds"],
  type: "object",
} as const;

/** 文件接口代理。进程内路径 `/files/*` 与 `/flows/:flowId/files/*`，网关对外通常带 `/api` 前缀。 */
@Injectable()
@Controller("/")
export class FlowFilesController {
  constructor(private readonly files: FlowFilesService) {}

  @GET("/flows/:flowId/files")
  @ApiOperation({
    description: "列出流程绑定执行后端中的文件；flowId 使用 Cube 流程 id 或名称，服务端自动映射到绑定的执行后端 flow id。",
    operationId: "listFlowFiles",
    summary: "列出流程文件",
  })
  @ApiResponse({ description: "流程文件列表", schema: openapiRespSchema(anyJsonSchema), status: 200 })
  @ApiResponse({ description: "流程未绑定执行后端 flow", status: 400 })
  @ApiResponse({ description: "未配置执行后端", status: 503 })
  @MockableEndpoint("flows.files.list")
  listFlowFiles(
    @Param("flowId")
    @ApiParam({ description: "Cube 流程 id 或唯一名称", in: "path", name: "flowId", required: true })
    flowId: string,
  ) {
    return this.files.listFlowFiles(flowId);
  }

  @POST("/flows/:flowId/files")
  @ApiOperation({
    description: "上传文件到流程绑定的执行后端 flow，multipart 字段 `file` 必填。",
    operationId: "uploadFlowFile",
    summary: "上传流程文件",
  })
  @ApiBody({ description: "multipart/form-data 文件上传", required: true, schema: openapiBodySchema(fileUploadSchema) })
  @ApiResponse({ description: "上传结果", schema: openapiRespSchema(anyJsonSchema), status: 201 })
  @ApiResponse({ description: "multipart 非法或流程未绑定执行后端 flow", status: 400 })
  @ApiResponse({ description: "未配置执行后端", status: 503 })
  @MockableEndpoint("flows.files.upload")
  async uploadFlowFile(
    @Param("flowId")
    @ApiParam({ description: "Cube 流程 id 或唯一名称", in: "path", name: "flowId", required: true })
    flowId: string,
    @ContextParam() ctx: Context,
  ) {
    return this.files.uploadFlowFile(flowId, await requireMultipartFile(ctx));
  }

  @GET("/flows/:flowId/files/download/:fileName")
  @ApiOperation({
    description: "下载流程绑定执行后端中的文件，透传文件响应头和响应体。",
    operationId: "downloadFlowFile",
    summary: "下载流程文件",
  })
  @ApiResponse({ description: "文件二进制响应", status: 200 })
  @MockableEndpoint("flows.files.download")
  downloadFlowFile(
    @Param("flowId")
    @ApiParam({ description: "Cube 流程 id 或唯一名称", in: "path", name: "flowId", required: true })
    flowId: string,
    @Param("fileName")
    @ApiParam({ description: "流程文件名", in: "path", name: "fileName", required: true })
    fileName: string,
  ) {
    return this.files.downloadFlowFile(flowId, fileName);
  }

  @GET("/flows/:flowId/files/images/:fileName")
  @ApiOperation({
    description: "下载流程绑定执行后端中的图片，透传图片响应。",
    operationId: "downloadFlowImage",
    summary: "下载流程图片",
  })
  @ApiResponse({ description: "图片二进制响应", status: 200 })
  @MockableEndpoint("flows.files.image")
  downloadFlowImage(
    @Param("flowId")
    @ApiParam({ description: "Cube 流程 id 或唯一名称", in: "path", name: "flowId", required: true })
    flowId: string,
    @Param("fileName")
    @ApiParam({ description: "图片文件名", in: "path", name: "fileName", required: true })
    fileName: string,
  ) {
    return this.files.downloadFlowImage(flowId, fileName);
  }

  @DELETE("/flows/:flowId/files/:fileName")
  @ApiOperation({
    description: "删除流程绑定执行后端中的文件。",
    operationId: "deleteFlowFile",
    summary: "删除流程文件",
  })
  @ApiResponse({ description: "删除结果", schema: openapiRespSchema(anyJsonSchema), status: 200 })
  @MockableEndpoint("flows.files.delete")
  deleteFlowFile(
    @Param("flowId")
    @ApiParam({ description: "Cube 流程 id 或唯一名称", in: "path", name: "flowId", required: true })
    flowId: string,
    @Param("fileName")
    @ApiParam({ description: "流程文件名", in: "path", name: "fileName", required: true })
    fileName: string,
  ) {
    return this.files.deleteFlowFile(flowId, fileName);
  }

  @GET("/files/profile-pictures")
  @ApiOperation({
    description: "列出执行后端可用的头像文件。",
    operationId: "listProfilePictures",
    summary: "列出头像文件",
  })
  @ApiResponse({ description: "头像列表", schema: openapiRespSchema(anyJsonSchema), status: 200 })
  @MockableEndpoint("files.profilePictures.list")
  listProfilePictures() {
    return this.files.listProfilePictures();
  }

  @GET("/files/profile-pictures/:folderName/:fileName")
  @ApiOperation({
    description: "下载执行后端头像文件。",
    operationId: "downloadProfilePicture",
    summary: "下载头像文件",
  })
  @ApiResponse({ description: "图片二进制响应", status: 200 })
  @MockableEndpoint("files.profilePictures.download")
  downloadProfilePicture(
    @Param("folderName")
    @ApiParam({ description: "头像目录名", in: "path", name: "folderName", required: true })
    folderName: string,
    @Param("fileName")
    @ApiParam({ description: "头像文件名", in: "path", name: "fileName", required: true })
    fileName: string,
  ) {
    return this.files.downloadProfilePicture(folderName, fileName);
  }

  @GET("/files")
  @ApiOperation({
    description: "列出执行后端 v2 用户文件。",
    operationId: "listUserFiles",
    summary: "列出用户文件",
  })
  @ApiResponse({ description: "用户文件列表", schema: openapiRespSchema(anyJsonSchema), status: 200 })
  @ApiResponse({ description: "未配置执行后端", status: 503 })
  @MockableEndpoint("files.list")
  listUserFiles() {
    return this.files.listUserFiles();
  }

  @POST("/files")
  @ApiOperation({
    description: "上传执行后端 v2 用户文件，multipart 字段 `file` 必填；append query 透传给执行后端。",
    operationId: "uploadUserFile",
    summary: "上传用户文件",
  })
  @ApiBody({ description: "multipart/form-data 文件上传", required: true, schema: openapiBodySchema(fileUploadSchema) })
  @ApiResponse({ description: "上传结果", schema: openapiRespSchema(anyJsonSchema), status: 201 })
  @ApiResponse({ description: "multipart 非法", status: 400 })
  @ApiResponse({ description: "未配置执行后端", status: 503 })
  @MockableEndpoint("files.upload")
  async uploadUserFile(@Query("append") append: string | undefined, @ContextParam() ctx: Context) {
    return this.files.uploadUserFile(await requireMultipartFile(ctx), parseOptionalBoolean(append, "append"));
  }

  @DELETE("/files")
  @ApiOperation({
    description: "删除执行后端 v2 全部用户文件。",
    operationId: "deleteAllUserFiles",
    summary: "删除全部用户文件",
  })
  @ApiResponse({ description: "删除结果", schema: openapiRespSchema(anyJsonSchema), status: 200 })
  @MockableEndpoint("files.deleteAll")
  deleteAllUserFiles() {
    return this.files.deleteAllUserFiles();
  }

  @POST("/files/batch/download")
  @ApiOperation({
    description: "批量下载执行后端 v2 用户文件，请求体支持字符串数组或 `{ fileIds: string[] }`。",
    operationId: "downloadUserFilesBatch",
    summary: "批量下载用户文件",
  })
  @ApiBody({ description: "文件 id 列表", required: true, schema: openapiBodySchema(fileIdsSchema) })
  @ApiResponse({ description: "批量下载响应", status: 200 })
  @MockableEndpoint("files.batchDownload")
  downloadUserFilesBatch(@Body() body: unknown) {
    return this.files.downloadUserFilesBatch(parseFileIds(body));
  }

  @DELETE("/files/batch")
  @ApiOperation({
    description: "批量删除执行后端 v2 用户文件，请求体支持字符串数组或 `{ fileIds: string[] }`。",
    operationId: "deleteUserFilesBatch",
    summary: "批量删除用户文件",
  })
  @ApiBody({ description: "文件 id 列表", required: true, schema: openapiBodySchema(fileIdsSchema) })
  @ApiResponse({ description: "删除结果", schema: openapiRespSchema(anyJsonSchema), status: 200 })
  @MockableEndpoint("files.batchDelete")
  deleteUserFilesBatch(@Body() body: unknown) {
    return this.files.deleteUserFilesBatch(parseFileIds(body));
  }

  @GET("/files/:fileId")
  @ApiOperation({
    description: "下载执行后端 v2 用户文件；returnContent query 透传为 `return_content`。",
    operationId: "downloadUserFile",
    summary: "下载用户文件",
  })
  @ApiResponse({ description: "文件响应；当 returnContent=true 时具体格式取决于执行后端", status: 200 })
  @MockableEndpoint("files.download")
  downloadUserFile(
    @Param("fileId")
    @ApiParam({ description: "文件 id", in: "path", name: "fileId", required: true })
    fileId: string,
    @Query("returnContent") returnContent: string | undefined,
    @Query("return_content") returnContentSnake: string | undefined,
  ) {
    return this.files.downloadUserFile(fileId, {
      returnContent: parseOptionalBoolean(returnContent ?? returnContentSnake, "returnContent"),
    });
  }

  @DELETE("/files/:fileId")
  @ApiOperation({
    description: "删除执行后端 v2 用户文件。",
    operationId: "deleteUserFile",
    summary: "删除用户文件",
  })
  @ApiResponse({ description: "删除结果", schema: openapiRespSchema(anyJsonSchema), status: 200 })
  @MockableEndpoint("files.delete")
  deleteUserFile(
    @Param("fileId")
    @ApiParam({ description: "文件 id", in: "path", name: "fileId", required: true })
    fileId: string,
  ) {
    return this.files.deleteUserFile(fileId);
  }

  @PUT("/files/:fileId")
  @ApiOperation({
    description: '重命名执行后端 v2 用户文件；接口支持 query `name` 或 JSON body `{ "name": "..." }`。',
    operationId: "renameUserFile",
    summary: "重命名用户文件",
  })
  @ApiBody({
    description: "可选；也可用 query `name`",
    required: false,
    schema: openapiBodySchema({
      type: "object",
      properties: { name: { type: "string", description: "新文件名" } },
    }),
  })
  @ApiResponse({ description: "重命名结果", schema: openapiRespSchema(anyJsonSchema), status: 200 })
  @MockableEndpoint("files.rename")
  renameUserFile(
    @Param("fileId")
    @ApiParam({ description: "文件 id", in: "path", name: "fileId", required: true })
    fileId: string,
    @Query("name") queryName: string | undefined,
    @Body() body?: { name?: string },
  ) {
    const name = (queryName ?? body?.name ?? "").trim();
    if (!name) {
      throw new BadRequestException("name is required");
    }
    return this.files.renameUserFile(fileId, name);
  }
}
