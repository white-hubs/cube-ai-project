import { getContainerRuntimeClient } from "testcontainers";

/**
 * Testcontainers 集成测试门闸 — 由根目录脚本注入环境变量，避免裸 `bun test` 拉起 Docker。
 *
 * - `shouldRunTestcontainers`：`USE_TESTCONTAINERS=1`（见 `bun run test:integration` / `test:containers`）
 * - `shouldRunNacosTestcontainers`：`USE_NACOS_TESTCONTAINERS=1`（Nacos 镜像较重，单独门闸）
 *
 * - `resolveShouldRunTestcontainers` 等：**在环境门闸为真时**再探测 Testcontainers 是否能连上 Docker
 *   （与裸设 `USE_TESTCONTAINERS=1` 但未启动 Docker 的错误相比，整组用例会 `describe.skip` 并告警一次）。
 */
export function shouldRunTestcontainers(): boolean {
  return process.env["USE_TESTCONTAINERS"] === "1";
}

export function shouldRunNacosTestcontainers(): boolean {
  return process.env["USE_NACOS_TESTCONTAINERS"] === "1";
}

let runtimeReachablePromise: Promise<boolean> | null = null;
let warnedNoContainerRuntime = false;

async function probeTestcontainerRuntimeOnce(): Promise<boolean> {
  try {
    await getContainerRuntimeClient();
    return true;
  } catch {
    if (!warnedNoContainerRuntime) {
      warnedNoContainerRuntime = true;
      console.warn(
        "[test-infra] 未检测到可用容器运行时（Docker 等）；Testcontainers 无法连接。\n" +
          "集成测试套件将 skip。请先启动 Docker Desktop / Colima，或正确设置 DOCKER_HOST / socket。\n" +
          "若仅跑纯单测请勿设置 USE_TESTCONTAINERS=1。",
      );
    }
    return false;
  }
}

function getCachedRuntimeReachable(): Promise<boolean> {
  if (!runtimeReachablePromise) {
    runtimeReachablePromise = probeTestcontainerRuntimeOnce();
  }
  return runtimeReachablePromise;
}

/** 环境门闸成立且 Docker / Testcontainers 可达时方为 true（进程内缓存一次探测结果）。 */
export async function resolveShouldRunTestcontainers(): Promise<boolean> {
  if (!shouldRunTestcontainers()) {
    return false;
  }
  return getCachedRuntimeReachable();
}

/** Nacos Testcontainers：`USE_NACOS_TESTCONTAINERS=1` 且运行时可达（进程内与同批其它 resolve 共用探测）。 */
export async function resolveShouldRunNacosTestcontainers(): Promise<boolean> {
  if (!shouldRunNacosTestcontainers()) {
    return false;
  }
  return getCachedRuntimeReachable();
}

/**
 * Ollama 拉模 + LLM 端到端（`sdk-core` 等）— 需 Docker，且首拉极慢；**勿**默认并入 CI。
 *
 *   USE_TESTCONTAINERS=1 RUN_OLLAMA_E2E=1 bun test …/end-to-end-ollama.testcontainers.test.ts
 *   或 `bun run test:containers:ollama`
 */
export function shouldRunOllamaE2e(): boolean {
  return process.env["USE_TESTCONTAINERS"] === "1" && process.env["RUN_OLLAMA_E2E"] === "1";
}

/** Ollama E2e：`RUN_OLLAMA_E2E` + `USE_TESTCONTAINERS` 且运行时可达。 */
export async function resolveShouldRunOllamaE2e(): Promise<boolean> {
  if (!shouldRunOllamaE2e()) {
    return false;
  }
  return getCachedRuntimeReachable();
}
