# Backlog（未关闭事项）

> 自迁移收敛收尾时抢救的待办清单（2026-06-11）。完成一项划掉一项；新增项直接追加。
> 生产切换操作步骤见 [docs/operations/cutover-runbook.md](./operations/cutover-runbook.md)。

## 上线前（待运维窗口 / 真实环境）

- [ ] 真实 host JWT / 租户端到端联调（testcontainers e2e 在线跑通）
- [ ] 刷真实 catalog seed / 迁移数据（`bun run catalog:migrate` dry-run → 预发写入 → 抽样 runtime 对账 → 生产写入）
- [ ] flow / kb MySQL + Qdrant 全量数据迁移与孤儿向量清理（原 M6.T6）
- [ ] flow `app_kv` / Langflow doc key 清洗（原 M6.T5）
- [ ] 生产流量 cutover + 旧组件退役（ai-server / ai-application / gRPC FlowServiceGrpc，按 runbook §5 退役清单）
- [ ] 端到端冒烟 + 安全 backlog 结清（原 M6.T9）
- [ ] cutover 完成后删除 `tools/migration/`（catalog 迁移脚本即弃）

## 功能（可后补，待触发）

- [ ] SDK 覆盖面对齐旧 ai-application 消费需求（剩余缺口见 ADR-0014）
- [ ] cube2 `file_ref` gRPC 桥
- [ ] flow-studio：debugFlow 的 `RunResponse.raw` 输出解析与 flow-core run 结果对齐
- [ ] flow-studio：remote-sync / FlowController 单测补全（参考 `packages/flow/studio/ws3-wip/*.wip`）
- [ ] engine memory 统一到 `infra/vector-qdrant`（当前用包内 `CubeQdrantMemoryIndex`，ADR-0005 不强制）
- [ ] 租户 descriptor 缓存失效闭环（ADR-0016 §5）：管理面 publish/softDelete → outbox `descriptor_reload` 事件 → Redis pubsub（`PubSubDispatcher` 已就绪）→ `TenantDescriptorResolver` 订阅端 `invalidate`。当前 resolver 靠 30s 条目级 TTL 兜底最终一致，emit/subscribe 两端尚未接线。
- [ ] `:fromDocument` parse 失败 HTTP 码：ADR-0018 §4 写 422，但 engine 错误模型（ADR-0015 闭集）禁用 422、校验类统一 412；现按 412（`INVALID_ARGUMENT_DESCRIPTOR_DOCUMENT`）落地。若要严格 422 需扩 ADR-0015 类别集，另起 ADR。

## 明确不做（再议需新 ADR）

- gemini 原生 / jina_rerank 运行时 provider
- cube2 dictionary / ouaa 桥
- 历史数据迁移（fresh-start 策略，含 catalog）
- assistant 产品迁移（ADR-0012：弃迁，价值另以 preset 重建）
