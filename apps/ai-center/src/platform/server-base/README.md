# @cube-ai/server-base

server 侧共享的横切基础设施，不包含业务能力，不单独启动。被 `apps/ai-center` 组合根及 `packages/flow/core`、`packages/kb/core` 等能力包复用（通过 `tsconfig.base.json` 的 `@cube-ai/server-base` 路径别名引用）。

## 目录结构

```text
src/
├── index.ts
├── config/
│   └── app.config.ts              # loadAppConfig：配置文件 + 环境变量 + 命令行参数
├── error/
│   └── unified-error.filter.ts    # UnifiedErrorFilter：统一结构化错误体
├── ids/
│   └── snowflake.ts               # nextSnowflakeId / SnowflakeUtil
└── security/
    ├── access-context.ts          # currentTenantId / isGlobalAccessEnabled / requireScopedTenantId
    ├── execution-auth.middleware.ts   # 执行面鉴权（ADR-0012 addendum：tenant 单一隔离）
    ├── tenant-context.middleware.ts   # tenant 上下文注入
    ├── developer-rate-limit.middleware.ts
    └── middleware-types.ts
```

## 主要导出

见 `src/index.ts`：`loadAppConfig`、`UnifiedErrorFilter`、`createExecutionAuthMiddleware`、`createTenantContextMiddleware`、`createDeveloperRateLimitMiddleware`、`currentTenantId`、`isGlobalAccessEnabled`、`requireScopedTenantId`、`nextSnowflakeId`。

## 约定

- 配置默认从宿主工作目录读取 `${process.cwd()}/config/app.json`，由谁启动就从谁的目录读。
- 租户隔离以 `tenant_id` 为唯一主键，无 project 维度（ADR-0012 addendum）。
- 超管全局可见依赖下游仓储正确识别 `isGlobalAccessEnabled()`。
