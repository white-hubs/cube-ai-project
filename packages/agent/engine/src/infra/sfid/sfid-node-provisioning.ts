import type pino from "pino";

import { REDIS_CLIENT_TOKEN } from "../../bc/session/session.tokens";
import { ShutdownRegistry } from "../lifecycle/shutdown-registry";
import { SfidNodeLease, type SfidNodeLeaseHandle, type SfidNodeLeaseRedis } from "./sfid-node-lease";
import type { SfidService } from "./sfid.service";
import { sharedSfidService } from "./shared-sfid";

/**
 * SFID nodeId 供给 —— Fix A 1b/1c 的装配入口。
 *
 * 决策链：
 *   1. 显式 `AGENTIC_ENGINE_NODE_ID` 已在构造时配置 → 跳过租约。
 *   2. 未配置 + 有 Redis → 抢节点租约、`configureNode`、起心跳、注册优雅关闭释放。
 *   3. 未配置 + 无 Redis → 抛错（fail-closed，绝不默认 0）。
 */

const DEFAULT_HEARTBEAT_MS = 20_000;
const DEFAULT_TTL_SECONDS = 60;

/** pino 的最小日志面（bootstrap 传 pino.Logger）。 */
type LoggerLike = Pick<pino.Logger, "info" | "warn" | "error">;

export interface ProvisionSfidNodeDeps {
  sfid: SfidService;
  redis: SfidNodeLeaseRedis | null;
  /** 注册优雅关闭钩子（清心跳 + 释放槽位）；bootstrap 传入 ShutdownRegistry 适配。 */
  registerShutdown?: (close: () => Promise<void>) => void;
  /** 心跳周期（毫秒）；<=0 关闭心跳（单测用）。默认 20s。 */
  heartbeatMs?: number;
  /** 租约 TTL（秒）；默认 60。 */
  ttlSeconds?: number;
  log?: LoggerLike;
}

export async function provisionSfidNode(deps: ProvisionSfidNodeDeps): Promise<SfidNodeLeaseHandle | null> {
  const { sfid, redis, log } = deps;

  if (sfid.isConfigured) {
    log?.info({ source: "env" }, "sfid.node.configured");
    return null;
  }

  if (!redis) {
    throw new Error(
      "[provisionSfidNode] SFID nodeId is not configured and no Redis is available for a node lease — " +
        "refusing to start (fail-closed). Set AGENTIC_ENGINE_NODE_ID or provide AGENTIC_ENGINE_REDIS_URL.",
    );
  }

  const ttlSeconds = deps.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const lease = new SfidNodeLease({ redis, ttlSeconds });
  const handle = await lease.acquire();
  sfid.configureNode(handle.nodeId);
  log?.info({ source: "redis-lease", nodeId: handle.nodeId }, "sfid.node.configured");

  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  if (heartbeatMs > 0) {
    timer = setInterval(() => {
      handle
        .renew()
        .then((ok) => {
          if (!ok) log?.error({ nodeId: handle.nodeId }, "sfid.node.lease.lost");
        })
        .catch((e: unknown) => {
          log?.warn({ err: String(e), nodeId: handle.nodeId }, "sfid.node.lease.renew.failed");
        });
    }, heartbeatMs);
    // 不阻止进程退出。
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  deps.registerShutdown?.(async () => {
    if (timer) clearInterval(timer);
    await handle.release();
  });

  return handle;
}

interface DiContainer {
  resolve: (token: unknown) => unknown;
}

/**
 * bootstrap 便捷入口：从容器解析 Redis + ShutdownRegistry，配置进程内唯一的
 * {@link sharedSfidService}。在任何会 mint SFID 的启动步骤（descriptor loader 等）
 * 之前调用。
 */
export async function provisionSfidNodeFromContainer(container: DiContainer, log?: LoggerLike): Promise<void> {
  let redis: SfidNodeLeaseRedis | null = null;
  try {
    redis = (container.resolve(REDIS_CLIENT_TOKEN) as SfidNodeLeaseRedis | null) ?? null;
  } catch {
    redis = null;
  }

  let registerShutdown: ((close: () => Promise<void>) => void) | undefined;
  try {
    const shutdown = container.resolve(ShutdownRegistry) as ShutdownRegistry;
    registerShutdown = (close: () => Promise<void>) => shutdown.register({ name: "sfid-node-lease", priority: 95, close });
  } catch {
    registerShutdown = undefined;
  }

  await provisionSfidNode({
    sfid: sharedSfidService,
    redis,
    ...(registerShutdown ? { registerShutdown } : {}),
    ...(log ? { log } : {}),
  });
}
