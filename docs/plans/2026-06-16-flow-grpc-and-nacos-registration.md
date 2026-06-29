# Flow 对外 gRPC 服务面 + Nacos 服务注册 重建 — Implementation Plan

> **For agentic workers:** 按 task 顺序逐个实现。每个 task 自带「从 ghcloud 旧仓 copy 哪个文件 + 在新仓改哪几处 + 测试 + 提交」。Steps 用 checkbox（`- [ ]`）跟踪。**优先 copy 旧仓文件再改**，减少重复（用户要求）。

**Goal:** 在 `apps/ai-center` 重建平台内兄弟后端经 gRPC 调用 flow（`RunFlow`/`RunFlowStream`/`UploadFlowImage`）的入站服务面，并重建 Nacos 服务注册（广播 `grpc_server_port` 供服务发现）。

**Architecture:** gRPC 面落在组合根 host（ADR-0028）：proto stub copy 进 `platform-adapter-ghcloud/src/grpc-gen`，service impl + http2 server 放 `apps/ai-center/src/grpc/`，调 flow-core 的 `FlowsService.run/runStream` + `FlowFilesService.uploadFlowFile`，入站鉴权复用 `platform-adapter-ghcloud` 的 `runWithConnectHandlerSession`/`streamWithConnectHandlerSession`/`validateConnectInnerInvoke`。Nacos 注册生命周期服务放 `infra/bun-server-ext/nacos/`，由 `AiCenterAssembler` 接 `ServiceRegistryModule.forRoot` 并广播 `grpc_server_port`。

**Tech Stack:** Bun + `@dangao/bun-server`（DI/Module/lifecycle/ServiceRegistry）、`@connectrpc/connect` + `@connectrpc/connect-node`（connectNodeAdapter / http2）、`@bufbuild/protobuf`、`node:http2`。

**关键事实（实现时遵循）:**

- flow-core 门面 `FlowsService.run(id, body)`（同步，返回含 `.raw` 的对象）、`FlowsService.runStream(id, body)`（返回 SSE `Response`）；`FlowFilesService.uploadFlowFile(flowRef, file)`（返回 langflow 上传原始 JSON，类型 `unknown`）。三者均由 `FlowModule` provide+export，可从容器 `resolve`。
- **不能走 `FlowInvokerPort`**：它 sync-only、无 stream/upload。
- 旧仓可 copy 的源文件：
  - stub：`/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-application-grpc-gen/src/gen/guhecloud/cube/base/ai_application/flow/grpc/v1/{flow_service_pb.ts,flow_service_connect.ts,flow_types_pb.ts}`
  - impl + test：`/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-application/src/grpc/{flow-grpc.service.ts,flow-grpc.service.test.ts}`
  - server + test：`/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-server/src/grpc/{flow-grpc-server.ts,flow-grpc-server.test.ts}`
  - nacos 注册：`/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-server-base/src/services/nacos.service.ts`
  - nacos 注册装配（sync config resolve）：`/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-server/src/app.module.ts`
- 这些旧仓的 stub 用 `import_extension=none`（无 `.js` 后缀），与新仓 catalog 的 `@bufbuild/protobuf` ^2.12 兼容。

---

## File Structure

**Create:**

- `packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1/flow_service_pb.ts`
- `packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1/flow_service_connect.ts`
- `packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1/flow_types_pb.ts`
- `apps/ai-center/src/grpc/flow-grpc.service.ts` + `.test.ts`
- `apps/ai-center/src/grpc/flow-grpc-server.ts` + `.test.ts`
- `apps/ai-center/src/grpc/flow-grpc-backend.ts`（把 flow-core 具体服务适配成 backend 形状）
- `infra/bun-server-ext/nacos/src/service-registration.service.ts` + `.test.ts`
- `apps/ai-center/src/nacos/nacos-registration.wiring.ts`（sync 解析 + ServiceRegistryModule 配置 + 注册 options）

**Modify:**

- `packages/platform-adapters/ghcloud/src/index.ts`（re-export flow gRPC stubs）
- `apps/ai-center/src/platform/server-base/src/config/app.config.ts`（加 `grpcPort`/`registerGrpcPort`/`internalInvokeSecretKey`）
- `apps/ai-center/src/bootstrap.ts`（listen 后起 gRPC server + graceful close）
- `apps/ai-center/src/assembler/ai-center-assembler.ts`（接 `ServiceRegistryModule.forRoot` + 注册服务）
- `infra/bun-server-ext/nacos/src/index.ts`（导出注册服务）

---

## Task 1: Copy & re-export flow gRPC proto stubs

**Files:**

- Create: `packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1/flow_service_pb.ts`
- Create: `packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1/flow_service_connect.ts`
- Create: `packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1/flow_types_pb.ts`
- Modify: `packages/platform-adapters/ghcloud/src/index.ts`
- Test: `packages/platform-adapters/ghcloud/src/grpc-gen-flow.test.ts`

- [ ] **Step 1: Copy the 3 generated stubs verbatim**

```bash
DEST=packages/platform-adapters/ghcloud/src/grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1
SRC=/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-application-grpc-gen/src/gen/guhecloud/cube/base/ai_application/flow/grpc/v1
mkdir -p "$DEST"
cp "$SRC/flow_service_pb.ts" "$DEST/flow_service_pb.ts"
cp "$SRC/flow_service_connect.ts" "$DEST/flow_service_connect.ts"
cp "$SRC/flow_types_pb.ts" "$DEST/flow_types_pb.ts"
```

Do not edit the copied files — they are codegen output with `import_extension=none`, valid as-is.

- [ ] **Step 2: Re-export the stubs from the ghcloud adapter index**

Add to the end of `packages/platform-adapters/ghcloud/src/index.ts`:

```ts
export { FlowServiceGrpc } from "./grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1/flow_service_connect";
export {
  RunFlowRequestSchema,
  RunFlowResponseSchema,
  RunFlowStreamEventSchema,
  UploadFlowImageRequestSchema,
  UploadFlowImageResponseSchema,
  type RunFlowRequest,
  type RunFlowResponse,
  type RunFlowStreamEvent,
  type UploadFlowImageRequest,
  type UploadFlowImageResponse,
} from "./grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1/flow_service_pb";
export { FlowInputImageRefSchema, type FlowInputImageRef } from "./grpc-gen/guhecloud/cube/base/ai_application/flow/grpc/v1/flow_types_pb";
```

> Before writing, open the 3 copied files and confirm the exact exported symbol names (the `*Schema` consts and message types). `bufbuild/es` v2 emits `XxxSchema` message-descriptor consts and `Xxx` types. Adjust the names above to match what's actually exported (e.g. some files may also export `FlowImageUploadPartSchema`). Export every message schema/type the impl in Task 2 references.

- [ ] **Step 3: Write a smoke test for the re-exports**

`packages/platform-adapters/ghcloud/src/grpc-gen-flow.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { create } from "@bufbuild/protobuf";
import { FlowServiceGrpc, RunFlowRequestSchema, UploadFlowImageResponseSchema } from "./index";

describe("flow gRPC stubs re-export", () => {
  test("FlowServiceGrpc exposes the 3 methods", () => {
    expect(FlowServiceGrpc.method.runFlow).toBeDefined();
    expect(FlowServiceGrpc.method.runFlowStream).toBeDefined();
    expect(FlowServiceGrpc.method.uploadFlowImage).toBeDefined();
  });

  test("schemas construct messages", () => {
    const req = create(RunFlowRequestSchema, { flowId: "1" });
    expect(req.flowId).toBe("1");
    const resp = create(UploadFlowImageResponseSchema, {});
    expect(resp).toBeDefined();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `bun test packages/platform-adapters/ghcloud/src/grpc-gen-flow.test.ts`
Expected: PASS (3 methods defined, schemas construct).

- [ ] **Step 5: Commit**

```bash
git add packages/platform-adapters/ghcloud/src/grpc-gen packages/platform-adapters/ghcloud/src/index.ts packages/platform-adapters/ghcloud/src/grpc-gen-flow.test.ts
git commit -m "feat(ghcloud): copy flow gRPC proto stubs + re-export (ADR-0028)"
```

---

## Task 2: Flow gRPC service impl (proto ↔ flow-core)

**Files:**

- Create: `apps/ai-center/src/grpc/flow-grpc-backend.ts`
- Create: `apps/ai-center/src/grpc/flow-grpc.service.ts`
- Test: `apps/ai-center/src/grpc/flow-grpc.service.test.ts`

- [ ] **Step 1: Define the backend adapter shape**

`apps/ai-center/src/grpc/flow-grpc-backend.ts`:

```ts
export interface FlowUploadResultLike {
  flowId?: string;
  id?: string;
  name?: string;
  file_path?: string;
  filePath?: string;
  path?: string;
  url?: string;
  mime?: string;
  ext?: Record<string, unknown>;
  raw?: unknown;
}

export interface FlowRunBody {
  input?: string | { query: string; files: Record<string, unknown>[] };
  variables?: Record<string, string>;
}

/** gRPC 面消费 flow-core 的最小后端契约（避免直接耦合具体 Service 类型）。 */
export interface FlowGrpcBackend {
  uploadFlowFile(flowId: string, file: File): Promise<FlowUploadResultLike>;
  runFlow(flowId: string, body: FlowRunBody): Promise<{ raw?: Record<string, unknown> }>;
  runFlowStream(flowId: string, body: FlowRunBody): Promise<Response>;
}
```

- [ ] **Step 2: Copy the old impl and adapt imports/types**

Copy `/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-application/src/grpc/flow-grpc.service.ts` → `apps/ai-center/src/grpc/flow-grpc.service.ts`, then apply these edits:

1. Replace the import block header:

```ts
import { Code, ConnectError, type HandlerContext, type ServiceImpl } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import {
  FlowServiceGrpc as FlowServiceGrpcDesc,
  type FlowInputImageRef,
  type RunFlowRequest,
  type RunFlowResponse,
  type RunFlowStreamEvent,
  RunFlowResponseSchema,
  RunFlowStreamEventSchema,
  type UploadFlowImageRequest,
  type UploadFlowImageResponse,
  UploadFlowImageResponseSchema,
} from "@cube-ai/platform-adapter-ghcloud";
import { runWithConnectHandlerSession, streamWithConnectHandlerSession } from "@cube-ai/platform-adapter-ghcloud";
import type { FlowGrpcBackend, FlowRunBody } from "./flow-grpc-backend";
```

2. Change the function param type from `Pick<FlowService, 'uploadFlowFile' | 'runFlow' | 'runFlowStream'>` to `FlowGrpcBackend`:

```ts
export function createFlowGrpcServiceImpl(
  flowService: FlowGrpcBackend,
  options: FlowGrpcServiceImplOptions = {},
): Partial<ServiceImpl<typeof FlowServiceGrpcDesc>> {
```

3. In `uploadedImageResponse`, change its 2nd param type to `FlowUploadResultLike`:

```ts
import type { FlowGrpcBackend, FlowRunBody, FlowUploadResultLike } from './flow-grpc-backend'
// ...
function uploadedImageResponse(flowId: string, raw: FlowUploadResultLike): UploadFlowImageResponse {
```

Keep everything else (`toExecutionFileRef`, `toFlowRunBody`, `parseSseEvents`, the 3 handlers, `logFlowGrpcFailure`, `stringifyOrEmpty`) **verbatim** — they are transport logic and stay identical.

- [ ] **Step 3: Copy & adapt the impl test**

Copy `/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-application/src/grpc/flow-grpc.service.test.ts` → `apps/ai-center/src/grpc/flow-grpc.service.test.ts`, then:

1. Replace imports:

```ts
import { describe, expect, mock, test } from "bun:test";
import { createHandlerContext } from "@connectrpc/connect";
import { FlowServiceGrpc } from "@cube-ai/platform-adapter-ghcloud";
import { ReadableStream } from "node:stream/web";
import type { FlowRunBody } from "./flow-grpc-backend";
import { createFlowGrpcServiceImpl } from "./flow-grpc.service";
```

The rest of the test body stays identical (it already drives `createFlowGrpcServiceImpl` with a mocked 3-method backend and asserts `sessionId`/`outputsJson`/`rawJson`, image-ref mapping, and SSE→stream conversion).

- [ ] **Step 4: Run the test**

Run: `bun test apps/ai-center/src/grpc/flow-grpc.service.test.ts`
Expected: PASS (4 tests: runFlow mapping, uploadFlowImage delegation, image-ref→files, SSE→grpc stream).

- [ ] **Step 5: Commit**

```bash
git add apps/ai-center/src/grpc/flow-grpc-backend.ts apps/ai-center/src/grpc/flow-grpc.service.ts apps/ai-center/src/grpc/flow-grpc.service.test.ts
git commit -m "feat(ai-center): flow gRPC service impl mapping proto to flow-core (ADR-0028)"
```

---

## Task 3: Flow gRPC server bootstrap (http2 + connectNodeAdapter)

**Files:**

- Create: `apps/ai-center/src/grpc/flow-grpc-server.ts`
- Test: `apps/ai-center/src/grpc/flow-grpc-server.test.ts`

- [ ] **Step 1: Copy the old server and adapt imports + backend type**

Copy `/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-server/src/grpc/flow-grpc-server.ts` → `apps/ai-center/src/grpc/flow-grpc-server.ts`, then replace the imports and the `flowService` option type:

```ts
import * as http2 from "node:http2";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { FlowServiceGrpc } from "@cube-ai/platform-adapter-ghcloud";
import { createFlowGrpcServiceImpl } from "./flow-grpc.service";
import type { FlowGrpcBackend } from "./flow-grpc-backend";

export interface StartFlowGrpcServerOptions {
  port: number;
  hostname?: string;
  flowService: FlowGrpcBackend;
  internalInvokeSecretKey?: string | null;
}
```

Keep the rest (`StartedFlowGrpcServer`, `startFlowGrpcServer` body with `connectNodeAdapter` + `http2.createServer` + listen/close) **verbatim**.

- [ ] **Step 2: Copy & adapt the server test**

Copy `/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-server/src/grpc/flow-grpc-server.test.ts` → `apps/ai-center/src/grpc/flow-grpc-server.test.ts`, then replace the import line:

```ts
import { FlowServiceGrpc, RunFlowRequestSchema, UploadFlowImageRequestSchema } from "@cube-ai/platform-adapter-ghcloud";
import { startFlowGrpcServer } from "./flow-grpc-server";
```

The rest (boots server on `port: 0`, in-process fake backend, real `createGrpcTransport` client, asserts upload/runFlow/runFlowStream) stays identical.

- [ ] **Step 3: Run the test**

Run: `bun test apps/ai-center/src/grpc/flow-grpc-server.test.ts`
Expected: PASS (serves unary + server-streaming over a real loopback gRPC transport).

- [ ] **Step 4: Commit**

```bash
git add apps/ai-center/src/grpc/flow-grpc-server.ts apps/ai-center/src/grpc/flow-grpc-server.test.ts
git commit -m "feat(ai-center): flow gRPC http2 server bootstrap (ADR-0028)"
```

---

## Task 4: Config — grpcPort / registerGrpcPort / internalInvokeSecretKey

**Files:**

- Modify: `apps/ai-center/src/platform/server-base/src/config/app.config.ts`
- Test: `apps/ai-center/src/platform/server-base/src/config/app.config.test.ts`

- [ ] **Step 1: Extend `AppConfig` and `AppConfigFile` interfaces**

In `app.config.ts`, add to `interface AppConfig` (after `port: number`):

```ts
  /** 对外 gRPC 服务面监听端口（平台服务间调用，ADR-0028）。 */
  grpcPort: number
  /** 注册到 Nacos 时广播的 gRPC 端口；未配置回退到 grpcPort。 */
  registerGrpcPort: number
  /** Feign 内部调用签名校验密钥；为空则跳过 feign_inner_invoke 校验。 */
  internalInvokeSecretKey?: string
```

Add to `interface AppConfigFile`:

```ts
  grpcPort?: number
  registerGrpcPort?: number
  internalInvokeSecretKey?: string
```

- [ ] **Step 2: Parse them in `_resolveAppConfig` and add to the returned object**

Before the final `return {` in `_resolveAppConfig`, add:

```ts
const grpcPortStr =
  getCliArg("grpc-port") ??
  (fileConfig.grpcPort !== undefined ? String(fileConfig.grpcPort) : null) ??
  process.env.AI_CENTER_GRPC_PORT?.trim() ??
  process.env.AGENTIC_ENGINE_GRPC_PORT?.trim() ??
  "3110";
const grpcPort = (() => {
  const parsed = parseInt(grpcPortStr, 10);
  return Number.isFinite(parsed) ? parsed : 3110;
})();
const registerGrpcPortStr =
  getCliArg("register-grpc-port") ??
  (fileConfig.registerGrpcPort !== undefined ? String(fileConfig.registerGrpcPort) : null) ??
  process.env.AI_CENTER_REGISTER_GRPC_PORT?.trim() ??
  null;
const registerGrpcPort = (() => {
  const parsed = registerGrpcPortStr !== null ? parseInt(registerGrpcPortStr, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : grpcPort;
})();
const internalInvokeSecretKey =
  getCliArg("internal-invoke-secret-key") ??
  fileConfig.internalInvokeSecretKey ??
  process.env.CUBE_INTERNAL_INVOKE_SECRET_KEY?.trim() ??
  process.env.INTERNAL_INVOKE_SECRET_KEY?.trim() ??
  undefined;
```

Add to the returned object literal (after `port: parseInt(portStr, 10),`):

```ts
    grpcPort,
    registerGrpcPort,
    internalInvokeSecretKey,
```

- [ ] **Step 3: Write the failing test**

Append to `app.config.test.ts` a new test (mirror the existing env/reset pattern in that file — use `_resetAppConfigCache()` and set env before `loadAppConfig()`):

```ts
test("grpcPort defaults to 3110 and registerGrpcPort falls back to grpcPort", async () => {
  _resetAppConfigCache();
  delete process.env.AI_CENTER_GRPC_PORT;
  delete process.env.AI_CENTER_REGISTER_GRPC_PORT;
  const cfg = await loadAppConfig();
  expect(cfg.grpcPort).toBe(3110);
  expect(cfg.registerGrpcPort).toBe(3110);
});

test("AI_CENTER_GRPC_PORT overrides and registerGrpcPort can split", async () => {
  _resetAppConfigCache();
  process.env.AI_CENTER_GRPC_PORT = "3211";
  process.env.AI_CENTER_REGISTER_GRPC_PORT = "3110";
  const cfg = await loadAppConfig();
  expect(cfg.grpcPort).toBe(3211);
  expect(cfg.registerGrpcPort).toBe(3110);
  _resetAppConfigCache();
  delete process.env.AI_CENTER_GRPC_PORT;
  delete process.env.AI_CENTER_REGISTER_GRPC_PORT;
});
```

> Confirm `_resetAppConfigCache` and `loadAppConfig` are imported at the top of the test file; add to the existing import if missing.

- [ ] **Step 4: Run the test**

Run: `bun test apps/ai-center/src/platform/server-base/src/config/app.config.test.ts`
Expected: PASS (defaults 3110; env override + split).

- [ ] **Step 5: Commit**

```bash
git add apps/ai-center/src/platform/server-base/src/config/app.config.ts apps/ai-center/src/platform/server-base/src/config/app.config.test.ts
git commit -m "feat(ai-center): add grpcPort/registerGrpcPort/internalInvokeSecretKey config (ADR-0028)"
```

---

## Task 5: Wire gRPC server into bootstrap

**Files:**

- Modify: `apps/ai-center/src/bootstrap.ts`
- Test: (covered by Task 3 server test + manual boot smoke; no new unit test)

- [ ] **Step 1: Import the server + flow services at the top of `bootstrap.ts`**

Add to imports:

```ts
import { FlowsService, FlowFilesService } from "@cube-ai/flow-core";
import { startFlowGrpcServer, type StartedFlowGrpcServer } from "./grpc/flow-grpc-server";
import type { FlowGrpcBackend } from "./grpc/flow-grpc-backend";
```

- [ ] **Step 2: Start the gRPC server after `await app.listen(...)`**

In `bootstrap()`, replace the tail `await app.listen(port, hostname); return app;` with:

```ts
await app.listen(port, hostname);

const flows = container.resolve(FlowsService) as FlowsService;
const flowFiles = container.resolve(FlowFilesService) as FlowFilesService;
const grpcBackend: FlowGrpcBackend = {
  uploadFlowFile: (flowId, file) =>
    flowFiles.uploadFlowFile(flowId, file) as Promise<Awaited<ReturnType<FlowGrpcBackend["uploadFlowFile"]>>>,
  runFlow: (flowId, body) => flows.run(flowId, body) as Promise<{ raw?: Record<string, unknown> }>,
  runFlowStream: (flowId, body) => flows.runStream(flowId, body),
};

const grpcPort = Number(Bun.env.AI_CENTER_GRPC_PORT ?? process.env.AI_CENTER_GRPC_PORT ?? flowConfig.grpcPort ?? 3110);
const grpcServer: StartedFlowGrpcServer = await startFlowGrpcServer({
  port: grpcPort,
  hostname,
  flowService: grpcBackend,
  internalInvokeSecretKey: flowConfig.internalInvokeSecretKey,
});
process.stdout.write(JSON.stringify({ msg: "ai-center.grpc.listening", port: grpcServer.port, hostname }) + "\n");
(app as unknown as { __grpcServer?: StartedFlowGrpcServer }).__grpcServer = grpcServer;

return app;
```

> `flowConfig` is already in scope (the existing `const flowConfig = await loadAppConfig()`). If `flowConfig` is declared after this point, move the gRPC block below it.

- [ ] **Step 3: Close the gRPC server on graceful shutdown**

Find where `GracefulShutdownService` / lifecycle hooks are registered (`registerLifecycleHooks(app)`). Register a close hook for the gRPC server. Add right after `registerLifecycleHooks(app);`:

```ts
const graceful = container.resolve(GracefulShutdownService) as GracefulShutdownService;
graceful.onShutdown?.(async () => {
  const srv = (app as unknown as { __grpcServer?: StartedFlowGrpcServer }).__grpcServer;
  if (srv) await srv.close();
});
```

> Open `packages/agent/engine/src/infra/lifecycle/graceful-shutdown.service.ts` and confirm the actual hook-registration method name (`onShutdown` / `register` / `addHook`). Use the real method; if none exists, instead store `grpcServer` and close it inside the existing shutdown path. Do not invent an API — match the file.

- [ ] **Step 4: Smoke-boot**

Run: `AI_CENTER_GRPC_PORT=0 USE_GHCLOUD_IDENTITY=0 bun run --filter @cube-ai/ai-center dev` (or the app's start script), watch stdout.
Expected: a line `{"msg":"ai-center.grpc.listening",...}` after `ai-center.listening`. Ctrl-C → clean exit (no dangling http2 handle).

- [ ] **Step 5: Commit**

```bash
git add apps/ai-center/src/bootstrap.ts
git commit -m "feat(ai-center): start flow gRPC server in bootstrap + graceful close (ADR-0028)"
```

---

## Task 6: Nacos service-registration lifecycle service

**Files:**

- Create: `infra/bun-server-ext/nacos/src/service-registration.service.ts`
- Modify: `infra/bun-server-ext/nacos/src/index.ts`
- Test: `infra/bun-server-ext/nacos/src/service-registration.service.test.ts`

- [ ] **Step 1: Create the options token + registration service (port from old `nacos.service.ts`)**

`infra/bun-server-ext/nacos/src/service-registration.service.ts`:

```ts
import {
  Inject,
  Injectable,
  SERVICE_REGISTRY_TOKEN,
  type OnModuleDestroy,
  type OnModuleInit,
  type ServiceInstance,
  type ServiceRegistry,
} from "@dangao/bun-server";

export const NACOS_REGISTRATION_OPTIONS_TOKEN = Symbol.for("@cube-ai/bun-server-ext-nacos:RegistrationOptions");

export interface NacosRegistrationOptions {
  serviceName: string;
  ip: string;
  port: number;
  grpcPort: number;
  version?: string;
  heartbeatIntervalMs?: number;
  refreshTtlMs?: number;
}

/** 入站 Nacos 服务注册：register + 心跳 + 定期重注册 + deregister（ADR-0028）。 */
@Injectable()
export class NacosServiceRegistrationService implements OnModuleInit, OnModuleDestroy {
  private connected = false;
  private instance: ServiceInstance | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatInFlight = false;
  private refreshInFlight = false;

  constructor(
    @Inject(SERVICE_REGISTRY_TOKEN) private readonly serviceRegistry: ServiceRegistry,
    @Inject(NACOS_REGISTRATION_OPTIONS_TOKEN) private readonly options: NacosRegistrationOptions,
  ) {}

  private buildInstance(): ServiceInstance {
    return {
      serviceName: this.options.serviceName,
      ip: this.options.ip,
      port: this.options.port,
      weight: 1,
      healthy: true,
      enabled: true,
      metadata: {
        version: this.options.version ?? "0.0.1",
        grpc_server_port: String(this.options.grpcPort),
      },
    };
  }

  async onModuleInit(): Promise<void> {
    this.instance = this.buildInstance();
    console.info(
      `[NacosRegistration] registering service=${this.instance.serviceName} ip=${this.instance.ip} port=${this.instance.port} grpc=${this.options.grpcPort}`,
    );
    try {
      await this.serviceRegistry.register(this.instance);
      this.connected = true;
      this.startHeartbeat();
      this.startRefresh();
    } catch (error) {
      console.warn("[NacosRegistration] Nacos unreachable, skipping registration (peer discovery limited).", error);
      this.connected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.stopHeartbeat();
    this.stopRefresh();
    if (this.instance && this.connected) {
      try {
        await this.serviceRegistry.deregister(this.instance);
      } catch (error) {
        console.warn("[NacosRegistration] deregister failed", error);
      }
    }
    try {
      await this.serviceRegistry.close();
    } catch (error) {
      console.warn("[NacosRegistration] registry close failed", error);
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    const ms = this.options.heartbeatIntervalMs ?? 5000;
    this.heartbeatTimer = setInterval(() => void this.sendHeartbeat(), ms);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer != null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private startRefresh(): void {
    const ms = this.options.refreshTtlMs ?? 30000;
    if (ms <= 0) return;
    this.stopRefresh();
    this.refreshTimer = setInterval(() => void this.refreshRegistration(), ms);
  }

  private stopRefresh(): void {
    if (this.refreshTimer != null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    if (!this.instance || this.heartbeatInFlight) return;
    this.heartbeatInFlight = true;
    try {
      await this.serviceRegistry.renew(this.instance);
      this.connected = true;
    } catch (error) {
      console.error("[NacosRegistration] heartbeat failed, re-registering", error);
      try {
        await this.serviceRegistry.register(this.instance);
        this.connected = true;
      } catch (registerError) {
        console.error("[NacosRegistration] re-register failed", registerError);
        this.connected = false;
      }
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private async refreshRegistration(): Promise<void> {
    if (!this.instance || this.refreshInFlight) return;
    this.refreshInFlight = true;
    try {
      await this.serviceRegistry.register(this.instance);
      this.connected = true;
    } catch (error) {
      console.error("[NacosRegistration] periodic re-register failed", error);
      this.connected = false;
    } finally {
      this.refreshInFlight = false;
    }
  }
}
```

> Open the old `/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-server-base/src/services/nacos.service.ts` and confirm the `ServiceRegistry` method names (`register` / `renew` / `deregister` / `close`) match what `@dangao/bun-server` ^3.3.0 exports. Adjust if the interface differs.

- [ ] **Step 2: Export from the nacos ext index**

Add to `infra/bun-server-ext/nacos/src/index.ts`:

```ts
export {
  NacosServiceRegistrationService,
  NACOS_REGISTRATION_OPTIONS_TOKEN,
  type NacosRegistrationOptions,
} from "./service-registration.service";
```

- [ ] **Step 3: Write the failing test (fake registry)**

`infra/bun-server-ext/nacos/src/service-registration.service.test.ts`:

```ts
import { describe, expect, mock, test } from "bun:test";
import type { ServiceInstance, ServiceRegistry } from "@dangao/bun-server";
import { NacosServiceRegistrationService, type NacosRegistrationOptions } from "./service-registration.service";

function fakeRegistry() {
  const calls = { register: [] as ServiceInstance[], deregister: 0, close: 0 };
  const registry: ServiceRegistry = {
    register: mock(async (i: ServiceInstance) => {
      calls.register.push(i);
    }),
    deregister: mock(async () => {
      calls.deregister += 1;
    }),
    renew: mock(async () => {}),
    close: mock(async () => {
      calls.close += 1;
    }),
  } as unknown as ServiceRegistry;
  return { registry, calls };
}

const opts: NacosRegistrationOptions = {
  serviceName: "aiCenter",
  ip: "127.0.0.1",
  port: 3210,
  grpcPort: 3110,
  refreshTtlMs: 0, // disable periodic refresh timer in tests
};

describe("NacosServiceRegistrationService", () => {
  test("registers with grpc_server_port metadata on init", async () => {
    const { registry, calls } = fakeRegistry();
    const svc = new NacosServiceRegistrationService(registry, opts);
    await svc.onModuleInit();
    expect(calls.register.length).toBe(1);
    expect(calls.register[0]?.metadata?.grpc_server_port).toBe("3110");
    expect(svc.isConnected()).toBe(true);
    await svc.onModuleDestroy();
    expect(calls.deregister).toBe(1);
    expect(calls.close).toBe(1);
  });

  test("survives registry failure (connected=false, no throw)", async () => {
    const registry = {
      register: mock(async () => {
        throw new Error("nacos down");
      }),
      deregister: mock(async () => {}),
      renew: mock(async () => {}),
      close: mock(async () => {}),
    } as unknown as ServiceRegistry;
    const svc = new NacosServiceRegistrationService(registry, opts);
    await svc.onModuleInit();
    expect(svc.isConnected()).toBe(false);
    await svc.onModuleDestroy();
  });
});
```

- [ ] **Step 4: Run the test**

Run: `bun test infra/bun-server-ext/nacos/src/service-registration.service.test.ts`
Expected: PASS (registers with `grpc_server_port=3110` metadata + deregister/close on destroy; failure path is non-throwing).

- [ ] **Step 5: Commit**

```bash
git add infra/bun-server-ext/nacos/src/service-registration.service.ts infra/bun-server-ext/nacos/src/service-registration.service.test.ts infra/bun-server-ext/nacos/src/index.ts
git commit -m "feat(nacos-ext): inbound service registration broadcasting grpc_server_port (ADR-0028)"
```

---

## Task 7: Wire ServiceRegistryModule + registration into the assembler

**Files:**

- Create: `apps/ai-center/src/nacos/nacos-registration.wiring.ts`
- Modify: `apps/ai-center/src/assembler/ai-center-assembler.ts`
- Test: `apps/ai-center/src/assembler/ai-center-assembler.test.ts` (extend existing or new)

- [ ] **Step 1: Copy the sync Nacos config resolver from the old app.module**

Create `apps/ai-center/src/nacos/nacos-registration.wiring.ts`. Copy the helper functions `normalizeNacosServerAddr`, `getCliArg`, `searchConfigUpwardSync`, `getEntryScriptDir`, `resolveDefaultConfigPathSync`, `loadConfigFileSync`, `resolveNacosConfig` **verbatim** from `/Users/dg/work-ghy/ghcloud/prod/cube-services/ai-server/src/app.module.ts` (lines 14–110), then add the wiring exports:

```ts
import { ServiceRegistryModule, type AppConfigFile } from "@dangao/bun-server";
import {
  NACOS_REGISTRATION_OPTIONS_TOKEN,
  NacosServiceRegistrationService,
  type NacosRegistrationOptions,
} from "@cube-ai/bun-server-ext-nacos";

// ... (copied helpers: normalizeNacosServerAddr / getCliArg / loadConfigFileSync / resolveNacosConfig) ...

const nacosConfig = resolveNacosConfig();
const nacosServerAddr = normalizeNacosServerAddr(nacosConfig.nacosServerAddr);

function readPortSync(envKey: string, fallback: number): number {
  const raw = getCliArg(envKey.toLowerCase().replace(/_/g, "-")) ?? process.env[envKey];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveRegistrationOptions(): NacosRegistrationOptions {
  const fileConfig = loadConfigFileSync() as AppConfigFile & {
    grpcPort?: number;
    registerGrpcPort?: number;
    registerHostname?: string;
    registerPort?: number;
  };
  const serviceName = getCliArg("app-name") ?? process.env.APP_NAME ?? fileConfig.name ?? "aiCenter";
  const port = readPortSync("AI_CENTER_PORT", Number(fileConfig.port ?? 3210));
  const grpcPort = readPortSync(
    "AI_CENTER_REGISTER_GRPC_PORT",
    readPortSync("AI_CENTER_GRPC_PORT", Number(fileConfig.registerGrpcPort ?? fileConfig.grpcPort ?? 3110)),
  );
  const hostname = getCliArg("register-hostname") ?? process.env.AI_CENTER_REGISTER_HOSTNAME ?? fileConfig.hostname ?? "0.0.0.0";
  const ip = hostname === "0.0.0.0" ? "127.0.0.1" : hostname;
  return { serviceName, ip, port, grpcPort };
}

export function buildServiceRegistryModule() {
  return ServiceRegistryModule.forRoot({
    provider: "nacos",
    autoRegister: false,
    nacos: {
      client: {
        serverList: [nacosServerAddr],
        namespaceId: nacosConfig.nacosNamespace || undefined,
        username: nacosConfig.nacosUsername,
        password: nacosConfig.nacosPassword,
      },
      watchInterval: 5000,
      heartbeatInterval: 5000,
    },
  });
}

export const nacosRegistrationProviders = [
  { provide: NACOS_REGISTRATION_OPTIONS_TOKEN, useValue: resolveRegistrationOptions() },
  NacosServiceRegistrationService,
];
```

> Confirm `ServiceRegistryModule.forRoot(...)` signature against `@dangao/bun-server` ^3.3.0 (it matches the old app.module usage). If `forRoot` options shape differs, adjust to match the installed version. Also confirm `ServiceRegistryModule` is exported (Open Question in ADR-0028 — `bun install` first).

- [ ] **Step 2: Register the module + providers in the assembler**

In `apps/ai-center/src/assembler/ai-center-assembler.ts`:

Add import:

```ts
import { buildServiceRegistryModule, nacosRegistrationProviders } from "../nacos/nacos-registration.wiring";
```

Wrap the registration providers + ServiceRegistryModule into a small module and register it. Add this module class near `AiCenterPlatformPortsModule`:

```ts
@Module({
  imports: [buildServiceRegistryModule()],
  providers: nacosRegistrationProviders,
})
export class AiCenterNacosRegistrationModule {}
```

Then in `assemble()`, add `AiCenterNacosRegistrationModule` to the `modules` array (place it right after `NacosExtModule`):

```ts
const modules: ModuleClass[] = [
  NacosExtModule,
  AiCenterNacosRegistrationModule,
  SecretsModule,
  // ... rest unchanged
];
```

- [ ] **Step 3: Extend the assembler test (module assembles + registration provider resolvable)**

Add to (or create) `apps/ai-center/src/assembler/ai-center-assembler.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { NacosServiceRegistrationService } from "@cube-ai/bun-server-ext-nacos";
import { AiCenterAssembler } from "./ai-center-assembler";

describe("AiCenterAssembler nacos registration wiring", () => {
  test("registration service resolves from container", () => {
    const app = new AiCenterAssembler({ port: 0 }).assemble();
    const svc = app.getContainer().resolve(NacosServiceRegistrationService);
    expect(svc).toBeInstanceOf(NacosServiceRegistrationService);
  });
});
```

> If assembling requires a live Nacos/registry transport that throws offline, gate this test behind the repo's env门控 convention (rename to `*.integration.test.ts`) so it auto-skips offline. Check how the existing assembler test handles DI that touches infra; follow that pattern.

- [ ] **Step 4: Run the test**

Run: `bun test apps/ai-center/src/assembler/ai-center-assembler.test.ts`
Expected: PASS (or auto-skip if env-gated).

- [ ] **Step 5: Commit**

```bash
git add apps/ai-center/src/nacos/nacos-registration.wiring.ts apps/ai-center/src/assembler/ai-center-assembler.ts apps/ai-center/src/assembler/ai-center-assembler.test.ts
git commit -m "feat(ai-center): wire Nacos ServiceRegistry + registration into assembler (ADR-0028)"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole workspace**

Run: `bun run typecheck`
Expected: 0 errors. Fix any type mismatch (most likely: stub export names in Task 1, or `FlowsService.run` return type vs `FlowGrpcBackend.runFlow` cast in Task 5).

- [ ] **Step 2: Run the offline test suite**

Run: `bun test`
Expected: all green; `*.integration.test.ts` / `*.testcontainers.test.ts` auto-skip offline. Specifically confirm the 4 new test files pass:

- `packages/platform-adapters/ghcloud/src/grpc-gen-flow.test.ts`
- `apps/ai-center/src/grpc/flow-grpc.service.test.ts`
- `apps/ai-center/src/grpc/flow-grpc-server.test.ts`
- `infra/bun-server-ext/nacos/src/service-registration.service.test.ts`

- [ ] **Step 3: Sanity-check docs alignment**

Confirm ADR-0028 / CONTEXT.md term 「平台服务间调用面 (gRPC)」 / backlog 两条待办仍准确（已在前序提交写入）。Mark the two backlog items done if desired.

- [ ] **Step 4: Final commit (if any fixes were made in Steps 1–2)**

```bash
git add -A
git commit -m "chore(ai-center): typecheck + test fixes for flow gRPC + nacos registration (ADR-0028)"
```

---

## Self-Review Notes

- **Spec coverage:** Task 1–3 = gRPC 面（stub/impl/server）；Task 4–5 = 配置 + bootstrap 接线；Task 6–7 = Nacos 注册（服务 + 装配）；Task 8 = 验证。覆盖 ADR-0028 §1–§5 全部决策。
- **Type consistency:** `FlowGrpcBackend`（`flow-grpc-backend.ts`）= impl 参数（Task 2）= server option（Task 3）= bootstrap 构造（Task 5），三处同名同形。`NacosRegistrationOptions` / `NACOS_REGISTRATION_OPTIONS_TOKEN`（Task 6）= wiring provider（Task 7）一致。
- **风险/待确认（已在 ADR-0028 Open Questions 登记）:** ① `@dangao/bun-server@^3.3.0` 是否导出 `ServiceRegistryModule`/`SERVICE_REGISTRY_TOKEN` + `forRoot` 形状 → `bun install` 后先验证 Task 6/7；② `GracefulShutdownService` 的关闭钩子方法名 → Task 5 Step 3 按实际文件改；③ stub 导出符号名 → Task 1 Step 2 按 copy 后的文件实际导出对齐。

```

```
