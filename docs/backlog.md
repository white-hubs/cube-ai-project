# Backlog（未关闭事项）

> 自迁移收敛收尾时抢救的待办清单（2026-06-11）。完成一项划掉一项；新增项直接追加。
> 生产切换操作步骤见 [docs/operations/cutover-runbook.md](./operations/cutover-runbook.md)。

## 上线前（待运维窗口 / 真实环境）

- [ ] 真实 host JWT / 租户端到端联调（testcontainers e2e 在线跑通）
- [x] **系统 LLM 目录 seed 化**：754 个系统模型（极客智坊 666 / 火山方舟 41 / 阿里云百炼 37 / 通用 10）落为 S 类启动 seed（`packages/llm/core/migrations/S001..S004`，ADR-0017），随程序启动幂等灌入，无需手工迁移。
- [ ] 刷真实**租户** catalog 数据（`ai_application_tenant_llm_provider/model` + vendor 凭据：`bun run catalog:migrate` dry-run → 预发写入 → 抽样 runtime 对账 → 生产写入）。系统目录四表已 seed，无需迁移。
- [ ] flow / kb MySQL + Qdrant 全量数据迁移与孤儿向量清理（原 M6.T6）
- [ ] flow `app_kv` / Langflow doc key 清洗（原 M6.T5）
- [ ] 生产流量 cutover + 旧组件退役（ai-server / ai-application 旧进程实例，按 runbook §5 退役清单）。注意：gRPC `FlowServiceGrpc` **能力面不退役**，在 ai-center host 重建（ADR-0028）——退役的只是旧 ai-server 实例。
- [ ] 端到端冒烟 + 安全 backlog 结清（原 M6.T9）
- [ ] cutover 完成后删除 `tools/migration/`（**租户** catalog 迁移脚本即弃；系统目录已 seed 化，不再依赖该脚本）

## 功能（可后补，待触发）

- [x] **flow 对外 gRPC 服务面重建（ADR-0028）**：已落地。host gRPC server（`apps/ai-center/src/grpc/`：`FlowServiceGrpc` impl + http2 bootstrap，调 flow-core `FlowsService.run/runStream` + `FlowFilesService.uploadFlowFile`，复用 platform-adapter-ghcloud 入站鉴权 helper）；proto stub copy 进 `platform-adapter-ghcloud/src/grpc-gen/` 并 re-export；`parseSseEvents` SSE→gRPC stream 映射；`grpcPort`/`registerGrpcPort`/`internalInvokeSecretKey` 配置补齐；bootstrap 起服务 + `ShutdownRegistry` graceful close。计划见 `docs/plans/2026-06-16-flow-grpc-and-nacos-registration.md`。
- [x] **Nacos 入站服务注册重建（ADR-0028）**：已落地。`NacosServiceRegistrationService`（register+心跳 renew+定期重注册+deregister/close）在 `infra/bun-server-ext/nacos/`，`AiCenterAssembler` 接 `ServiceRegistryModule.forRoot`，metadata 广播 `grpc_server_port`。
- [ ] SDK 覆盖面对齐旧 ai-application 消费需求（剩余缺口见 ADR-0014）
- [ ] cube2 `file_ref` gRPC 桥
- [ ] flow-studio：debugFlow 的 `RunResponse.raw` 输出解析与 flow-core run 结果对齐
- [ ] flow-studio：remote-sync / FlowController 单测补全（参考 `packages/flow/studio/ws3-wip/*.wip`）
- [ ] engine memory 统一到 `infra/vector-qdrant`（当前用包内 `CubeQdrantMemoryIndex`，ADR-0005 不强制）
- [x] **租户 descriptor 缓存失效闭环（ADR-0016 §5）**：已落地。emit（`descriptor-management.service.ts` 的 `publish`/`remove` append `descriptor_reload` outbox 事件）与 dispatch（`PubSubDispatcher` 映射到 `pubsub:descriptor.reload`）本就已接好；补的是订阅端——`TenantDescriptorResolver.attachInvalidationSubscriber(redis)`（照抄 `grant.service.ts` 的 `attachInvalidationSubscriber` 模式），在 `session.module.ts` 用现有 `REDIS_CLIENT_TOKEN`/`createSessionRedis()` 接上；无 redis 时静默保留原 30s TTL 兜底。
- [ ] `:fromDocument` parse 失败 HTTP 码：ADR-0018 §4 写 422，但 engine 错误模型（ADR-0015 闭集）禁用 422、校验类统一 412；现按 412（`INVALID_ARGUMENT_DESCRIPTOR_DOCUMENT`）落地。若要严格 422 需扩 ADR-0015 类别集，另起 ADR。
- [x] **rule 模型激活轴收口（原「type + scope 回归」暂缓项，ADR-0032）**：tachu rc.11 把证伪的 `RuleScope`（phase 轴，`turnStart`/`turnStop` 无消费点）换成可落地的 **`RuleActivation`**（activation 轴：`always`/`manual`/`semantic`/`path`），deferred 前提消失，随 rc.12 迁移一并收口。本仓 `RuleDescriptor` 增 `activation?: RuleActivation`（自持类型、缺省 always），loader fail-closed 校验（未知 mode / path 缺 globs → 跳过，不静默降级）；**分层规则组装**（组装委托 tachu 原生 activation 管线，反转 ADR-0016 §7 自建路径）：每轮把 snapshot 规则投影给 `SessionScope.additionalRules`、点名集给 `explicitRuleNames`，交 `PromptAssembler` 按 activation 组装进 **system 段**——`always` 恒进、`manual` 命中 `@rule`/`/rule` ∪ `explicitRuleNames` 才进，全部**每轮重算、不入 memory**；`semantic`（engine 未透传 `semanticActiveRuleNames`）/`path`（未透传 `contextFilePaths` + 无 per-turn 文件上下文）留档 inert。`safety-baseline.yaml` 去掉被忽略的 `type`/`scope`、改写为显式 `activation: {mode: always}`。词汇见 CONTEXT.md「规则激活 / 分层规则组装」。**遗留**：semantic 工具回调、path 文件上下文、租户 rule 的 activation 编辑面见 ADR-0032 Open Questions。

## 明确不做（再议需新 ADR）

- gemini 原生 / jina_rerank 运行时 provider
- cube2 dictionary / ouaa 桥
- 历史业务数据迁移（fresh-start 策略）。注：**系统 LLM 目录**已改由启动 seed 灌入（ADR-0017，`S001..S004`），非 fresh-start 留空；**租户** catalog 仍按 cutover-runbook §3 迁移
- assistant 产品迁移（ADR-0012：弃迁，价值另以 preset 重建）
