import { ApiBody, ApiOperation, ApiResponse, Body, Controller, GET, Injectable, POST } from '@dangao/bun-server'
import { MockableEndpoint } from '@cube-ai/server-mock'
import { AuthService } from './auth.service'

@Injectable()
@Controller('')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @POST('/oauth2/token')
  @ApiOperation({
    summary: '签发 OAuth2 Token',
    description: '首期支持 password 与 refresh_token grant，返回 Bearer access_token / refresh_token。',
    operationId: 'issueOAuth2Token',
  })
  @ApiBody({
    required: true,
    schema: {
      type: 'object',
      properties: {
        grant_type: { type: 'string', description: 'password 或 refresh_token' },
        username: { type: 'string', description: 'password grant 用户名' },
        password: { type: 'string', description: 'password grant 密码' },
        refresh_token: { type: 'string', description: 'refresh_token grant 刷新令牌' },
        scope: { type: 'string', description: '可选 scope，空时服务端给默认值' },
      },
      required: ['grant_type'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Token 响应',
    schema: {
      type: 'object',
      additionalProperties: true,
    } as Record<string, unknown>,
  })
  @MockableEndpoint('auth.token')
  issueToken(
    @Body()
    body: {
      grant_type?: string
      username?: string
      password?: string
      refresh_token?: string
      scope?: string
    },
  ) {
    return this.authService.issueToken(body ?? {})
  }

  @GET('/auth/me')
  @ApiOperation({
    summary: '当前登录用户',
    description: '返回当前 Bearer Token 对应的登录用户信息。',
    operationId: 'getCurrentUser',
  })
  @ApiResponse({
    status: 200,
    description: '当前用户信息',
    schema: {
      type: 'object',
      additionalProperties: true,
    } as Record<string, unknown>,
  })
  @MockableEndpoint('auth.me')
  me() {
    return this.authService.currentUser()
  }
}
