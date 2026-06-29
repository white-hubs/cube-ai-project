/**
 * Ollama Testcontainer — CPU 镜像，用于可选、耗时的 LLM 端到端（见 `RUN_OLLAMA_E2E`）。
 *
 * 对齐官方 Docker 用法：https://docs.ollama.com/docker
 */
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

import { testInfraLog, withProgressLog } from "./log";

let ollamaTracked: StartedTestContainer[] | null = null;

export async function stopTrackedOllamaIfAny(): Promise<void> {
  const arr = ollamaTracked;
  if (!arr?.length) {
    return;
  }
  testInfraLog(`Stopping ${arr.length} Ollama Testcontainer(s)…`);
  await Promise.all(
    arr.map((c) =>
      c.stop().catch(() => {
        /* ignore */
      }),
    ),
  );
  if (ollamaTracked === arr) {
    ollamaTracked = null;
  }
}

export interface OllamaStack {
  /**
   * OpenAI-compatible base（含 `/v1`），可直接作 `AGENTIC_ENGINE_OPENAI_BASE_URL`。
   */
  readonly openAiBaseUrl: string;
  /** 与 `ollama pull` / API `model` 字段一致的名称（如 `tinyllama`）。 */
  readonly model: string;
  stop(): Promise<void>;
}

export interface StartOllamaWithModelOptions {
  /** 默认 `AGENTIC_E2E_OLLAMA_MODEL` 或 `tinyllama`。 */
  model?: string;
  /** 镜像，默认 `AGENTIC_E2E_OLLAMA_IMAGE` 或 `ollama/ollama`。 */
  image?: string;
}

/**
 * 启动 `ollama/ollama`，等待 API，再在容器内执行 `ollama pull`（首次可能极慢）。
 */
export async function startOllamaWithModel(opts: StartOllamaWithModelOptions = {}): Promise<OllamaStack> {
  const model = opts.model?.trim() || process.env["AGENTIC_E2E_OLLAMA_MODEL"]?.trim() || "tinyllama";
  const image = opts.image?.trim() || process.env["AGENTIC_E2E_OLLAMA_IMAGE"]?.trim() || "ollama/ollama";

  const started: StartedTestContainer[] = [];
  ollamaTracked = started;

  try {
    testInfraLog(`Starting Ollama (${image})…`);
    const t0 = Date.now();

    const container = await withProgressLog(
      "Ollama GenericContainer.start()",
      new GenericContainer(image)
        .withExposedPorts(11434)
        .withWaitStrategy(Wait.forHttp("/api/tags", 11434).withStartupTimeout(120_000))
        .withStartupTimeout(180_000)
        .start(),
    );
    started.push(container);

    testInfraLog(`Ollama container ready (+${Date.now() - t0}ms)`);

    const host = container.getHost();
    const port = container.getMappedPort(11434);
    const openAiBaseUrl = `http://${host}:${port}/v1`;

    testInfraLog(`Pulling Ollama model "${model}" (first run can take many minutes)…`);
    const pullT0 = Date.now();

    const pullResult = await withProgressLog(`ollama pull ${model}`, container.exec(["ollama", "pull", model]));

    if (pullResult.exitCode !== 0) {
      throw new Error(`ollama pull ${model} failed: exit=${pullResult.exitCode} stderr=${pullResult.stderr.slice(-4000)}`);
    }

    testInfraLog(`Ollama model "${model}" ready (+${Date.now() - pullT0}ms)`);

    return {
      model,
      openAiBaseUrl,
      async stop(): Promise<void> {
        await container.stop().catch(() => {});
        if (ollamaTracked === started) {
          ollamaTracked = null;
        }
      },
    };
  } catch (e) {
    await Promise.all(
      started.map((c) =>
        c.stop().catch(() => {
          /* ignore */
        }),
      ),
    );
    if (ollamaTracked === started) {
      ollamaTracked = null;
    }
    throw e;
  }
}
