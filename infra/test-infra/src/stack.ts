import { MySqlContainer, type StartedMySqlContainer } from "@testcontainers/mysql";
import { QdrantContainer, type StartedQdrantContainer } from "@testcontainers/qdrant";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { Wait } from "testcontainers";

import { testInfraLog, withProgressLog } from "./log";

/**
 * 仅依赖容器日志流（`follow: true`），不跑 `ShellWaitStrategy` / `docker exec`：
 * Testcontainers 对 exec 的 stream 处理在部分环境下会导致 `mysqladmin` 等命令**长时间不结束**，
 * 且 exec 会话**未必继承** `MYSQL_ROOT_PASSWORD`，表现为「容器里 MySQL 早就能连但 `start()` 卡住」。
 *
 * 也不用 `forListeningPorts()`：`HostPortWaitStrategy` 要求容器内端口检测通过，官方镜像缺 `nc` 等时常误判。
 *
 * 匹配第 **2** 次 `ready for connections`：跳过初始化阶段临时实例的第 1 条，更接近最终 mysqld。
 * 若仍早于宿主机端口发布，`applyMinimalMysqlSchema` 会对 transient 错误重试。
 */
export function createMysqlReadyWaitStrategy() {
  return Wait.forLogMessage(/ready for connections/iu, 2);
}

export interface MysqlRedisQdrantStack {
  mysqlUrl: string;
  redisUrl: string;
  qdrantUrl: string;
  stop: () => Promise<void>;
}

export interface MysqlRedisStack {
  mysqlUrl: string;
  redisUrl: string;
  stop: () => Promise<void>;
}

export interface RedisOnlyStack {
  redisUrl: string;
  stop: () => Promise<void>;
}

export interface MysqlOnlyStack {
  mysqlUrl: string;
  stop: () => Promise<void>;
}

type Started = StartedMySqlContainer | StartedRedisContainer | StartedQdrantContainer;

async function stopQuiet(c: Started): Promise<void> {
  try {
    await c.stop();
  } catch {
    /* ignore teardown errors */
  }
}

async function stopAll(started: Started[]): Promise<void> {
  await Promise.all(started.map((c) => stopQuiet(c)));
}

/**
 * 与 {@link startMysqlRedisQdrant} 内 `started` 数组同一引用，便于 Ctrl+C 时尚未把 stack 赋给
 * `stackHolder` 也能停掉已起的容器。
 */
let tracked: Started[] | null = null;

/** 中断或 emergency：停掉当前跟踪到的全部 Testcontainer（含 beforeAll 未完成时）。 */
export async function stopTrackedTestcontainersIfAny(): Promise<void> {
  const arr = tracked;
  if (!arr?.length) {
    return;
  }
  testInfraLog(`Stopping ${arr.length} tracked Testcontainer(s) (interrupt / partial start)…`);
  await stopAll(arr);
  if (tracked === arr) {
    tracked = null;
  }
}

async function startMysqlIn(started: Started[]): Promise<StartedMySqlContainer> {
  testInfraLog("Starting MySQL (mysql:8.4.6) — wait: 日志第 2 次 ready for connections（无 exec / 无容器内端口探测）");
  const t0 = Date.now();
  const mysqlContainer = await withProgressLog(
    "MySqlContainer.start()",
    new MySqlContainer("mysql:8.4.6")
      .withDatabase("agentic_test")
      .withUsername("agentic")
      .withUserPassword("agentic")
      .withRootPassword("root")
      .withWaitStrategy(createMysqlReadyWaitStrategy())
      .start(),
  );
  started.push(mysqlContainer);
  testInfraLog(`MySQL container ready (+${Date.now() - t0}ms)`);
  return mysqlContainer;
}

async function startRedisIn(started: Started[]): Promise<StartedRedisContainer> {
  testInfraLog("Starting Redis (redis:8-alpine)…");
  const t1 = Date.now();
  const redisContainer = await withProgressLog("RedisContainer.start()", new RedisContainer("redis:8-alpine").start());
  started.push(redisContainer);
  testInfraLog(`Redis container ready (+${Date.now() - t1}ms)`);
  return redisContainer;
}

async function startQdrantIn(started: Started[]): Promise<StartedQdrantContainer> {
  testInfraLog("Starting Qdrant (qdrant/qdrant:v1.17.1)…");
  const t2 = Date.now();
  const qdrantContainer = await withProgressLog("QdrantContainer.start()", new QdrantContainer("qdrant/qdrant:v1.17.1").start());
  started.push(qdrantContainer);
  testInfraLog(`Qdrant container ready (+${Date.now() - t2}ms)`);
  return qdrantContainer;
}

function stackStop(started: Started[]): () => Promise<void> {
  return async () => {
    await stopAll(started);
    if (tracked === started) {
      tracked = null;
    }
  };
}

/**
 * 仅 MySQL — Outbox 等仅需持久化的集成。
 */
export async function startMysqlOnly(): Promise<MysqlOnlyStack> {
  const started: Started[] = [];
  tracked = started;

  try {
    const mysql = await startMysqlIn(started);
    return {
      mysqlUrl: mysql.getConnectionUri(),
      stop: stackStop(started),
    };
  } catch (e) {
    await stopAll(started);
    if (tracked === started) {
      tracked = null;
    }
    throw e;
  }
}

/**
 * 仅 Redis — Leader/BullMQ 等轻量集成。
 */
export async function startRedisOnly(): Promise<RedisOnlyStack> {
  const started: Started[] = [];
  tracked = started;

  try {
    const redis = await startRedisIn(started);
    return {
      redisUrl: redis.getConnectionUrl(),
      stop: stackStop(started),
    };
  } catch (e) {
    await stopAll(started);
    if (tracked === started) {
      tracked = null;
    }
    throw e;
  }
}

/**
 * MySQL 8 + Redis，无 Qdrant — AuthZ / Outbox / Jobs（仅需 DB+队列）等。
 */
export async function startMysqlRedis(): Promise<MysqlRedisStack> {
  const started: Started[] = [];
  tracked = started;

  try {
    const mysql = await startMysqlIn(started);
    const redis = await startRedisIn(started);
    return {
      mysqlUrl: mysql.getConnectionUri(),
      redisUrl: redis.getConnectionUrl(),
      stop: stackStop(started),
    };
  } catch (e) {
    await stopAll(started);
    if (tracked === started) {
      tracked = null;
    }
    throw e;
  }
}

/**
 * Starts MySQL 8 + Redis + Qdrant for integration tests.
 * Sequential start + failure rollback：任一 `.start()` 失败会停止已启动实例，避免孤儿容器。
 */
export async function startMysqlRedisQdrant(): Promise<MysqlRedisQdrantStack> {
  const started: Started[] = [];
  tracked = started;

  try {
    const mysqlContainer = await startMysqlIn(started);
    const redisContainer = await startRedisIn(started);
    const qdrantContainer = await startQdrantIn(started);

    const mysqlUrl = mysqlContainer.getConnectionUri();
    const redisUrl = redisContainer.getConnectionUrl();
    const qdrantUrl = `http://${qdrantContainer.getRestHostAddress()}`;

    return {
      mysqlUrl,
      qdrantUrl,
      redisUrl,
      stop: stackStop(started),
    };
  } catch (e) {
    await stopAll(started);
    if (tracked === started) {
      tracked = null;
    }
    throw e;
  }
}
