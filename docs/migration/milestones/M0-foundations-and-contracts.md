# M0 — 地基 & contracts 内核

> 渐进式披露：本文是 M0 的详情。先读 [`../README.md`](../README.md) §3/§4/§5。事实地基：[`../inventory/agent-engine.md`](../inventory/agent-engine.md)（§2/§3/§10/§11）、[`../inventory/cube-ai-platform.md`](../inventory/cube-ai-platform.md)（§1/§2/§8）。

**Goal**：立起本仓 monorepo 骨架与**唯一共享内核 `contracts`** + `infra/*` 底座，并把两条会卡死后续的硬约束（@tachu 取数、bun-server 版本）在最早期清掉。本里程碑**不迁任何业务逻辑**。

**Architecture**：Bun workspaces，目录 `apps/ packages/ infra/`；`contracts` 零业务依赖、被所有人依赖；`infra/*` 是框架扩展与测试夹具。

**Tech Stack**：Bun、`@dangao/bun-server`、zod、TypeScript、testcontainers（仅 infra/test-infra）。

**依赖**：无。 **被依赖**：M1–M6 全部。

## Entry 准则
- 已读 README 的全局不变量与三条硬约束 G1/G2/G3。

## Exit 准则
- `bun install` + `bun run typecheck` 通过；`contracts`、`infra/*` 各包 typecheck 绿。
- 离线测试子集（contracts 自带单测）`bun test` 绿。
- G1 结论（@tachu 可达方案）与 G2 结论（bun-server 基线版本 + flow/kb 适配清单）写入 `PROGRESS.md §3`。
- README §7 第 3/4 条 ADR 修正中、与 contracts 形态相关的部分已记录待办。

---

## Task M0.T1 — monorepo 脚手架

**Files**
- Create: `package.json`（根，workspaces + catalog）、`tsconfig.base.json`、`bunfig.toml`、`.gitignore`（已存在则增量）
- Create: 目录 `apps/`、`packages/`、`infra/`（占位 `.gitkeep`）

**Steps**
- [ ] 设根 `package.json`：
```json
{
  "name": "cube-ai-project",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "infra/*", "platform-adapter-*"],
  "catalog": { "zod": "^3.23.8", "typescript": "^5.9.0", "@types/bun": "latest" },
  "catalogs": { "bun-server": { "@dangao/bun-server": "^3.1" } }
}
```
- [ ] `tsconfig.base.json`：`"module":"ESNext"`、`"moduleResolution":"bundler"`、`"strict":true`、`"types":["bun-types"]`、`"paths"` 留空（靠 workspace 解析）。
- [ ] 验证：`bun install` 成功；`ls apps packages infra`。

**验收**：`bun pm ls` 列出工作区根；`bun run typecheck`（此刻无包，应空跑成功）。

## Task M0.T2 — G1：@tachu/* 取数前置（阻塞性）

> 来源：`inventory/agent-engine.md §10/§11.1/§12.5`。agent-engine 依赖 `@tachu/{core,extensions,host-defaults}@1.0.0-rc.0`（私有 Nexus），M2 编译前置。

**Steps**
- [ ] 读源仓 `cube-agentic-engine/deploy/buildkit/nexus-guhecloud.toml.example` 与根 `bunfig.toml`/`.npmrc`，确认 registry 地址与 scope（`@tachu`、`@dangao`）。
- [ ] 在本仓配置 registry 访问（`bunfig.toml` 的 `[install.scopes]` 或 `.npmrc`），用一次性命令验证可达：
```bash
bun add -d @tachu/core@1.0.0-rc.0   # 仅验证可拉取；验证后可移除
```
- [ ] 若不可达：记录 vendoring 方案（把 `@tachu/*` tarball 落 `vendor/` + workspace 指向）作为 fallback。
- [ ] 在 `PROGRESS.md §3 G1` 写结论（可达 / vendoring / 阻塞）。

**验收**：要么 `bun add @tachu/core` 成功，要么 vendoring 方案可复现安装。**此 task 不过，M2 不可启动。**

## Task M0.T3 — G2：框架基线统一（阻塞性）

> 来源：`inventory/agent-engine.md §1`（engine `@dangao/bun-server ^3.1.0`）vs `inventory/flow.md §1` / `inventory/cube-ai-platform.md §1`（flow/kb `2.3.0`）。

> **基线已定（用户决策 2026-06-06）：`@dangao/bun-server` = `^3.1`**（engine 原生版本，运行时锚点不降级）。flow/kb 从 `2.3` 适配上移。本 task 余下工作 = 产出适配清单。

**Steps**
- [ ] 取 `2.3 → 3.1` 的 changelog/API 差异（`Application`/`@Module`/中间件 `app.use`/`DatabaseModule.forRootAsync`/`ExceptionFilterRegistry`/DI token 等）。
- [ ] 产出「flow/kb 2.3→3.1 适配清单」：逐条列 break 点与改法，存为本文「附录 A」。
- [ ] 确认根 `catalogs.bun-server` = `^3.1`（M0.T1 已写）。

**验收**：适配清单成文（M2.T3 / M4.T4 据此执行）。

## Task M0.T4 — copy contracts 内核

> 来源：`inventory/agent-engine.md §3`。port 已就位（Flow/FlowCatalog/Knowledge/LlmCatalog），错误码/wire schema/DI token 齐备。

**Files**
- Create: `packages/contracts/`（从 `cube-agentic-engine/packages/agentic-contracts/` copy 全量 src + 自带单测）
- Modify: `packages/contracts/package.json`（name → `@cube-ai/contracts`，version 归零，去 skeleton 后缀）

**Steps**
- [ ] copy `agentic-contracts/src/**` → `packages/contracts/src/**`（含 `platform/`、`errors/`、`sse/`、`tools/`、`session/`、`outbox/`、`auth/`、`authz/` 等 + `*.test.ts`）。
- [ ] 改包名为 `@cube-ai/contracts`；`exports` 保持聚合 `src/index.ts`。
- [ ] 暂不改 DI token 命名空间（留 M0.T6 决策）。
- [ ] 跑自带单测。

**验收**：`bun test packages/contracts` 绿（≈2519 测试 LOC 的离线子集）；`bun run --filter @cube-ai/contracts typecheck` 绿。

## Task M0.T5 — copy infra 扩展 + test-infra

> 来源：`inventory/agent-engine.md §2/§11.2/§11.9`。

**Files**
- Create: `infra/bun-server-ext-sse/`、`infra/bun-server-ext-outbox/`、`infra/bun-server-ext-nacos/`、`infra/test-infra/`（从 engine 同名包 copy）
- Create: `patches/`（携 `@dangao/nacos-client@0.1.1` 补丁）+ 根 `package.json` 的 `patchedDependencies`

**Steps**
- [ ] copy 四包 src + 单测；改 scope 为 `@cube-ai/*`（沿用原名）。
- [ ] 携带 nacos 补丁文件与 `patchedDependencies` 声明。
- [ ] `bun install` 使补丁生效。

**验收**：`bun test infra/bun-server-ext-sse infra/bun-server-ext-outbox` 离线单测绿；nacos 补丁应用无告警。

## Task M0.T6 — DI token 命名空间决策

> 来源：`inventory/agent-engine.md §3.1/§12.6`。token 是 `Symbol.for('agentic.adapter.platform.*')`，跨包全局符号。

**Steps**
- [ ] 决策默认：**保留 `agentic.*` 命名空间**（避免一次性全仓符号切换风险；ADR-0011 是包名规范，不强制 token 字符串）。如决定迁 `agent.*`，必须全仓一次性替换并加测试。
- [ ] 在 contracts `platform/tokens.ts` 落定，写一行注释说明决策与理由。

**验收**：决策写入本文「决策记录」+ `PROGRESS.md`；contracts typecheck 绿。

## Task M0.T7 — CI / lint / typecheck 流水线

**Files**: Create `.github/workflows/ci.yml`（或对应 CI）、根 `package.json` scripts（`typecheck`/`test`/`test:offline`）

**Steps**
- [ ] `scripts.typecheck` = `bun run --filter '*' typecheck`；`scripts.test:offline` = 不起容器的 `bun test`（按包过滤离线子集）。
- [ ] CI gate：install → typecheck → test:offline。容器测试（testcontainers）单列可选 job（按 README G1 决定是否在 CI 跑）。

**验收**：CI 在仅含 contracts+infra 的仓上跑绿。

## Task M0.T8 — entry/exit 自检 + ADR 修正回填

**Steps**
- [ ] 跑全量 `bun run typecheck` + `bun run test:offline` 绿。
- [ ] 按 README §7 回填：在 `docs/adr/` 标注「`LlmProviderPort` 待 M1 定义」「`EmbeddingPort` 形态待 M1 决策」（仅加 note，不改决策）。
- [ ] 勾选 `PROGRESS.md` 的 M0 全部 task；写会话日志；把指针移到 M1。

**验收**：Exit 准则全绿。

---

## 本里程碑风险
- **G1/G2 任一不过会阻塞 M2**：务必在 T2/T3 给出明确结论或 fallback，不要带病进入 M1。
- contracts 自述「skeleton 只代表性 schema」：copy 后若发现 wire schema 不全，记入偏差区，M1/M3/M4 按需补齐（不在 M0 强求全集）。

## 决策记录
- （T3）bun-server 基线版本：**`^3.1`**（用户决策 2026-06-06，engine 原生、运行时锚点不降级；flow/kb 2.3→3.1 适配上移）
- （T6）DI token 命名空间：**保留 `agentic.*`**（决策 2026-06-06；不迁 `agent.*`，避免全仓 `Symbol.for` 一次性切换风险；详见 [`decisions/M0-T6-di-token-namespace.md`](../decisions/M0-T6-di-token-namespace.md)）

## 附录 A — flow/kb 2.3→3.1 bun-server 适配清单

> 勘察范围（只读，2026-06-06）：`redesign/cube-ai/server/{flow,kb,server-base,server-shared,server-mock,bootstrap}` vs `cube-agentic-engine/packages/engine`；对照 `@dangao/bun-server@2.3.0` 与 `@3.1.0` 的 `dist/*.d.ts` 与官方 `docs/zh/migration.md`。**官方声明的 2.x→3.0 破坏性变更仅 WebSocket 守卫类型与 `getServer()` 返回类型**；flow/kb 当前 **零** `WebSocketGateway` / `getServer()` 引用。下列清单 = 官方 break + 代码审计发现的**运行时/装配风险**（优先级按 M2/M4 阻塞程度）。

| # | break 点 | 影响（文件/符号） | 建议改法 | 优先级 |
|---|----------|-------------------|----------|--------|
| 1 | **workspace catalog 仍钉死 2.3.0** | `redesign/cube-ai/package.json` `catalogs.bun-server`；`server/package.json` 根依赖 `"@dangao/bun-server": "2.3.0"`；各子包 `"catalog:bun-server"` | 统一改为 `"^3.1"`（与本仓 M0.T1 `catalogs.bun-server` 对齐）；`bun install` 后确认 lock 仅一份 3.1.x | **高** |
| 2 | **`DatabaseModule` V1 配置（`database` + `pool`）已 @deprecated** | `bootstrap/src/app.module.ts` `DatabaseModule.forRootAsync`；`flow/src/db/shared-repositories.ts` `buildDatabaseOptions()` | 3.1 仍兼容 V1，但默认走 Bun SQL 归一化路径。短期可保留 V1 + 保留 `DatabaseConnectionBootstrap`；中期迁 V2：`type`/`url`/`databasePath` + `bunSqlPool`（与 engine 侧 `MysqlModule` 自建 pool 二选一，避免双连接） | **中** |
| 3 | **Bun SQL 路径下 `DatabaseService.initialize()` 必须显式调用** | `bootstrap/src/database-connection.bootstrap.ts`（注释已说明）；kb ORM：`document*.repository.ts`、`import-job.repository.ts`、`document-chunk.repository.ts`（`BaseRepository`/`executeQuery`） | 3.1 与 2.3 行为一致：`DatabaseConnectionBootstrap.onModuleInit` 必须保留；**禁止**假设 `DatabaseModule` 中间件会自动填充 legacy `ConnectionManager`。MySQL 集成测试：`SET SESSION time_zone` 逻辑保留 | **高** |
| 4 | **flow 旁路 DI 手动 `new DatabaseService()`** | `flow/src/db/shared-repositories.ts` `initSharedRepositories()`（MySQL 分支） | 与 bootstrap 的 `DATABASE_SERVICE_TOKEN` 实例**可能双池**（3.1 仍会发生）。M4 收敛：MySQL 模式改注入 `DATABASE_SERVICE_TOKEN`，或 flow-core 仅 SQLite 本地 dev、生产走 host `DatabaseModule` | **中** |
| 5 | **kb `OrmDatabaseModule` 不含 `DatabaseModule`/`LoggerModule`** | `kb/src/infrastructure/orm/orm-database.module.ts`；4× `@Repository` + `@Entity`；`@Inject(LOGGER_TOKEN)` | 完整宿主已在 `bootstrap/src/app.module.ts` 装配；`kb/src/single.ts` **无** DB/Logger → ORM 路由运行必挂。迁后验证：`single` 仅 smoke 无 DB 路由；集成走 bootstrap。若 standalone kb，需 `imports: [DatabaseModule.forRootAsync(...), LoggerModule.forRoot(...)]` | **高** |
| 6 | **`BaseRepository.query()` 同步/异步 union** | kb 全部 ORM repository（8 文件）；`flow/src/db/mysql-repositories.ts` 直接 `DatabaseService.query()` | 3.1 d.ts：`sqlite` 在 bun:sqlite 同步、**@vscode/sqlite3 异步**；MySQL 恒 `Promise`。现有代码已 `await this.executeQuery` / `if (r instanceof Promise) await r` 的模式**必须保留**。升级后跑 kb ORM 单测 + bootstrap MySQL smoke | **高** |
| 7 | **SSE + 默认 `enableSignalHandlers: true` 与 engine 不一致** | `flow/src/single.ts`、`bootstrap/src/main.ts`（`sseKeepAlive`）；`flow/src/http/sse-response.ts`；对比 engine `assembler/engine-assembler.ts` `enableSignalHandlers: false` | 非编译 break；长 SSE（playground/LF 代理）在 3.1 仍可能与内置 SIGTERM 抢 `server.stop()`（engine 已踩坑）。建议 host 层对齐 engine：`enableSignalHandlers: false` + 自建 graceful（M2 再引 ext-sse 亦可） | **中** |
| 8 | **`MockInterceptor` 注释绑定 2.x 链语义** | `server-mock/src/mock.interceptor.ts`、`register-mock-interceptor.ts`（`INTERCEPTOR_REGISTRY_TOKEN`） | 3.1 `BaseInterceptor.execute` 签名未变。升级后跑 `server-mock` + flow/kb mock 路由回归，确认 `originalMethod` 链行为与 mock 短路仍正确 | **中** |
| 9 | **`ModuleRegistry` / `SwaggerGenerator` 无 `listen()` 用法** | `kb/src/modules/object-storage/object-storage.module.test.ts`；`kb/scripts/export-ai-kb-apifox-openapi.ts` | 3.1 仍支持「只 `registerModule` 不 listen」扫控制器元数据。升级后：`bun test kb/.../object-storage.module.test.ts` + `bun run kb/scripts/export-ai-kb-apifox-openapi.ts` | **低** |
| 10 | **官方 3.0：`WsArgumentsHost.getClient()` → `IWebSocket<T>`** | 当前 **0 引用**；未来若 flow 加 WS | 按 `docs/zh/migration.md` 改类型；暂无动作 | **低** |
| 11 | **官方 3.0：`getServer()` → `IServerHandle` / `getNativeServer()`** | 当前 **0 引用** | 暂无动作 | **低** |
| 12 | **3.1 新增 `exports["."].node` 与 `engines.node >=22`** | 仅当用 Node 跑测试/CI | 本栈锚点 Bun ≥1.3.12；保持 Bun 运行时即可。若 Node 跑 vitest，装 optional peer `@vscode/sqlite3`、`ws` | **低** |
| 13 | **3.1 捆绑 `mysql2@^3.21` vs flow 间接版本** | bootstrap MySQL + flow mysql-repositories | `bun pm ls mysql2` 确认 dedupe；避免与 engine `mysql2@^3.11` 跨 major 行为差（本仓统一 catalog 时一并钉版本） | **中** |
| 14 | **`ExceptionFilterRegistry` 全局 filter** | `bootstrap/src/main.ts`；`server-base/src/error/unified-error.filter.ts` | API 未变；注册时机仍在 `Application` 构造后、`listen` 前。与 engine `bootstrap.ts` 一致 | **低** |
| 15 | **中间件工厂 `app.use(create*Middleware)`** | `bootstrap/src/main.ts`（cors/logging/auth）；`server-base` 三 middleware；`flow/src/single.ts` | 3.1 `Middleware`/`Context`/`NextFunction` 未变。注意顺序：`registerModule` 后再挂 auth/project（与现 bootstrap 一致）；勿在 3.1 假设中间件可早于模块 | **低** |
| 16 | **`ConfigModule` / `LoggerModule` / `SwaggerModule`** | `bootstrap/src/app.module.ts` | API 未变；`LoggerModule.forRoot` 与 `LOGGER_TOKEN` 注入 kb repository 耦合——见 #5 | **低** |
| 17 | **`SERVICE_REGISTRY_TOKEN` noop** | `bootstrap/src/noop-service-registry.module.ts` | 3.1 接口未变；生产若接 Nacos 再换真 `ServiceRegistryModule` | **低** |
| 18 | **DI 装饰器面（`@Module/@Controller/@Injectable/@Inject`）** | flow ≈40 文件、kb ≈60 文件 import bun-server | 与 engine 相同用法；3.1 新增 `ExistingProvider` 类型 export，无 break。`flow/src/flow.module.ts` 顶层 `await loadAppConfig()` 保持 ESM 即可 | **低** |
| 19 | **engine 已用、flow/kb 未用的 3.x 能力（非 break）** | engine：`contextStore`（`session.controller.ts` 等）；flow/kb 用 `@cube-ai/server-shared` 自建 ALS | 非升级阻塞；M2 host 统一租户/项目上下文时再评估是否切 `contextStore` | **低** |
| 20 | **peer `@cube-ai/bun-server-ext-*` 仅 engine** | engine `assembler/engine-assembler.ts` | flow/kb 不依赖 ext 包；**无** 2.3→3.1 适配项。M2 引 SSE drain/outbox 时再按 engine 复制 | **低** |

### 按模块汇总

- **flow-core**（源：`server/flow`，≈40 处 `@dangao/bun-server`）：核心是 `Application` + `@Module`/`@Controller`/`@Injectable` + `HttpException` + Swagger 装饰器；**数据库与 3.1 的耦合点在 `db/shared-repositories.ts` 手动 `DatabaseService`**（#4），而非 controller 层。SSE 路径见 #7。Auth/project 中间件在 `single.ts` 与 `server-base` 重复装配——升级后优先跑 `dev:single` + flow 全量 `bun test`。
- **kb-core**（源：`server/kb`，≈60 处）：**ORM 栈是最高风险**——4 entity + 4 `BaseRepository` 子类依赖 `DATABASE_SERVICE_TOKEN` + `LOGGER_TOKEN`（#5、#6）；向量/Qdrant/ingestion 仅用 `@Injectable`/`@Inject(APP_CONFIG_TOKEN)`，与 3.1 无特殊 break。OpenAPI 导出脚本依赖 `SwaggerGenerator`（#9）。
- **server-base / server-shared / server-mock**（若迁入 host/infra）：`server-base` 4 文件——`Context`/`Middleware`/`HttpException`/`ExceptionFilter` 类型面稳定；`server-shared` **零** bun-server 依赖（ALS 独立）；`server-mock` 依赖 `BaseInterceptor` + `INTERCEPTOR_REGISTRY_TOKEN`（#8）。bootstrap 组合根 `app.module.ts` + `main.ts` 是 **G2 验收主路径**（`DatabaseModule`/`LoggerModule`/`SwaggerModule`/noop registry）。

### 验证命令

源仓（catalog 改 `^3.1` 后，在 `redesign/cube-ai`）：

```bash
cd /Users/dg/work-dg/cube-ai/redesign/cube-ai
# 1) 依赖解析
bun install && bun pm ls @dangao/bun-server

# 2) 编译
bun run --cwd server/flow build
bun run --cwd server/kb build
bun run --cwd server/server-base build
bun run --cwd server/bootstrap build

# 3) 离线单测（覆盖 ORM / mock / DI 注册）
bun run --cwd server/flow test
bun run --cwd server/kb test
bun run --cwd server/server-base test

# 4) 组合根 smoke（MySQL 或 CUBE_LOCAL_DEV=1 SQLite）
bun run --cwd server/bootstrap dev
# 另开：flow-only / kb export
bun run --cwd server/flow dev:single
bun run --cwd server/kb/scripts/export-ai-kb-apifox-openapi.ts
```

本仓 monorepo（M2/M4 迁入后，catalog 已为 `^3.1`）：

```bash
cd /Users/dg/work-ghy/cube-ai-project
bun install
bun run typecheck
bun run test:offline   # M0.T7 就绪后
# 针对迁入包
bun run --filter @cube-ai/flow-core typecheck
bun run --filter @cube-ai/kb-core typecheck
```

**Exit 信号**：上述命令绿 + bootstrap `/health` 200 + kb `POST /documents`（bootstrap 模式）+ flow `GET /flows`（带 auth）+ mock 路由可切换。
