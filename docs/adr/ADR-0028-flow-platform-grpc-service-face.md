# ADR-0028: flow 对外 gRPC 服务面（平台服务间）保留并在 host 重建 + Nacos 注册广播 grpc_server_port

- **Status**: Accepted
- **Date**: 2026-06-16
- **Deciders**: 架构组（经 `/grill-with-docs` 收敛）
- **Tags**: flow, grpc, nacos, platform, topology, ghcloud

## Context

旧 `ai-server` 启动时除 HTTP 外，另起一个**独立端口的 gRPC server** `FlowServiceGrpc`（proto 在 `cube2-proto/.../ai_application/flow/grpc/v1`：`RunFlow` / `RunFlowStream` / `UploadFlowImage`），并经 `NacosService` 把自身注册进 Nacos、在实例 metadata 广播 `grpc_server_port`。该面带 `feign_inner_invoke` 头 + `internalInvokeSecretKey` 校验——是典型的**平台内服务间 Feign/gRPC 内部调用**：调用方是**平台内兄弟 Java 后端**，与本中台出站调 ouaa 等兄弟服务**方向相反、机制对称**。它**不是** engine→flow 路径，**也不是**前端数据面。

迁移到 `cube-ai-project` 后，这两块整体缺失：

- 全仓零 `connectNodeAdapter` / `http2.createServer`；`FlowServiceGrpc` server 与 service impl 未移植。仅入站鉴权 helper（`connect-handler-session.ts` / `grpc-inner-invoke.ts`，在 `platform-adapter-ghcloud`）被移植却成死代码。
- Nacos 只有 config observer（`NacosConfigObserverService`）+ secrets loader（`NacosSecretsLoader`）；**入站服务注册**（`ServiceRegistryModule` / register / 心跳 / deregister + `grpc_server_port` 广播）整块缺失。`nacos-v1-discovery.ts` 是出站发现，非自注册。

更关键的是 `cutover-runbook.md` §5 把 gRPC `FlowServiceGrpc` 判为「退役；engine→flow 进程内 `FlowInvokerPort`」——**理由错误**：调用方根本不是 engine，进程内 port 替代不了一个对外的服务间 RPC 面。CONTEXT.md 的消费者模型当时也只有「前端（统一前门）」+「同进程 engine（`FlowInvokerPort`）」两类，缺这第三类。

约束基线：跨域只走 contracts port、能力包之间不得 import 对方实现（ADR-0002）；能力包无自有鉴权、鉴权单源 host 的 `platform-adapter-ghcloud`（ADR-0009/0012）；flow 是平级下游域、可直达（ADR-0004/0012）；tenant 单一隔离主键（ADR-0012 addendum）。

## Decision

### 1. 保留 gRPC 服务面，不改走 HTTP

`flow_service.proto` 是 cube2-proto 已发布契约、兄弟 Java 后端用 Feign/gRPC stub 绑定它。保留 gRPC、重建 server；**不**强行让兄弟后端改走 `/flow/*` HTTP/SSE（那是跨团队 breaking change，且与平台内 gRPC 互调惯例不一致）。`FlowServiceGrpc` 退役判定（旧 runbook §5）**作废**。

### 2. 这是 flow 的第三类消费者，与「AI 数据面直连」正交

CONTEXT.md 新增词条 **平台服务间调用面 (gRPC)**：平台内兄弟后端经 gRPC 调中台能力的入站面，与「前端 `/flow/*` SSE 直达」「进程内 `FlowInvokerPort`」并列，互不替代。「AI 数据面直连」只约束前端数据面，**不**覆盖也**不**否定后端服务间 gRPC。

### 3. gRPC 面落在 host（组合根），不下沉能力包

- service impl + http2 server bootstrap 放 **`apps/ai-center/src/grpc/`**（镜像旧 `ai-server` 切法）；
- impl 直接调 flow-core 的具体服务 `FlowExecutionService.run` / `.runStream`（返回 SSE `Response`）+ flow-files 上传服务，**不经** `FlowInvokerPort`——该 port 是 sync-only、无 stream/upload；
- 入站鉴权（`feign_inner_invoke` + `internalInvokeSecretKey`）复用 `platform-adapter-ghcloud` 已移植的 `validateConnectInnerInvoke` / `runWithConnectHandlerSession` / `streamWithConnectHandlerSession`（让死代码复活）；
- 生成的 proto stub（`flow_service_pb` / `_connect` / `flow_types_pb`）放 **`platform-adapter-ghcloud/src/grpc-gen/`**，与现有 cube2（guhecloud 命名空间）stub 一致。

为何是 host 而非 flow-core 自拥：gRPC 面需同时触达 flow-core 具体服务 + ghcloud 入站鉴权 + guhecloud stub；让能力包 import 平台 adapter 违 ADR-0002，抽鉴权为 port 注入则过重。**组合根是唯一可合法组合三者的层**，与旧 `ai-server/main.ts` 切法一致。

### 4. 重建 Nacos 服务注册，metadata 广播 grpc_server_port

兄弟后端经 Nacos 服务发现解析中台实例 + 从 metadata 读 `grpc_server_port` 才能发起 gRPC 内部调用（与发现 ouaa 同机制）。故重建入站注册：

- 注册生命周期服务（`onModuleInit` register + `renew` 心跳 + 定期重注册 + `onModuleDestroy` deregister/close）移植进 **`infra/bun-server-ext/nacos/`**，与 config observer 并列（同属 Nacos 接入、内聚）；
- `AiCenterAssembler` 接 `ServiceRegistryModule.forRoot({ provider: 'nacos', autoRegister: false, ... })` + 该服务；
- 实例 metadata 必须含 `grpc_server_port`（取自新增的 `grpcPort` 配置 = §3 host gRPC server 监听端口）。

### 5. 配置项补齐

host 配置（`apps/ai-center/.../server-base/config/app.config`）补 `grpcPort` / `registerGrpcPort`（缺省回退 `grpcPort`）/ `internalInvokeSecretKey`，移植旧 `ai-server-base` 的解析与回退语义。

## Consequences

- **Positive**：兄弟 Java 后端零改造继续经 gRPC + Nacos 发现调用中台 flow；对外契约（已发布 proto）连续；落点遵守 ADR-0002（组合根组合、能力包不被平台耦合）；入站鉴权 helper 从死代码转为在用；与出站调 ouaa 机制对称、心智一致。
- **Negative**：新增 host gRPC server bootstrap + service impl + proto codegen + Nacos 注册生命周期 + `grpcPort`/`internalInvokeSecretKey` 配置面；多一个监听端口与部署拓扑项；`RunFlowStream` 需复用旧 `parseSseEvents` 做 flow-core SSE `Response` → gRPC stream 映射。
- **Neutral**：`FlowInvokerPort`（engine→flow，sync-only）不动；前端 `/flow/*` SSE 直达不动；旧 runbook §5「退役」判定作废、backlog 对应项改为「重建」。

## Options Considered

- **不重建 gRPC、兄弟后端改走 HTTP `/flow/*`**：省一套 gRPC 面，但跨团队 breaking、废已发布 proto 契约、违平台 gRPC 互调惯例。否。
- **gRPC 面下沉 flow-core 自拥（与 SSE 对称）**：locality 漂亮，但需 flow-core import platform-adapter-ghcloud 鉴权 + guhecloud stub（违 ADR-0002），或抽鉴权为注入 port（为单一面过度设计）。否（host 组合）。
- **gRPC 面放 platform-adapter-ghcloud（它已有 cube2 grpc-gen + feign helper）**：transport 内聚，但需 adapter import flow-core 具体实现（违 ADR-0002）；经 `FlowInvokerPort` 又拿不到 stream/upload。否。
- **gRPC 调用经 `FlowInvokerPort`**：契约干净，但该 port sync-only、无 stream/upload，覆盖不了 `RunFlowStream` / `UploadFlowImage`。否（直调 flow-core 具体服务）。
- **不重建 Nacos 注册、兄弟后端静态配 gRPC 端点**：少一套注册，但破坏平台服务发现惯例、端点漂移难维护、与 ouaa 模式不一致。否。

## Open Questions

- 后续若 cube2 其它能力（kb/llm）也需对外 gRPC 面，是否把「host gRPC 组合」抽成可复用装配，还是逐面在 host 手写。
- `grpc_server_port` 之外，注册 metadata 是否还需 `version` / 权重等供灰度路由（旧 `NacosService` 带 `version: '0.0.1'` 占位）。
- bun-server ^3.3.0 是否仍导出 `ServiceRegistryModule` / `SERVICE_REGISTRY_TOKEN`（实现时 `bun install` 后确认；旧仓同系列包在用）。
