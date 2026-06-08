import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@dangao/bun-server'
import { SnowflakeUtil } from '@cube-ai/server-base'
import {
  hashOpaqueToken,
  randomOpaqueToken,
  verifyPassword,
} from '../db/sqlite'
import { FLOW_REPOSITORY_TOKEN, type FlowRepository } from '../db/repository-contracts'
import { authenticatedUserAls } from '@cube-ai/server-shared'

type AuthAccessTokenRecord = {
  userId: string
  username: string
  role: string
  isSuperAdmin: boolean
}

const ACCESS_TOKEN_TTL_MS = 2 * 60 * 60 * 1000
const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000

@Injectable()
export class AuthService {
  private readonly repo: FlowRepository

  constructor(@Inject(FLOW_REPOSITORY_TOKEN) repo: FlowRepository) {
    this.repo = repo
  }

  async issueToken(body: {
    grant_type?: string
    username?: string
    password?: string
    refresh_token?: string
    scope?: string
  }) {
    const grantType = body.grant_type?.trim()
    if (!grantType) throw new BadRequestException('grant_type is required')
    if (grantType === 'password') {
      return this.issuePasswordGrant(body)
    }
    if (grantType === 'refresh_token') {
      return this.issueRefreshGrant(body)
    }
    throw new BadRequestException('unsupported grant_type')
  }

  currentUser() {
    const auth = authenticatedUserAls.getStore()
    if (!auth) throw new UnauthorizedException('missing authenticated user')
    return {
      id: auth.userId,
      username: auth.username,
      role: auth.role,
      isSuperAdmin: auth.isSuperAdmin,
    }
  }

  async verifyAccessToken(rawToken: string): Promise<AuthAccessTokenRecord | null> {
    const user = await this.repo.verifyAccessToken(rawToken)
    if (!user) return null
    return {
      userId: user.id,
      username: user.username,
      role: user.role,
      isSuperAdmin: user.role === 'super_admin',
    }
  }

  private async issuePasswordGrant(body: {
    username?: string
    password?: string
    scope?: string
  }) {
    const username = body.username?.trim()
    const password = body.password ?? ''
    if (!username || !password) {
      throw new BadRequestException('username and password are required')
    }
    const user = await this.repo.getAuthUserByUsername(username)
    if (!user || user.status !== 'active' || !verifyPassword(password, user.password_hash)) {
      throw new UnauthorizedException('invalid username or password')
    }
    return this.persistTokenPair(user.id, user.username, user.role, body.scope ?? '')
  }

  private async issueRefreshGrant(body: {
    refresh_token?: string
    scope?: string
  }) {
    const refreshToken = body.refresh_token?.trim()
    if (!refreshToken) {
      throw new BadRequestException('refresh_token is required')
    }
    const verified = await this.repo.verifyRefreshToken(refreshToken)
    if (!verified) {
      throw new UnauthorizedException('invalid or expired refresh_token')
    }
    await this.repo.revokeRefreshToken(verified.refresh.id)
    await this.repo.revokeAccessToken(verified.refresh.access_token_id)
    return this.persistTokenPair(verified.user.id, verified.user.username, verified.user.role, body.scope ?? '')
  }

  private async persistTokenPair(userId: string, username: string, role: string, scopeRaw: string) {
    const accessToken = randomOpaqueToken('atk')
    const refreshToken = randomOpaqueToken('rtk')
    const accessTokenId = SnowflakeUtil.nextId()
    const refreshTokenId = SnowflakeUtil.nextId()
    const now = new Date()
    const accessExpiresAt = new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString()
    const refreshExpiresAt = new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString()
    const scope = scopeRaw.trim() !== '' ? scopeRaw.trim().split(/\s+/) : ['super_admin']
    const createdAt = now.toISOString()
    await this.repo.createAccessToken({
      id: accessTokenId,
      token_hash: hashOpaqueToken(accessToken),
      user_id: userId,
      username,
      role,
      scope_json: JSON.stringify(scope),
      expires_at: accessExpiresAt,
      create_time: createdAt,
    })
    await this.repo.createRefreshToken({
      id: refreshTokenId,
      token_hash: hashOpaqueToken(refreshToken),
      user_id: userId,
      access_token_id: accessTokenId,
      expires_at: refreshExpiresAt,
      create_time: createdAt,
    })
    return {
      token_type: 'Bearer',
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      refresh_expires_in: Math.floor(REFRESH_TOKEN_TTL_MS / 1000),
      scope: scope.join(' '),
      role,
    }
  }
}
