import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  BadRequestException,
  Body,
  Controller,
  DELETE,
  GET,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  POST,
  PUT,
} from '@dangao/bun-server'
import { SnowflakeUtil } from '@cube-ai/server-base'
import { hashPassword } from '../db/sqlite'
import { FLOW_REPOSITORY_TOKEN, type FlowRepository } from '../db/repository-contracts'
import { authenticatedUserAls } from '@cube-ai/server-shared'

function requireSuperAdmin() {
  const auth = authenticatedUserAls.getStore()
  if (!auth?.isSuperAdmin) {
    throw new BadRequestException('Super-admin privilege required')
  }
}

function toPublicUser(row: { id: string; username: string; role: string; status: string; create_time: string; update_time: string }) {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    create_time: row.create_time,
    update_time: row.update_time,
  }
}

/**
 * 用户管理接口（仅 super_admin 可访问）。
 */
@Injectable()
@Controller('/auth')
export class UsersController {
  private readonly repo: FlowRepository

  constructor(@Inject(FLOW_REPOSITORY_TOKEN) repo: FlowRepository) {
    this.repo = repo
  }

  @GET('/users')
  @ApiOperation({ summary: '列出所有用户', operationId: 'listAuthUsers' })
  @ApiResponse({ status: 200, description: '用户列表', schema: { type: 'array' } as Record<string, unknown> })
  async list() {
    requireSuperAdmin()
    return (await this.repo.listAuthUsers()).map(toPublicUser)
  }

  @POST('/users')
  @ApiOperation({ summary: '创建用户', operationId: 'createAuthUser' })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        username: { type: 'string' },
        password: { type: 'string' },
        role: { type: 'string', description: 'admin | developer | viewer' },
      },
      required: ['username', 'password'],
    },
  })
  @ApiResponse({ status: 200, description: '用户已创建', schema: { type: 'object' } as Record<string, unknown> })
  async create(
    @Body()
    body: {
      username?: string
      password?: string
      role?: string
    },
  ) {
    requireSuperAdmin()
    const username = body.username?.trim()
    const password = body.password?.trim()
    if (!username) throw new BadRequestException('username is required')
    if (!password) throw new BadRequestException('password is required')

    const existing = await this.repo.getAuthUserByUsername(username)
    if (existing) throw new BadRequestException(`Username '${username}' already exists`)

    const id = SnowflakeUtil.nextId()
    const role = body.role?.trim() || 'developer'
    await this.repo.createAuthUser({
      id,
      username,
      passwordHash: hashPassword(password),
      passwordAlgo: 'sha256-base64',
      role,
      status: 'active',
      defaultProjectId: null,
    })
    const created = await this.repo.getAuthUserById(id)
    if (!created) throw new NotFoundException(`User ${id} not found`)
    return toPublicUser(created)
  }

  @PUT('/users/:id')
  @ApiOperation({ summary: '更新用户', operationId: 'updateAuthUser' })
  @ApiBody({
    required: false,
    schema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        status: { type: 'string' },
        password: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 200, description: '用户已更新', schema: { type: 'object' } as Record<string, unknown> })
  async update(
    @Param('id') id: string,
    @Body() body: { role?: string; status?: string; password?: string },
  ) {
    requireSuperAdmin()
    const user = await this.repo.getAuthUserById(id)
    if (!user) throw new NotFoundException(`User ${id} not found`)

    await this.repo.updateAuthUser(id, {
      ...(body.role !== undefined ? { role: body.role.trim() } : {}),
      ...(body.status !== undefined ? { status: body.status.trim() } : {}),
    })

    if (body.password?.trim()) {
      const hash = hashPassword(body.password.trim())
      await this.repo.updateAuthUserPassword(id, hash, 'sha256-base64')
    }

    const updated = await this.repo.getAuthUserById(id)
    if (!updated) throw new NotFoundException(`User ${id} not found`)
    return toPublicUser(updated)
  }

  @DELETE('/users/:id')
  @ApiOperation({ summary: '删除用户', operationId: 'deleteAuthUser' })
  @ApiResponse({ status: 200, description: '用户已删除', schema: { type: 'object' } as Record<string, unknown> })
  async remove(@Param('id') id: string) {
    requireSuperAdmin()
    const user = await this.repo.getAuthUserById(id)
    if (!user) throw new NotFoundException(`User ${id} not found`)

    const auth = authenticatedUserAls.getStore()
    if (auth?.userId === id) throw new BadRequestException('Cannot delete yourself')

    await this.repo.deleteAuthUser(id)
    return { ok: true, id }
  }
}
