# AI Server Base

`@cube-ai/server-base` 提供 server 子包共享的横切基础设施，不包含具体业务能力。

它当前负责：

- 配置加载
- 统一错误过滤
- Bearer Token / Developer API Key / Project Context 中间件
- 当前请求访问范围判定工具

## 包定位

这个包是基础设施包，供以下包复用：

- `@cube-ai/bootstrap`
- `@cube-ai/flow`
- `@cube-ai/kb`

它不暴露业务接口，不单独启动。

## 目录结构

```text
src/
├── index.ts
├── config/
│   └── app.config.ts
├── error/
│   └── unified-error.filter.ts
└── security/
    ├── access-context.ts
    ├── bearer-token.middleware.ts
    ├── developer-api-key.middleware.ts
    ├── developer-rate-limit.middleware.ts
    ├── middleware-types.ts
    └── project-context.middleware.ts
```

## 主要导出

通过 `src/index.ts` 对外导出：

- `loadAppConfig`
- `UnifiedErrorFilter`
- `createAccessTokenMiddleware`
- `createOptionalUserMiddleware`
- `createDeveloperApiKeyMiddleware`
- `createDeveloperRateLimitMiddleware`
- `createProjectContextMiddleware`
- `currentProjectId`
- `isGlobalAccessEnabled`
- `requireScopedProjectId`

## 主要职责

### 配置

`loadAppConfig()` 统一处理：

- 配置文件
- 环境变量
- 命令行参数

默认配置文件路径为：

```text
${process.cwd()}/config/app.json
```

这意味着由谁作为宿主启动，配置就从谁的工作目录读取。

### 访问上下文

提供统一的请求级访问上下文：

- Bearer Token 登录用户上下文
- Developer API Key 执行上下文
- Project 访问范围上下文

### 中间件

提供：

- Bearer Token 校验与用户注入
- Developer API Key 校验与限流
- Project Context 注入与超管全局可见控制

### 异常处理

`UnifiedErrorFilter` 统一输出结构化错误体。

## 在宿主中的典型用法

宿主服务通常会：

1. 使用 `loadAppConfig()` 读取配置
2. 注册 `UnifiedErrorFilter`
3. 挂载：
   - `createAccessTokenMiddleware()`
   - `createDeveloperApiKeyMiddleware()`
   - `createDeveloperRateLimitMiddleware()`
   - `createProjectContextMiddleware()`

## 当前限制

- 当前 OAuth2 首期只实现第一方 `password` / `refresh_token` grant，后续可继续扩展 `authorization_code + PKCE`
- 超管全局可见依赖下游服务或仓储正确识别 `isGlobalAccessEnabled()`
