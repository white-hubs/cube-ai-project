import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  BadRequestException,
  Body,
  ContextParam,
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
  type Context,
} from '@dangao/bun-server'
import { MockableEndpoint } from '@cube-ai/ai-center/platform/server-mock'
import { FlowFilesService } from './flow-files.service'

function openapiRespSchema(s: Record<string, unknown>): NonNullable<ApiResponseMetadata['schema']> {
  return s as NonNullable<ApiResponseMetadata['schema']>
}

function openapiBodySchema(s: Record<string, unknown>): NonNullable<ApiBodyMetadata['schema']> {
  return s as NonNullable<ApiBodyMetadata['schema']>
}

function parseOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'boolean') return value
  if (typeof value !== 'string') throw new BadRequestException(`invalid ${fieldName}`)
  const s = value.trim().toLowerCase()
  if (s === 'true' || s === '1' || s === 'yes') return true
  if (s === 'false' || s === '0' || s === 'no') return false
  throw new BadRequestException(`invalid ${fieldName}`)
}

function parseFileIds(body: unknown): string[] {
  const raw = Array.isArray(body)
    ? body
    : body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)['fileIds']
      : undefined
  if (!Array.isArray(raw)) {
    throw new BadRequestException('fileIds is required')
  }
  const ids = raw.map((item) => {
    if (typeof item !== 'string') throw new BadRequestException('fileIds must be strings')
    return item.trim()
  }).filter(Boolean)
  if (ids.length === 0) throw new BadRequestException('fileIds is required')
  return ids
}

async function requireMultipartFile(ctx: Context): Promise<File> {
  const body = await ctx.getBody()
  if (!(body instanceof FormData)) {
    throw new BadRequestException('multipart/form-data is required')
  }
  const file = body.get('file')
  if (!(file instanceof File)) {
    throw new BadRequestException('file field is required')
  }
  return file
}

const anyJsonSchema = {
  type: 'object',
  additionalProperties: true,
  description: '执行后端原始响应，结构随后端版本变化。',
} as const

const fileUploadSchema = {
  type: 'object',
  properties: {
    file: { type: 'string', format: 'binary', description: '要上传的文件' },
  },
  required: ['file'],
} as const

const fileIdsSchema = {
  type: 'object',
  properties: {
    fileIds: { type: 'array', items: { type: 'string' }, description: '文件 id 列表' },
  },
  required: ['fileIds'],
} as const

/** 文件接口代理。进程内路径 `/files/*` 与 `/flows/:flowId/files/*`，网关对外通常带 `/api` 前缀。 */
@Injectable()
@Controller('/')
export class FlowFilesController {
  constructor(private readonly files: FlowFilesService) {}

  @GET('/flows/:flowId/files')
  @ApiOperation({
    summary: '列出流程文件',
    description: '列出流程绑定执行后端中的文件；flowId 使用 Cube 流程 id 或名称，服务端自动映射到绑定的执行后端 flow id。',
    operationId: 'listFlowFiles',
  })
  @ApiResponse({ status: 200, description: '流程文件列表', schema: openapiRespSchema(anyJsonSchema) })
  @ApiResponse({ status: 400, description: '流程未绑定执行后端 flow' })
  @ApiResponse({ status: 503, description: '未配置执行后端' })
  @MockableEndpoint('flows.files.list')
  listFlowFiles(
    @Param('flowId')
    @ApiParam({ name: 'flowId', in: 'path', required: true, description: 'Cube 流程 id 或唯一名称' })
    flowId: string,
  ) {
    return this.files.listFlowFiles(flowId)
  }

  @POST('/flows/:flowId/files')
  @ApiOperation({
    summary: '上传流程文件',
    description: '上传文件到流程绑定的执行后端 flow，multipart 字段 `file` 必填。',
    operationId: 'uploadFlowFile',
  })
  @ApiBody({ required: true, description: 'multipart/form-data 文件上传', schema: openapiBodySchema(fileUploadSchema) })
  @ApiResponse({ status: 201, description: '上传结果', schema: openapiRespSchema(anyJsonSchema) })
  @ApiResponse({ status: 400, description: 'multipart 非法或流程未绑定执行后端 flow' })
  @ApiResponse({ status: 503, description: '未配置执行后端' })
  @MockableEndpoint('flows.files.upload')
  async uploadFlowFile(
    @Param('flowId')
    @ApiParam({ name: 'flowId', in: 'path', required: true, description: 'Cube 流程 id 或唯一名称' })
    flowId: string,
    @ContextParam() ctx: Context,
  ) {
    return this.files.uploadFlowFile(flowId, await requireMultipartFile(ctx))
  }

  @GET('/flows/:flowId/files/download/:fileName')
  @ApiOperation({
    summary: '下载流程文件',
    description: '下载流程绑定执行后端中的文件，透传文件响应头和响应体。',
    operationId: 'downloadFlowFile',
  })
  @ApiResponse({ status: 200, description: '文件二进制响应' })
  @MockableEndpoint('flows.files.download')
  downloadFlowFile(
    @Param('flowId')
    @ApiParam({ name: 'flowId', in: 'path', required: true, description: 'Cube 流程 id 或唯一名称' })
    flowId: string,
    @Param('fileName')
    @ApiParam({ name: 'fileName', in: 'path', required: true, description: '流程文件名' })
    fileName: string,
  ) {
    return this.files.downloadFlowFile(flowId, fileName)
  }

  @GET('/flows/:flowId/files/images/:fileName')
  @ApiOperation({
    summary: '下载流程图片',
    description: '下载流程绑定执行后端中的图片，透传图片响应。',
    operationId: 'downloadFlowImage',
  })
  @ApiResponse({ status: 200, description: '图片二进制响应' })
  @MockableEndpoint('flows.files.image')
  downloadFlowImage(
    @Param('flowId')
    @ApiParam({ name: 'flowId', in: 'path', required: true, description: 'Cube 流程 id 或唯一名称' })
    flowId: string,
    @Param('fileName')
    @ApiParam({ name: 'fileName', in: 'path', required: true, description: '图片文件名' })
    fileName: string,
  ) {
    return this.files.downloadFlowImage(flowId, fileName)
  }

  @DELETE('/flows/:flowId/files/:fileName')
  @ApiOperation({
    summary: '删除流程文件',
    description: '删除流程绑定执行后端中的文件。',
    operationId: 'deleteFlowFile',
  })
  @ApiResponse({ status: 200, description: '删除结果', schema: openapiRespSchema(anyJsonSchema) })
  @MockableEndpoint('flows.files.delete')
  deleteFlowFile(
    @Param('flowId')
    @ApiParam({ name: 'flowId', in: 'path', required: true, description: 'Cube 流程 id 或唯一名称' })
    flowId: string,
    @Param('fileName')
    @ApiParam({ name: 'fileName', in: 'path', required: true, description: '流程文件名' })
    fileName: string,
  ) {
    return this.files.deleteFlowFile(flowId, fileName)
  }

  @GET('/files/profile-pictures')
  @ApiOperation({
    summary: '列出头像文件',
    description: '列出执行后端可用的头像文件。',
    operationId: 'listProfilePictures',
  })
  @ApiResponse({ status: 200, description: '头像列表', schema: openapiRespSchema(anyJsonSchema) })
  @MockableEndpoint('files.profilePictures.list')
  listProfilePictures() {
    return this.files.listProfilePictures()
  }

  @GET('/files/profile-pictures/:folderName/:fileName')
  @ApiOperation({
    summary: '下载头像文件',
    description: '下载执行后端头像文件。',
    operationId: 'downloadProfilePicture',
  })
  @ApiResponse({ status: 200, description: '图片二进制响应' })
  @MockableEndpoint('files.profilePictures.download')
  downloadProfilePicture(
    @Param('folderName')
    @ApiParam({ name: 'folderName', in: 'path', required: true, description: '头像目录名' })
    folderName: string,
    @Param('fileName')
    @ApiParam({ name: 'fileName', in: 'path', required: true, description: '头像文件名' })
    fileName: string,
  ) {
    return this.files.downloadProfilePicture(folderName, fileName)
  }

  @GET('/files')
  @ApiOperation({
    summary: '列出用户文件',
    description: '列出执行后端 v2 用户文件。',
    operationId: 'listUserFiles',
  })
  @ApiResponse({ status: 200, description: '用户文件列表', schema: openapiRespSchema(anyJsonSchema) })
  @ApiResponse({ status: 503, description: '未配置执行后端' })
  @MockableEndpoint('files.list')
  listUserFiles() {
    return this.files.listUserFiles()
  }

  @POST('/files')
  @ApiOperation({
    summary: '上传用户文件',
    description: '上传执行后端 v2 用户文件，multipart 字段 `file` 必填；append query 透传给执行后端。',
    operationId: 'uploadUserFile',
  })
  @ApiBody({ required: true, description: 'multipart/form-data 文件上传', schema: openapiBodySchema(fileUploadSchema) })
  @ApiResponse({ status: 201, description: '上传结果', schema: openapiRespSchema(anyJsonSchema) })
  @ApiResponse({ status: 400, description: 'multipart 非法' })
  @ApiResponse({ status: 503, description: '未配置执行后端' })
  @MockableEndpoint('files.upload')
  async uploadUserFile(
    @Query('append') append: string | undefined,
    @ContextParam() ctx: Context,
  ) {
    return this.files.uploadUserFile(await requireMultipartFile(ctx), parseOptionalBoolean(append, 'append'))
  }

  @DELETE('/files')
  @ApiOperation({
    summary: '删除全部用户文件',
    description: '删除执行后端 v2 全部用户文件。',
    operationId: 'deleteAllUserFiles',
  })
  @ApiResponse({ status: 200, description: '删除结果', schema: openapiRespSchema(anyJsonSchema) })
  @MockableEndpoint('files.deleteAll')
  deleteAllUserFiles() {
    return this.files.deleteAllUserFiles()
  }

  @POST('/files/batch/download')
  @ApiOperation({
    summary: '批量下载用户文件',
    description: '批量下载执行后端 v2 用户文件，请求体支持字符串数组或 `{ fileIds: string[] }`。',
    operationId: 'downloadUserFilesBatch',
  })
  @ApiBody({ required: true, description: '文件 id 列表', schema: openapiBodySchema(fileIdsSchema) })
  @ApiResponse({ status: 200, description: '批量下载响应' })
  @MockableEndpoint('files.batchDownload')
  downloadUserFilesBatch(@Body() body: unknown) {
    return this.files.downloadUserFilesBatch(parseFileIds(body))
  }

  @DELETE('/files/batch')
  @ApiOperation({
    summary: '批量删除用户文件',
    description: '批量删除执行后端 v2 用户文件，请求体支持字符串数组或 `{ fileIds: string[] }`。',
    operationId: 'deleteUserFilesBatch',
  })
  @ApiBody({ required: true, description: '文件 id 列表', schema: openapiBodySchema(fileIdsSchema) })
  @ApiResponse({ status: 200, description: '删除结果', schema: openapiRespSchema(anyJsonSchema) })
  @MockableEndpoint('files.batchDelete')
  deleteUserFilesBatch(@Body() body: unknown) {
    return this.files.deleteUserFilesBatch(parseFileIds(body))
  }

  @GET('/files/:fileId')
  @ApiOperation({
    summary: '下载用户文件',
    description: '下载执行后端 v2 用户文件；returnContent query 透传为 `return_content`。',
    operationId: 'downloadUserFile',
  })
  @ApiResponse({ status: 200, description: '文件响应；当 returnContent=true 时具体格式取决于执行后端' })
  @MockableEndpoint('files.download')
  downloadUserFile(
    @Param('fileId')
    @ApiParam({ name: 'fileId', in: 'path', required: true, description: '文件 id' })
    fileId: string,
    @Query('returnContent') returnContent: string | undefined,
    @Query('return_content') returnContentSnake: string | undefined,
  ) {
    return this.files.downloadUserFile(fileId, {
      returnContent: parseOptionalBoolean(returnContent ?? returnContentSnake, 'returnContent'),
    })
  }

  @DELETE('/files/:fileId')
  @ApiOperation({
    summary: '删除用户文件',
    description: '删除执行后端 v2 用户文件。',
    operationId: 'deleteUserFile',
  })
  @ApiResponse({ status: 200, description: '删除结果', schema: openapiRespSchema(anyJsonSchema) })
  @MockableEndpoint('files.delete')
  deleteUserFile(
    @Param('fileId')
    @ApiParam({ name: 'fileId', in: 'path', required: true, description: '文件 id' })
    fileId: string,
  ) {
    return this.files.deleteUserFile(fileId)
  }

  @PUT('/files/:fileId')
  @ApiOperation({
    summary: '重命名用户文件',
    description: '重命名执行后端 v2 用户文件；接口支持 query `name` 或 JSON body `{ "name": "..." }`。',
    operationId: 'renameUserFile',
  })
  @ApiBody({
    required: false,
    description: '可选；也可用 query `name`',
    schema: openapiBodySchema({
      type: 'object',
      properties: { name: { type: 'string', description: '新文件名' } },
    }),
  })
  @ApiResponse({ status: 200, description: '重命名结果', schema: openapiRespSchema(anyJsonSchema) })
  @MockableEndpoint('files.rename')
  renameUserFile(
    @Param('fileId')
    @ApiParam({ name: 'fileId', in: 'path', required: true, description: '文件 id' })
    fileId: string,
    @Query('name') queryName: string | undefined,
    @Body() body?: { name?: string },
  ) {
    const name = (queryName ?? body?.name ?? '').trim()
    if (!name) throw new BadRequestException('name is required')
    return this.files.renameUserFile(fileId, name)
  }
}
