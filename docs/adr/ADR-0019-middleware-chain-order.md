# ADR-0019: HTTP middleware 链固定顺序 —— 4 步协议层骨架 + 派生层显式挂载点

- Status: Accepted
- Date: 补档（原决策随 Phase-1/P1-02 落地，Phase-3/4 派生层持续挂载；本文按现状补写，日期不追溯）
- Deciders: agent-engine 团队
- Tags: http, middleware, observability, authn

## Context

`apps/ai-center`（经 `packages/agent/engine/src/bootstrap.ts`）对外只有一条 HTTP 请求管线，所有跨切面关注点（trace、指标、鉴权、错误信封等）都以 `app.use(...)` 顺序挂载的中间件实现。中间件是否遵守某个固定先后关系，只体现在 `bootstrap.ts` 里几行 `app.use` 调用的物理书写顺序——没有类型系统或测试强制这件事，纯靠约定。

原始（Phase-1，P1-02）设计的是一条最小 4 步协议层链：

1. `traceId` —— 最外层，必须在所有中间件之前跑，后续任何日志/错误都要能带上 trace（P1-02）。
2. `http-metrics` —— 可观测性计数器/直方图（P1-10）。
3. `oauth2-introspection` —— 鉴权，产出 `ctx.state.subject`（P1-05）。
4. `errorResponse` —— 最内层，把抛出的错误统一收口成信封（P1-02）。

Phase-3/4 陆续加了 4 个派生层（`versionNegotiation` T11、`idempotency` T13-G10、`tenantContext` T10、`rateLimit` T13-G8），每个派生层都需要相对这 4 步骨架有明确的插入位置，理由各不相同（见 Decision）。这些理由分散在各中间件文件与 `bootstrap.ts` 注释里，从未汇总成一份决策记录——虽然多处代码注释引用 `docs/adr/ADR-0019-middleware-chain-order.md`，该文件在此之前从未真正存在（迁移残留 L5 核查发现）。

## Decision

固定 8 段顺序（`bootstrap.ts` 的 `app.use` 调用即权威落点）：

| # | Middleware | 相对位置理由 |
|---|---|---|
| 1 | `traceId` | 最外层；后续中间件/业务代码的日志与错误都要能带 trace（P1-02）。 |
| 1.5 | `versionNegotiation` | 在 `traceId` 之后，使 412 版本不兼容信封仍带 trace；在 `http-metrics` 之前，使不兼容客户端在计入可观测性计数前就被拒绝。`/health/*`、`/metrics` 绕过（T11）。 |
| 2 | `http-metrics` | 可观测性计数器/直方图（P1-10）。 |
| 3 | `oauth2-introspection` | 鉴权，产出 `ctx.state.subject`（P1-05）。 |
| 3.3 | `idempotency` | 在 `oauth2` 之后，使 `subject.userId` 可作为幂等 key 维度；在 `tenantContext` 之前，使重放命中不依赖尚未建立的 tenant ALS。仅 `POST/PUT/PATCH`；`/health/*`、`/metrics` 绕过（T13-G10）。 |
| 3.5 | `tenantContext` | 经 `AsyncLocalStorage` 传播 `subject.tenant`（T10）；是上下文传播派生层，非协议层步骤，放在鉴权边界内以保证 subject 已就位。 |
| 3.7 | `rateLimit` | 在 `tenantContext` 之后，使限流桶的 `(tenant, path)` 维度可靠；在 `errorResponse` 之前，使 429 也走统一信封。`/health/*`、`/metrics` 绕过；未鉴权请求直接放行（T13-G8）。 |
| 4 | `errorResponse` | 最内层；把抛出的错误统一收口成信封（P1-02）。 |

约束：新增派生层必须在本表补一行、写明相对哪两层插入及理由；不改变原始 4 步骨架的相对顺序（`traceId` 恒最外、`errorResponse` 恒最内、`http-metrics` 恒在鉴权之前、`oauth2` 恒在鉴权后续步骤之前）。

## Consequences

- **Positive**：顺序理由集中一处，新增派生层时有据可依，不必重新审视全链路；`/health/*` 与 `/metrics` 的绕过规则也一并留档，避免误加鉴权/限流拖慢探活。
- **Negative**：顺序仍靠人工遵守 `bootstrap.ts` 的书写顺序，没有测试断言链路顺序；新增中间件若漏更新本表，文档会再次滞后于代码。
- **Neutral**：本文是对既有事实的补档（迁移残留清理），不改变任何现有行为或顺序。

## Open Questions

- 是否需要一个集成测试断言 `app.use` 调用顺序与本表一致，防止未来漂移（当前无该测试）。
