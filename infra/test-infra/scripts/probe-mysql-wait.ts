#!/usr/bin/env bun
/**
 * 临时验证：Testcontainers MySQL 在不同 WaitStrategy 下，`start()` 返回后宿主机能否立刻连上。
 *
 * 用法（在 monorepo 根目录）：
 *   bun run --filter @cube-ai/test-infra probe-mysql-wait
 *   STRATEGY=log bun run --filter @cube-ai/test-infra probe-mysql-wait
 *   STRATEGY=ports|all|ping bun run --filter @cube-ai/test-infra probe-mysql-wait
 *
 * STRATEGY:
 *   ping  — 与 stack 默认一致：第 2 次 ready for connections 日志（无 exec）
 *   log   — 仅旧版严格日志（/Version:/，可能因文案变化卡死）
 *   ports — 仅监听端口（可能与 mysqld 切换过程脱节；容器内检测偶发失败会导致久不返回）
 *   all   — forAll(日志, 端口)，旧对照用
 *
 * 详细日志：
 *   VERBOSE=1           — 探测循环每次尝试都打印（默认仅前 5 次 + 每 10 次）
 *   REVEAL_SECRETS=1    — 日志中打印数据库口令明文（默认打码）
 */
import { MySqlContainer } from "@testcontainers/mysql";
import mysql from "mysql2/promise";
import { connect as tcpConnect } from "node:net";
import { Wait } from "testcontainers";

import { withProgressLog } from "../src/log";
import { createMysqlReadyWaitStrategy } from "../src/stack";

type StrategyName = "log" | "ports" | "all" | "ping";

/** 与 infra/test-infra/src/stack.ts 中 MySQL 栈保持一致，便于对照 */
const MYSQL_IMAGE = "mysql:8.4.6";
const MYSQL_EXPOSED_PORT = 3306;
const MYSQL_DATABASE = "agentic_test";
const MYSQL_USER = "agentic";
const MYSQL_PASSWORD = "agentic";
const MYSQL_ROOT_PASSWORD = "root";

const WAIT_STRATEGY_DESC: Record<StrategyName, string> = {
  all: "Wait.forAll([forLogMessage(/ready for connections\\. Version:/), forListeningPorts()])",
  log: `Wait.forLogMessage(/ready for connections\\. Version:/)`,
  ping: "forLogMessage(/ready for connections/i, 2)（createMysqlReadyWaitStrategy）",
  ports: "Wait.forListeningPorts()",
};

function ts(): string {
  return new Date().toISOString();
}

function log(line: string): void {
  console.error(`[${ts()}] [probe-mysql-wait] ${line}`);
}

function section(title: string): void {
  console.error(`[${ts()}] [probe-mysql-wait] ═══ ${title} ═══`);
}

function maskSecret(s: string, reveal: boolean): string {
  return reveal ? s : "***";
}

function relevantProcessEnv(): Record<string, string | undefined> {
  const keys = Object.keys(process.env).filter(
    (k) =>
      /^(DOCKER|TESTCONTAINER|CI|PATH|HOME|USER|TMPDIR|BUN|NODE)/iu.test(k) ||
      k === "STRATEGY" ||
      k === "VERBOSE" ||
      k === "REVEAL_SECRETS",
  );
  keys.sort();
  const out: Record<string, string | undefined> = {};
  for (const k of keys) {
    if (k === "PATH") {
      out[k] = `(length ${process.env[k]?.length ?? 0})`;
      continue;
    }
    out[k] = process.env[k];
  }
  return out;
}

function buildWaitStrategy(name: StrategyName) {
  const logWait = Wait.forLogMessage(/ready for connections\. Version:/u);
  switch (name) {
    case "ping": {
      return createMysqlReadyWaitStrategy();
    }
    case "log": {
      return logWait;
    }
    case "ports": {
      return Wait.forListeningPorts();
    }
    case "all": {
      return Wait.forAll([log, Wait.forListeningPorts()]);
    }
    default: {
      throw new Error(`STRATEGY must be ping|log|ports|all, got ${name}`);
    }
  }
}

function tcpProbe(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = tcpConnect({ host, port }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(1500);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function main(): Promise<void> {
  const raw = (process.env["STRATEGY"] ?? "ping").toLowerCase();
  if (raw !== "ping" && raw !== "log" && raw !== "ports" && raw !== "all") {
    log(`Invalid STRATEGY=${raw}, use ping | log | ports | all`);
    process.exit(2);
  }
  const strategy = raw as StrategyName;
  const verbose = process.env["VERBOSE"] === "1" || process.env["VERBOSE"] === "true";
  const reveal = process.env["REVEAL_SECRETS"] === "1";

  section("runtime");
  log(`process.execPath=${process.execPath}`);
  log(`process.pid=${process.pid}`);
  log(`Bun.version=${typeof Bun !== "undefined" ? Bun.version : "n/a"}`);
  log(`platform=${process.platform} arch=${process.arch} cwd=${process.cwd()}`);

  section("environment (filtered)");
  for (const [k, v] of Object.entries(relevantProcessEnv())) {
    log(`  ${k}=${v ?? ""}`);
  }

  section("MySqlContainer 构建参数（与 stack 对齐）");
  log(`  image: ${MYSQL_IMAGE}`);
  log(`  exposed container port: ${MYSQL_EXPOSED_PORT} (MySqlContainer 内置 withExposedPorts)`);
  log(`  withDatabase: ${MYSQL_DATABASE}`);
  log(`  withUsername: ${MYSQL_USER}`);
  log(`  withUserPassword: ${maskSecret(MYSQL_PASSWORD, reveal)}`);
  log(`  withRootPassword: ${maskSecret(MYSQL_ROOT_PASSWORD, reveal)}`);
  log(`  withWaitStrategy: ${WAIT_STRATEGY_DESC[strategy]}`);
  log(`  STRATEGY env (effective): ${strategy}`);
  if (!reveal) {
    log(`  (口令已打码；需要明文可设 REVEAL_SECRETS=1)`);
  }

  section("容器启动后由 Testcontainers 注入的环境变量（MySQL 官方 entrypoint 约定）");
  log(`  MYSQL_DATABASE=${MYSQL_DATABASE}`);
  log(`  MYSQL_USER=${MYSQL_USER}`);
  log(`  MYSQL_PASSWORD=${maskSecret(MYSQL_PASSWORD, reveal)}`);
  log(`  MYSQL_ROOT_PASSWORD=${maskSecret(MYSQL_ROOT_PASSWORD, reveal)}`);

  section("重要：为何 start() 阻塞时日志里「没有 IP:PORT」");
  log("  只有在 await MySqlContainer.start() **resolve 之后**，才能调用 getHost()、getMappedPort()、getConnectionUri()。");
  log("  因此在「开始 start()」到「start() 返回」之间，脚本**不可能**打印宿主机映射地址——不是忘了打，而是 API 尚未可用。");
  log("  此阶段 Docker 里可能已有容器在跑；需要人工看映射时，请另开终端：");
  log(String.raw`    docker ps --format "table {{.ID}}\t{{.Image}}\t{{.Ports}}\t{{.Names}}" | sed -n "1,20p"`);
  log('    或查找 label: docker ps -a --filter "label=org.testcontainers"');
  log("  下方 start() 等待期间，将每 10s 输出一条 [test-infra] still working…（与集成测试栈相同）。");

  section("开始 start()");
  const tStart = Date.now();
  log(`t0=${ts()}（此后若长时间只有 still working，说明仍卡在 start()，尚无端口可打印）`);

  const started = await withProgressLog(
    "MySqlContainer.start()（未完成则没有 getHost/getMappedPort）",
    new MySqlContainer(MYSQL_IMAGE)
      .withDatabase(MYSQL_DATABASE)
      .withUsername(MYSQL_USER)
      .withUserPassword(MYSQL_PASSWORD)
      .withRootPassword(MYSQL_ROOT_PASSWORD)
      .withWaitStrategy(buildWaitStrategy(strategy))
      .start(),
  );

  const afterStart = Date.now();
  log(`start() 已返回: wall=${ts()}  duration=${afterStart - tStart}ms — **此后**出现的 socket= 即为本容器宿主机映射`);

  section("StartedMySqlContainer / 底层容器信息（从此节起才有「连哪」）");
  const containerId = started.getId();
  const containerName = started.getName()?.trim() ?? "";
  const host = started.getHost();
  const mapped = started.getMappedPort(MYSQL_EXPOSED_PORT);
  log(`  getId(): ${containerId}`);
  log(`  getName(): ${containerName}`);
  log(`  getHost(): ${host}`);
  log(`  getMappedPort(${MYSQL_EXPOSED_PORT}): ${mapped}`);
  log(`  getHostname(): ${started.getHostname()}`);
  log(`  getDatabase(): ${started.getDatabase()}`);
  log(`  getUsername(): ${started.getUsername()}`);
  log(`  getPort(): ${started.getPort()}`);

  const labels = started.getLabels();
  const labelKeys = Object.keys(labels).toSorted();
  log(`  labels (${labelKeys.length} keys):`);
  for (const k of labelKeys) {
    log(`    ${k}=${labels[k]}`);
  }

  const uri = started.getConnectionUri();
  const u = new URL(uri);
  log(`  getConnectionUri() (打码): mysql://${u.username}:***@${u.hostname}:${u.port}${u.pathname}`);

  const socketTarget = `${host}:${mapped}`;
  /** 探测日志里重复带上，避免看不出连的是谁 */
  const targetTag = `socket=${socketTarget} containerId=${containerId} name=${containerName || "(empty)"}`;

  section("连接目标（宿主机侧 → 本容器映射端口）");
  log(`  适用范围：**仅上面 id/name 对应的这一实例**；socket=${socketTarget} 即你在宿主机上应 telnet/mysql 的地址。`);
  log(`  说明：以下探测均在「运行脚本的机器」上发起，连的是 Docker 发布到宿主机的端口，不是容器内网 IP。`);
  log(`  TCP / mysql2 目标：${socketTarget}（getHost()=${JSON.stringify(host)} getMappedPort(${MYSQL_EXPOSED_PORT})=${mapped}）`);
  log(`  URI 解析：host=${u.hostname} port=${u.port} database=${u.pathname?.replace(/^\//u, "") ?? ""}`);
  if (u.hostname !== host || String(mapped) !== String(u.port)) {
    log(`  警告：URI 与 getHost/getMappedPort 不一致，请排查 Testcontainers 版本或 URI 实现`);
  }
  const netNames = started.getNetworkNames();
  if (netNames.length > 0) {
    for (const nn of netNames) {
      try {
        const ip = started.getIpAddress(nn);
        log(`  容器在 Docker 网络「${nn}」中的地址（仅供对照，探测不走这里）：${ip}`);
      } catch {
        log(`  容器在 Docker 网络「${nn}」中的地址：无法读取`);
      }
    }
  }

  section("探测阶段配置");
  const mysqlConnectOpts = {
    connectTimeout: 2000,
    multipleStatements: true,
    uri: "(see getConnectionUri redacted above)",
  };
  log(`  mysql2.createConnection options: ${JSON.stringify(mysqlConnectOpts)}`);
  log(`  tcpProbe: net.connect({ host: ${JSON.stringify(host)}, port: ${mapped} }), socket timeout 1500ms`);
  log(`  probe loop sleep 300ms between attempts, deadline 90s`);
  log(`  VERBOSE=${verbose ? "on (each attempt logged)" : "off (sampled)"}`);
  log(`  每条探测日志均附带：${targetTag}`);

  section("post-start connectivity probe");
  const deadline = Date.now() + 90_000;
  let attempt = 0;
  let firstTcpMs: number | null = null;
  let firstMysqlMs: number | null = null;

  while (Date.now() < deadline && firstMysqlMs === null) {
    attempt += 1;
    const now = Date.now();
    const dt = now - afterStart;
    const sample = verbose || attempt <= 5 || attempt % 10 === 0;

    if (firstTcpMs === null) {
      const ok = await tcpProbe(host, mapped);
      if (ok) {
        firstTcpMs = dt;
        log(
          `attempt ${attempt}: first TCP connect+end OK → ${socketTarget} | ${targetTag} | +${firstTcpMs}ms after start() | wall ${ts()}`,
        );
      } else if (sample) {
        log(`attempt ${attempt}: TCP closed/refused → ${socketTarget} | ${targetTag} | +${dt}ms`);
      }
    } else if (sample) {
      log(`attempt ${attempt}: TCP already OK, skip tcpProbe | ${targetTag} | +${dt}ms`);
    }

    try {
      const conn = await mysql.createConnection({
        connectTimeout: 2000,
        multipleStatements: true,
        uri,
      });
      try {
        const [rows] = await conn.query("SELECT 1 AS ok");
        firstMysqlMs = Date.now() - afterStart;
        log(
          `attempt ${attempt}: mysql2 query OK → mysql://${u.hostname}:${u.port}${u.pathname} | ${targetTag} | +${firstMysqlMs}ms after start() | wall ${ts()}`,
        );
        log(`  SELECT 1 result summary: ${JSON.stringify(rows)}`);
      } finally {
        await conn.end();
      }
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const code = typeof e === "object" && e && "code" in e ? String((e as { code: unknown }).code) : "";
      if (sample) {
        log(
          `attempt ${attempt}: mysql2 error → mysql://${u.hostname}:${u.port}${u.pathname} | ${targetTag} | +${dt}ms | code=${code || "n/a"} msg=${msg}`,
        );
      }
    }

    await new Promise((r) => setTimeout(r, 300));
  }

  section("summary");
  log(`start() duration: ${afterStart - tStart}ms`);
  log(`first TCP vs start(): ${firstTcpMs === null ? "never" : `+${firstTcpMs}ms`}`);
  log(`first mysql2 vs start(): ${firstMysqlMs === null ? "never" : `+${firstMysqlMs}ms`}`);

  if (firstMysqlMs === null) {
    log("RESULT: FAILED (no mysql connection within 90s)");
    process.exitCode = 1;
  } else {
    log("RESULT: OK");
  }

  section("teardown");
  const tStop = Date.now();
  await started.stop();
  log(`container.stop() done in ${Date.now() - tStop}ms — bye`);
}

await main();
