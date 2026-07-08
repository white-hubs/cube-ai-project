import { SfidService } from "./sfid.service";

/**
 * 进程内唯一 Snowflake 生成器（单生成器 —— Fix A 1a）。
 *
 * 这是运行路径上**唯一**的 `SfidService` 实例：`SfidModule` 用 `useValue` 把
 * `@Inject(SfidService)` 也指向它，直连 `sharedSfidService` 的仓储/outbox 与 DI
 * 注入方共享同一 `seq`，杜绝「同 nodeId、各自 seq」的同进程碰撞。
 *
 * 构造时读 `AGENTIC_ENGINE_NODE_ID` 显式覆盖；未设则处于未配置态，`next()` 抛错，
 * 直到 bootstrap 拿到 Redis 节点租约并 `configureNode()`（fail-closed，绝不默认 0）。
 */
export const sharedSfidService = new SfidService();
