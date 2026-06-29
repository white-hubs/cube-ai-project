import { type ChildProcess, spawn } from "node:child_process";

import { INTEGRATION_AGENT_DESCRIPTOR_DIR } from "./integration-agent-fixture";
import { testInfraLog } from "./log";
import { findMonorepoRoot, resolveBunExecutable, resolveEnginePackageDir } from "./repo-path";
import { type MysqlRedisQdrantStack, type MysqlRedisStack } from "./stack";

/**
 * Stack flavours acceptable for {@link startEngineIntegrationProcess}:
 * the multi-replica path (T14) only needs MySQL+Redis, while the
 * single-replica end-to-end suite still relies on Qdrant for Memory probes.
 *
 * `qdrantUrl` is propagated only when present; absent → no env override
 * (engine bootstrap tolerates missing Qdrant for Outbox/Jobs-only flows).
 */
type EngineSubprocessStack = MysqlRedisQdrantStack | MysqlRedisStack;

async function waitForHttpOk(url: string, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  const started = Date.now();
  let lastProgressLog = started;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) {
        testInfraLog(`${label} OK (+${Date.now() - started}ms)`);
        return;
      }
    } catch (e) {
      lastErr = e;
    }
    const now = Date.now();
    if (now - lastProgressLog >= 10_000) {
      lastProgressLog = now;
      const sec = Math.round((now - started) / 1000);
      testInfraLog(`Still waiting for ${label} (${sec}s / ${Math.round(timeoutMs / 1000)}s) — ${url} lastErr=${String(lastErr)}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`waitForHttpOk: timeout ${timeoutMs}ms for ${url} last=${String(lastErr)}`);
}

export interface EngineIntegrationProcess {
  readonly baseUrl: string;
  /** Existing all-in-one stop: SIGTERM + wait exit + 25s SIGKILL fallback. */
  stop(): Promise<void>;
  /**
   * Ring-buffer capture of child stdout+stderr when {@link startEngineIntegrationProcess}
   * was started with `captureProcessOutput: true`; otherwise returns `''`.
   */
  getCapturedOutput(): string;
  /**
   * Send a signal to the child without waiting for exit. Useful when a test
   * must keep an SSE reader alive across SIGTERM (e.g. drain.mode frame
   * assertion) before subsequently calling {@link waitForExit}.
   */
  sendSignal(sig: NodeJS.Signals): void;
  /**
   * Wait for the child process to exit. If the process has already exited,
   * resolves immediately with the captured `exitCode` / `signalCode`.
   *
   * @param timeoutMs — defaults to 30s; rejects on timeout.
   */
  waitForExit(timeoutMs?: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/**
 * Resolve once `child` exits. If it has already exited, resolve synchronously
 * with the captured `exitCode` / `signalCode`. Multiple concurrent waiters are
 * supported (each registers its own `child.once('exit', …)` listener).
 */
function awaitChildExit(child: ChildProcess, timeoutMs: number): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({
      code: child.exitCode,
      signal: child.signalCode as NodeJS.Signals | null,
    });
  }
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`waitForExit timeout ${timeoutMs}ms`)), timeoutMs);
    child.once("exit", (code, signal) => {
      clearTimeout(t);
      resolve({ code, signal });
    });
  });
}

/**
 * 从 monorepo 根目录启动 `@cube-ai/agent-engine` HTTP 进程（子进程），用于集成测试。
 */
export async function startEngineIntegrationProcess(opts: {
  /**
   * Shared infra stack. Both the Qdrant-bearing flavour (single-replica
   * end-to-end) and the MySQL+Redis-only flavour (T14 multi-replica) are
   * supported. `qdrantUrl` is forwarded only when the flavour exposes it.
   */
  stack: EngineSubprocessStack;
  port: number;
  repoRoot: string;
  /** 等待 /health/live 的超时（ms） */
  readyTimeoutMs?: number;
  /**
   * Optional env overrides applied AFTER defaults — lets callers switch e.g.
   * `AGENTIC_ENGINE_AUTH_MODE=oauth2` or inject mock IdP URLs without forking
   * this helper. Keys here win over the defaults below.
   */
  extraEnv?: Record<string, string>;
  /**
   * Remove these keys from the child env after copying `process.env` — use
   * when CI inherits e.g. `OTEL_EXPORTER_OTLP_ENDPOINT` and tests need a clean
   * NoOp OTel bootstrap.
   */
  unsetEnv?: readonly string[];
  /**
   * When true, pipe stdout+stderr into an in-memory ring buffer (≈512 KiB)
   * for assertions (`getCapturedOutput`). Default leaves stdio as today
   * (stdout/stderr inherit).
   */
  captureProcessOutput?: boolean;
}): Promise<EngineIntegrationProcess> {
  const repoRoot = findMonorepoRoot(opts.repoRoot);
  const engineCwd = resolveEnginePackageDir(repoRoot);
  const bunExe = resolveBunExecutable();
  const baseUrl = `http://127.0.0.1:${opts.port}`;
  const readyMs = opts.readyTimeoutMs ?? 120_000;

  testInfraLog(`Spawning Engine subprocess (${bunExe} run src/main.ts, cwd=${engineCwd}) → ${baseUrl} …`);

  const env: NodeJS.ProcessEnv = { ...process.env };

  /**
   * 本栈只跑 MySQL/Redis/Qdrant，勿继承仓库根 `.env` 里常见的外部 Nacos，否则
   * DescriptorLoader 会轮询连不可达地址；勿继承不存在的 `AGENTIC_ENGINE_TOOL_DESCRIPTOR_DIR`（如 `./descriptors`）以免 ENOENT 噪音。
   */
  for (const k of [
    "AGENTIC_ENGINE_NACOS_URL",
    "AGENTIC_ENGINE_NACOS_SERVERS",
    "AGENTIC_ENGINE_NACOS_NAMESPACE",
    "AGENTIC_ENGINE_NACOS_USERNAME",
    "AGENTIC_ENGINE_NACOS_PASSWORD",
    "AGENTIC_ENGINE_TOOL_DESCRIPTOR_DIR",
  ] as const) {
    delete env[k];
  }

  Object.assign(env, {
    AGENTIC_ENGINE_AGENT_DESCRIPTOR_DIR: INTEGRATION_AGENT_DESCRIPTOR_DIR,
    AGENTIC_ENGINE_AUTH_MODE: "mock",
    AGENTIC_ENGINE_DRAIN_GRACE_SECONDS: "2",
    AGENTIC_ENGINE_ENABLE_JOB_WORKERS: "0",
    AGENTIC_ENGINE_HOSTNAME: "127.0.0.1",
    AGENTIC_ENGINE_MYSQL_DSN: opts.stack.mysqlUrl,
    AGENTIC_ENGINE_MYSQL_URL: opts.stack.mysqlUrl,
    AGENTIC_ENGINE_PORT: String(opts.port),
    AGENTIC_ENGINE_PRE_DRAIN_SLEEP_MS: "0",
    AGENTIC_ENGINE_PROVIDER: "noop",
    AGENTIC_ENGINE_REDIS_URL: opts.stack.redisUrl,
    AGENTIC_ENGINE_SECRETS_SOURCE: "env",
    NODE_ENV: "test",
  });

  if ("qdrantUrl" in opts.stack && opts.stack.qdrantUrl) {
    env.AGENTIC_ENGINE_QDRANT_URL = opts.stack.qdrantUrl;
  }

  if (opts.extraEnv) {
    Object.assign(env, opts.extraEnv);
  }

  if (opts.unsetEnv?.length) {
    for (const k of opts.unsetEnv) {
      delete env[k];
    }
  }

  const capture = opts.captureProcessOutput === true;
  let outputRing = "";
  const OUTPUT_CAP = 512_000;
  const appendCapture = (chunk: Buffer): void => {
    outputRing = (outputRing + chunk.toString("utf8")).slice(-OUTPUT_CAP);
  };

  const child: ChildProcess = spawn(bunExe, ["run", "src/main.ts"], {
    cwd: engineCwd,
    detached: false,
    env,
    stdio: capture ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "inherit"],
  });

  const spawnError = new Promise<never>((_, reject) => {
    child.once("error", (err) => {
      reject(new Error(`Engine subprocess spawn failed (${bunExe}): ${err instanceof Error ? err.message : String(err)}`, { cause: err }));
    });
  });

  if (capture) {
    child.stdout?.on("data", appendCapture);
    child.stderr?.on("data", appendCapture);
  }

  try {
    await Promise.race([waitForHttpOk(`${baseUrl}/health/live`, readyMs, "Engine /health/live"), spawnError]);
  } catch (e) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await new Promise<void>((r) => child.once("exit", () => r()));
    }
    throw e;
  }

  return {
    baseUrl,
    getCapturedOutput: () => (capture ? outputRing : ""),
    sendSignal: (sig: NodeJS.Signals) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }
      try {
        child.kill(sig);
      } catch {
        /* ignore: race with self-initiated exit */
      }
    },
    stop: () =>
      new Promise((resolve, reject) => {
        /**
         * Resilient SIGTERM → wait → SIGKILL fallback that handles a child
         * which has ALREADY exited (e.g. a prior `sendSignal('SIGTERM') +
         * waitForExit` split path, or a test that asserted before the
         * intended `engineHolder.current = null` cleanup line ran).
         *
         * Without this guard, registering `child.once('exit', …)` on a
         * process that already emitted `exit` never fires, leaving
         * `afterAll` hung for the 25 s SIGKILL fallback × number of
         * subsequent test files in the run.
         */
        if (child.exitCode !== null || child.signalCode !== null) {
          resolve();
          return;
        }
        const killTimer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* ignore */
          }
        }, 25_000);
        child.once("exit", () => {
          clearTimeout(killTimer);
          resolve();
        });
        child.once("error", reject);
        try {
          child.kill("SIGTERM");
        } catch {
          /* child already torn down between the guard and this call */
          clearTimeout(killTimer);
          resolve();
        }
      }),
    waitForExit: (timeoutMs = 30_000) => awaitChildExit(child, timeoutMs),
  };
}
