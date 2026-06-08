/**
 * Minimal OTel Collector Testcontainer — OTLP HTTP 入；debug exporter 出。
 *
 * 用于 observability 集成测试断言"engine 的 OTel pipeline 真的能 export 到 collector"。
 *
 * 镜像：`otel/opentelemetry-collector-contrib:0.94.0`（固定版本，避免 latest 漂移）。
 */
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { testInfraLog, withProgressLog } from './log';

/**
 * 最小 collector config：OTLP HTTP 接收（4318） + debug exporter 详细日志输出。
 * `verbosity: detailed` 让 stdout 输出 Span / Resource / Attribute 行，便于断言。
 */
const DEFAULT_OTEL_COLLECTOR_CONFIG_YAML = `
receivers:
  otlp:
    protocols:
      http:
        endpoint: 0.0.0.0:4318

exporters:
  debug:
    verbosity: detailed

service:
  telemetry:
    logs:
      level: info
  pipelines:
    traces:
      receivers: [otlp]
      exporters: [debug]
    metrics:
      receivers: [otlp]
      exporters: [debug]
    logs:
      receivers: [otlp]
      exporters: [debug]
`;

let otelTracked: StartedTestContainer[] | null = null;

export async function stopTrackedOtelCollectorIfAny(): Promise<void> {
  const arr = otelTracked;
  if (!arr?.length) return;
  testInfraLog(`Stopping ${arr.length} OTel Collector Testcontainer(s)…`);
  await Promise.all(
    arr.map((c) =>
      c.stop().catch(() => {
        /* ignore */
      }),
    ),
  );
  if (otelTracked === arr) otelTracked = null;
}

export interface OtelCollectorStack {
  /** OTLP HTTP endpoint，无尾斜杠（engine 通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 直用）。 */
  endpoint: string;
  /**
   * 读取 collector stdout 的快照（截断式）。
   * `collectMs` 是流上等待数据的时间窗（默认 1.5s）。
   */
  snapshotLogs(collectMs?: number): Promise<string>;
  stop(): Promise<void>;
}

/**
 * 启 OTel Collector contrib 镜像，监听 OTLP HTTP（4318）+ debug exporter（stdout）。
 */
export async function startOtelCollector(): Promise<OtelCollectorStack> {
  const started: StartedTestContainer[] = [];
  otelTracked = started;

  const image = 'otel/opentelemetry-collector-contrib:0.94.0';

  try {
    testInfraLog(`Starting OTel Collector (${image})…`);
    const t0 = Date.now();

    const container = await withProgressLog(
      'OtelCollector GenericContainer.start()',
      new GenericContainer(image)
        .withExposedPorts(4318)
        .withCopyContentToContainer([
          {
            content: DEFAULT_OTEL_COLLECTOR_CONFIG_YAML,
            target: '/etc/otelcol-contrib/config.yaml',
          },
        ])
        /**
         * collector 启动日志会出现 `Everything is ready` / `Starting GRPC server` /
         * `Starting HTTP server`；任一即视为就绪。
         */
        .withWaitStrategy(
          Wait.forLogMessage(
            /Everything is ready|Starting GRPC server|Starting HTTP server/i,
          ),
        )
        .withStartupTimeout(180_000)
        .start(),
    );
    started.push(container);

    testInfraLog(`OTel Collector container ready (+${Date.now() - t0}ms)`);

    const host = container.getHost();
    const port = container.getMappedPort(4318);
    const endpoint = `http://${host}:${port}`;

    return {
      endpoint,
      async snapshotLogs(collectMs = 1_500): Promise<string> {
        const stream = await container.logs();
        let combined = '';
        const onData = (chunk: Buffer | string): void => {
          combined += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        };
        stream.on('data', onData);
        await new Promise((r) => setTimeout(r, collectMs));
        stream.off('data', onData);
        try {
          const dt = (stream as { destroy?: () => void }).destroy;
          if (typeof dt === 'function') dt.call(stream);
        } catch {
          /* ignore */
        }
        return combined;
      },
      async stop(): Promise<void> {
        await container.stop().catch(() => {});
        if (otelTracked === started) otelTracked = null;
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
    if (otelTracked === started) otelTracked = null;
    throw e;
  }
}
